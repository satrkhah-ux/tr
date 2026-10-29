"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { listOpenConversations } from "@/lib/providers/teletel";
import { availabilityOf, type AvailabilityReason } from "@/lib/presence/availability";
import { loadRules, reassignConversation, switchboardSweep } from "@/lib/routing/switchboard";
import { parseRules, RULES_KEY, type Rules } from "@/lib/routing/switchboard-core";

/**
 * «البدّالة» — the administration's screen (the owner, 2026-10-29: «مع شاشة قواعد للإدارة»): the rules, who can take a
 * client right now and why not, what the switchboard would do this minute, the last moves, and moving a client by
 * hand. employees.manage, dashboard.admin or developer.access; forcing a sale out needs dashboard.admin / developer.access.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function who() {
  const [me, team, admin, dev] = await Promise.all([
    getCurrentEmployeeId(),
    currentCan("employees.manage"),
    currentCan("dashboard.admin"),
    currentCan("developer.access"),
  ]);
  return me && (team || admin || dev) ? { me, admin: admin || dev } : null;
}

export type BoardRow = { id: string; name: string; agentId: number; available: boolean; reason: AvailabilityReason | null; open: number; waiting: number };
export type MoveRow = { at: string; conversation: string; to: string; why: string; by: string; forced: boolean };
export type SwitchboardData = {
  rules: Rules;
  board: BoardRow[];
  moves: MoveRow[];
  preview: { due: number; moved: { id: number; to: string; why: string }[]; note: string | null };
  admin: boolean;
  people: { id: string; name: string }[];
  at: number;
};

export async function getSwitchboard(): Promise<SwitchboardData | null> {
  const w = await who();
  if (!w) return null;
  const [rules, { data: emps }, open, { data: audit }, preview] = await Promise.all([
    loadRules(),
    db().from("employees").select("id, arabic_name, teletel_agent_id").eq("status", "Active").not("teletel_agent_id", "is", null).order("arabic_name"),
    listOpenConversations(),
    db()
      .from("audit_logs")
      .select("created_at, entity_id, meta, actor_email")
      .in("action", ["switchboard.moved", "switchboard.reassigned"])
      .order("created_at", { ascending: false })
      .limit(40),
    switchboardSweep(Date.now(), { dry: true }).catch(() => ({ unreachable: true })),
  ]);
  const people = (emps ?? []) as { id: string; arabic_name: string; teletel_agent_id: number }[];
  const avail = await availabilityOf(people.map((p) => p.id));
  const load = new Map<number, { open: number; waiting: number }>();
  for (const c of open?.rows ?? []) {
    if (!c.assigneeId) continue;
    const l = load.get(c.assigneeId) ?? { open: 0, waiting: 0 };
    load.set(c.assigneeId, { open: l.open + 1, waiting: l.waiting + (c.waitingSince > 0 ? 1 : 0) });
  }
  const p = preview as {
    mode?: string;
    due?: number;
    moved?: { id: number; to: string; why: string }[];
    off?: boolean;
    unreachable?: boolean;
  };
  return {
    rules,
    board: people.map((e) => ({
      id: e.id,
      name: e.arabic_name.trim(),
      agentId: Number(e.teletel_agent_id),
      available: avail.get(e.id)?.available ?? false,
      reason: avail.get(e.id)?.reason ?? null,
      open: load.get(Number(e.teletel_agent_id))?.open ?? 0,
      waiting: load.get(Number(e.teletel_agent_id))?.waiting ?? 0,
    })),
    moves: ((audit ?? []) as { created_at: string; entity_id: string; meta: Record<string, unknown> | null; actor_email: string | null }[]).map((a) => ({
      at: a.created_at,
      conversation: a.entity_id,
      to: String(a.meta?.to_name ?? a.meta?.to ?? "—"),
      why: String(a.meta?.why ?? a.meta?.reason ?? ""),
      by: a.actor_email ?? "البدّالة",
      forced: a.meta?.forced === true,
    })),
    preview: {
      due: p.due ?? 0,
      moved: p.moved ?? [],
      note: p.off ? "البدّالة متوقفة." : p.unreachable ? "تعذّر الوصول إلى تيلي تيل." : null,
    },
    admin: w.admin,
    people: people.map((e) => ({ id: e.id, name: e.arabic_name.trim() })),
    at: Date.now(),
  };
}

export async function saveSwitchboardRules(input: Partial<Rules>): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = await who();
  if (!w) return { ok: false, error: "forbidden" };
  const rules = parseRules(JSON.stringify({ ...(await loadRules()), ...input }));
  const { error } = await db()
    .from("app_settings")
    .upsert({ key: RULES_KEY, value: JSON.stringify(rules), updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "تعذّر الحفظ، أعد المحاولة." };
  await logAudit({ action: "switchboard.rules_saved", entity: "app_settings", entity_id: RULES_KEY, meta: rules });
  return { ok: true };
}

/** «انقل عميلاً»: by hand, with a reason; a sale stays unless an administrator forces it */
export async function reassignByHand(
  conversationId: number,
  toEmployeeId: string,
  reason: string,
  force: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = await who();
  if (!w || !Number.isInteger(conversationId) || conversationId <= 0) return { ok: false, error: "forbidden" };
  const { data } = await db().from("employees").select("arabic_name").eq("id", w.me).maybeSingle();
  const name = ((data as { arabic_name?: string } | null)?.arabic_name ?? "الإدارة").trim();
  return reassignConversation(conversationId, toEmployeeId, reason, { id: w.me, name, admin: w.admin }, { force: force && w.admin });
}
