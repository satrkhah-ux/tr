import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { addTeletelNote, listOpenConversations, teamMembers, teletelGet } from "@/lib/providers/teletel";
import { MURAD_CONTROL_KEY, onList, parseControl } from "@/lib/murad/control";
import { handOver } from "@/lib/murad/handover";
import { logAudit } from "@/lib/data/audit";
import { isOrphan, parseShared, pickSeller, type Seller, type SellerLoad } from "./shared";
import { presenceOnlineAgentIds } from "./presence";

/**
 * «لا طلب بلا صاحب» — the minute sweep (api/murad/run). A client waiting on a shared Teletel login
 * (shared.ts) goes to a seller of «قسم المبيعات» through Murad's own hand-over (handover.ts: never a
 * «لا يُحوّل أبداً» number, never a paused colleague), with a team note saying why, audited. Teletel
 * then tells the seller on «تنبيهاتي» like any assignment.
 *
 * The open list is the shared cache (up to five minutes old), so each candidate is read again just
 * before it moves: a colleague who answered a minute ago keeps the client. Ten a minute at most.
 * app_settings `routing_shared`: "off" stops it, "dry" reports what it would do.
 */

type Fresh = { waiting_since?: number | null; meta?: { assignee?: { id?: number } | null; team?: { id?: number } | null; sender?: { phone_number?: string | null } } };

const waitedText = (minutes: number) => (minutes < 120 ? `${minutes} دقيقة` : `${Math.round(minutes / 60)} ساعة`);

export async function sweepSharedAccounts(): Promise<Record<string, unknown>> {
  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data: rows } = await service.from("app_settings").select("key, value").in("key", ["routing_shared", MURAD_CONTROL_KEY]);
  const setting = new Map(((rows ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const s = parseShared(setting.get("routing_shared"));
  if (!s) return { off: true };
  const control = parseControl(setting.get(MURAD_CONTROL_KEY));

  const open = await listOpenConversations();
  if (!open) return { unreachable: true };
  const now = Math.floor(Date.now() / 1000);
  const due = open.rows.filter((c) => isOrphan(c, s, now)).sort((a, b) => a.waitingSince - b.waitingSince);
  if (due.length === 0) return { mode: s.mode, due: 0 };

  // the sellers: «قسم المبيعات» members who are someone in our system, not paused, not a shared login themselves
  const [members, { data: emps }, inSystem] = await Promise.all([
    teamMembers(s.salesTeam),
    service.from("employees").select("teletel_agent_id").eq("status", "Active").not("teletel_agent_id", "is", null),
    // «فاتح النظام = متصل»: a live session in our system counts as online, whatever Teletel says
    presenceOnlineAgentIds(service),
  ]);
  const people = new Set(((emps ?? []) as { teletel_agent_id: number }[]).map((e) => Number(e.teletel_agent_id)));
  const paused = new Set(control.paused ?? []);
  const sellers: Seller[] = members
    .filter((m) => people.has(m.id) && !paused.has(m.id) && !s.agents.includes(m.id))
    .map((m) => ({ id: m.id, name: m.name, online: m.availability === "online" || inSystem.has(m.id) }));
  if (sellers.length === 0) return { mode: s.mode, due: due.length, sellers: 0 };

  const load = new Map<number, SellerLoad>();
  for (const c of open.rows) {
    if (!c.assigneeId) continue;
    const l = load.get(c.assigneeId) ?? { waiting: 0, open: 0 };
    load.set(c.assigneeId, { waiting: l.waiting + (c.waitingSince > 0 ? 1 : 0), open: l.open + 1 });
  }

  const moved: { id: number; to: string; waited: number }[] = [];
  for (const c of due.slice(0, 10)) {
    const fresh = await teletelGet<Fresh>(`/conversations/${c.id}`);
    if (!fresh?.meta) continue;
    const owner = { assigneeId: fresh.meta.assignee?.id ?? null, teamId: fresh.meta.team?.id ?? null, waitingSince: fresh.waiting_since ?? 0 };
    if (!isOrphan(owner, s, now)) continue;
    const phone = fresh.meta.sender?.phone_number ?? null;
    if (onList(phone, control.noHandoff)) continue;
    // the manager's own «late» agent keeps what Murad gave it (reception-run.ts lateSweep) — no tug of war
    if (control.late?.agentId && owner.assigneeId === control.late.agentId) continue;
    const seller = pickSeller(sellers, load);
    if (!seller) break;
    const waited = Math.round((now - owner.waitingSince) / 60);
    if (s.mode === "on") {
      if (!(await handOver(control, c.id, s.salesTeam, seller.id, phone))) continue;
      await addTeletelNote(c.id, `أُسندت تلقائياً إلى ${seller.name}: العميل ينتظر ردنا منذ ${waitedText(waited)} على حساب مشترك لا يملكه موظف («لا طلب بلا صاحب»).`);
      await logAudit({
        action: "teletel.shared_reassigned",
        entity: "teletel_conversations",
        entity_id: String(c.id),
        meta: { from_agent: owner.assigneeId, from_team: owner.teamId, to_agent: seller.id, to_name: seller.name, waited_min: waited },
        actor: { id: null, label: "shared-sweep" },
      });
    }
    const l = load.get(seller.id) ?? { waiting: 0, open: 0 };
    load.set(seller.id, { waiting: l.waiting + 1, open: l.open + 1 });
    moved.push({ id: c.id, to: seller.name, waited });
  }
  return { mode: s.mode, due: due.length, moved };
}
