import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { addTeletelNote, assignAgentThenTeam, listOpenConversations, teletelGet } from "@/lib/providers/teletel";
import { readControl } from "@/lib/murad/control-store";
import { onList } from "@/lib/murad/control";
import { isWorkingTime, parseHours } from "@/lib/murad/reception";
import { SETTING } from "@/lib/murad/core";
import { logAudit } from "@/lib/data/audit";
import { availabilityOf, clientHint } from "@/lib/presence/availability";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";
import { DEFAULT_RULES, moveReason, parseRules, pickCandidate, RULES_KEY, WHY_TEXT, type Candidate, type Choice, type Rules } from "./switchboard-core";

/**
 * «البدّالة» — the server side of switchboard-core: the colleagues of a department as candidates (Teletel's members,
 * our employees behind them, their availability, Murad's «لا ترسل لفلان», their load), the pick, the minute sweep that
 * replaces «لا طلب بلا صاحب» (shared-sweep), and reassignConversation for whoever moves a client by hand.
 * Every move: the agent first, then the department (assignAgentThenTeam), a private note saying why, an audit row.
 * Nothing is sent to a client.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type Member = { id: number; name?: string | null; availability_status?: string | null; confirmed?: boolean; inbox_ids?: number[] };

export async function loadRules(): Promise<Rules> {
  const { data } = await db().from("app_settings").select("key, value").in("key", [RULES_KEY, "routing_shared"]);
  const s = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return parseRules(s.get(RULES_KEY), s.get("routing_shared"));
}

/** the department's colleagues as the switchboard weighs them; null when Teletel cannot be read */
export async function candidatesFor(
  teamId: number,
  inboxId: number | null,
  loads?: Map<number, { waiting: number; open: number }>,
): Promise<Candidate[] | null> {
  const members = await teletelGet<Member[]>(`/teams/${teamId}/team_members`);
  if (!Array.isArray(members)) return null;
  const [{ data: emps }, control, open] = await Promise.all([
    db()
      .from("employees")
      .select("id, arabic_name, teletel_agent_id")
      .eq("status", "Active")
      .in(
        "teletel_agent_id",
        members.map((m) => m.id),
      ),
    readControl(db()),
    loads ? Promise.resolve(null) : listOpenConversations(),
  ]);
  const emp = new Map(((emps ?? []) as { id: string; arabic_name: string; teletel_agent_id: number }[]).map((e) => [Number(e.teletel_agent_id), e]));
  const avail = await availabilityOf([...emp.values()].map((e) => e.id));
  const load = loads ?? loadsOf(open?.rows ?? []);
  return members.map((m) => {
    const e = emp.get(m.id);
    const a = e ? avail.get(e.id) : undefined;
    return {
      agentId: m.id,
      name: e?.arabic_name.trim() || (m.name ?? "").trim() || `#${m.id}`,
      employeeId: e?.id ?? null,
      // an agent Teletel has not confirmed cannot take a client (the visa routing's old rule)
      available: (a?.available ?? false) && m.confirmed !== false,
      reason: a?.reason ?? "offline",
      paused: (control.paused ?? []).includes(m.id),
      inboxOk: inboxId === null || !Array.isArray(m.inbox_ids) || m.inbox_ids.includes(inboxId),
      waiting: load.get(m.id)?.waiting ?? 0,
      open: load.get(m.id)?.open ?? 0,
    };
  });
}

function loadsOf(rows: { assigneeId: number | null; waitingSince: number }[]): Map<number, { waiting: number; open: number }> {
  const load = new Map<number, { waiting: number; open: number }>();
  for (const c of rows) {
    if (!c.assigneeId) continue;
    const l = load.get(c.assigneeId) ?? { waiting: 0, open: 0 };
    load.set(c.assigneeId, { waiting: l.waiting + (c.waitingSince > 0 ? 1 : 0), open: l.open + 1 });
  }
  return load;
}

/**
 * Who in this department takes the client now (Murad's hand-over, the visa routing, the sweep): the holder when they
 * can, the colleague who registered this client's phone, else the least loaded available. Null: nobody can — the
 * department's queue holds the client (Murad's reception speaks for the office meanwhile). Undefined: Teletel unreadable.
 */
export async function pickAgent(i: {
  teamId: number;
  inboxId: number | null;
  holderAgentId?: number | null;
  phone?: string | null;
}): Promise<(Choice & { hint: Awaited<ReturnType<typeof clientHint>> }) | null | undefined> {
  const [cands, rules, hint] = await Promise.all([candidatesFor(i.teamId, i.inboxId), loadRules(), clientHint(i.phone)]);
  if (!cands) return undefined;
  const choice = pickCandidate(cands, { holderAgentId: i.holderAgentId ?? null, hintEmployeeId: hint?.employeeId ?? null }, rules);
  return choice ? { ...choice, hint: choice.why === "hint" ? hint : null } : null;
}

/** «👤 العميل الذي سجّلته راسلنا» — the colleague who met or called this client is told who it is and what they wanted */
export async function tellHint(employeeId: string, conversationId: number, hint: NonNullable<Awaited<ReturnType<typeof clientHint>>>): Promise<void> {
  const { data } = await db().from("employees").select("telegram_chat_id").eq("id", employeeId).maybeSingle();
  const chat = Number((data as { telegram_chat_id?: number | string | null } | null)?.telegram_chat_id);
  if (!chat) return;
  const d = hint.details as { name?: string; want?: string; destination?: string; note?: string };
  await staffSend(
    chat,
    [
      `👤 <b>${escapeHtml(d.name ?? "عميلك")}</b> راسلنا الآن — حُوّل إليك لأنك سجّلته «${hint.kind === "client" ? "لدي عميل" : "لدي اتصال"}».`,
      [d.want, d.destination, d.note]
        .filter(Boolean)
        .map((x) => escapeHtml(String(x)))
        .join(" · "),
    ]
      .filter(Boolean)
      .join("\n"),
    [[{ text: "💬 افتح المحادثة", callback_data: `c:${conversationId}` }]],
    {},
    `conv:${conversationId}`,
  ).catch(() => undefined);
}

/**
 * Interim «فيها بيع أو خدمة مؤكدة» until session A's predicate lands (the owner's fixed rule: never take such a
 * conversation from the colleague who has it): an offer followed on this conversation whose operations file is
 * confirmed, paid or done. Unreadable = protected — when in doubt, nothing moves.
 * ponytail: swap for A's predicate at the merge; one call site each in moveReason's input and reassignConversation.
 */
export async function hasSaleOrService(conversationId: number): Promise<boolean> {
  const { data: f, error } = await db().from("sla_followups").select("offer_id").eq("conversation_id", conversationId).not("offer_id", "is", null);
  if (error) return true;
  const offers = ((f ?? []) as { offer_id: string }[]).map((r) => r.offer_id);
  if (!offers.length) return false;
  const { count, error: e2 } = await db()
    .from("operations")
    .select("id", { count: "exact", head: true })
    .in("offer_id", offers)
    .in("client_status", ["confirmed", "paid_partial", "paid_full", "completed"]);
  return e2 ? true : (count ?? 0) > 0;
}

async function move(
  c: { id: number; teamId: number },
  to: Candidate,
  why: string,
  actor: { id: string | null; label: string },
  note: string,
): Promise<boolean> {
  if (!(await assignAgentThenTeam(c.id, to.agentId, c.teamId))) return false;
  await addTeletelNote(c.id, note);
  await logAudit({
    action: "switchboard.moved",
    entity: "teletel_conversations",
    entity_id: String(c.id),
    meta: { to_agent: to.agentId, to_employee: to.employeeId, to_name: to.name, why },
    actor,
  });
  return true;
}

/**
 * The minute sweep (api/murad/run), in place of «لا طلب بلا صاحب»: during the working hours, a client waiting on nobody
 * or on a colleague who is away goes to an available colleague of their department (the sales team for none) — the one
 * who registered them first. Ten a minute at most; each re-read just before it moves.
 */
export async function switchboardSweep(nowMs = Date.now(), opts: { dry?: boolean } = {}): Promise<Record<string, unknown>> {
  const saved = await loadRules();
  // the rules screen's «ماذا ستفعل الآن»: the same pass, nothing moved
  const rules: Rules = opts.dry && saved.mode !== "off" ? { ...saved, mode: "dry" } : saved;
  if (rules.mode === "off") return { off: true };
  const { data: hoursRow } = await db().from("app_settings").select("value").eq("key", SETTING.receptionHours).maybeSingle();
  if (!isWorkingTime(new Date(nowMs), parseHours((hoursRow as { value?: string } | null)?.value))) return { mode: rules.mode, offShift: true };
  const open = await listOpenConversations();
  if (!open) return { unreachable: true };
  const nowSec = Math.floor(nowMs / 1000);
  const waiting = open.rows.filter((c) => c.waitingSince > 0).sort((a, b) => a.waitingSince - b.waitingSince);
  if (!waiting.length) return { mode: rules.mode, due: 0 };

  const holders = [...new Set(waiting.map((c) => c.assigneeId).filter((a): a is number => a !== null))];
  const { data: emps } = await db().from("employees").select("id, teletel_agent_id").eq("status", "Active").in("teletel_agent_id", holders);
  const empOf = new Map(((emps ?? []) as { id: string; teletel_agent_id: number }[]).map((e) => [Number(e.teletel_agent_id), e.id]));
  const avail = await availabilityOf([...empOf.values()], nowMs);
  const control = await readControl(db());
  const loads = loadsOf(open.rows);
  const moved: { id: number; to: string; why: string }[] = [];
  let due = 0;

  for (const c of waiting) {
    if (moved.length >= 10) break;
    if (onList(c.phone, control.noHandoff)) continue;
    // the manager's own «late» agent keeps what Murad gave it — no tug of war (reception-run lateSweep)
    if (control.late?.agentId && c.assigneeId === control.late.agentId) continue;
    const emp = c.assigneeId !== null ? (empOf.get(c.assigneeId) ?? null) : null;
    const a = emp ? avail.get(emp) : undefined;
    const holder = { employeeId: emp, available: a?.available ?? false, reason: a?.reason ?? null };
    const pre = moveReason(c, holder, rules, { nowSec, working: true, protectedSale: false });
    if (!pre) continue;
    // only now the costlier reads: the sale, the fresh state
    const sold = pre === "away" && (await hasSaleOrService(c.id));
    if (sold) continue;
    due += 1;
    const teamId = c.teamId !== null && !rules.sharedTeams.includes(c.teamId) ? c.teamId : rules.salesTeam;
    const fresh = await teletelGet<{ waiting_since?: number | null; meta?: { assignee?: { id?: number } | null; team?: { id?: number } | null } }>(
      `/conversations/${c.id}`,
    );
    if (!fresh?.meta || (fresh.meta.assignee?.id ?? null) !== c.assigneeId || !fresh.waiting_since) continue;
    const cands = await candidatesFor(teamId, c.inboxId, loads);
    if (!cands) continue;
    const hint = await clientHint(c.phone);
    const choice = pickCandidate(cands, { hintEmployeeId: hint?.employeeId ?? null }, rules);
    if (!choice || choice.candidate.agentId === c.assigneeId) continue;
    const waited = Math.round((nowSec - c.waitingSince) / 60);
    const why = `${WHY_TEXT[pre]} منذ ${waited} دقيقة · ${WHY_TEXT[choice.why]}`;
    if (rules.mode === "on") {
      const note = `🔀 البدّالة: أُسندت إلى ${choice.candidate.name} — ${why}${c.assignee ? ` (كانت عند ${c.assignee})` : ""}.`;
      if (!(await move({ id: c.id, teamId }, choice.candidate, why, { id: null, label: "البدّالة" }, note))) continue;
      if (choice.why === "hint" && hint && choice.candidate.employeeId) await tellHint(choice.candidate.employeeId, c.id, hint);
    }
    const l = loads.get(choice.candidate.agentId) ?? { waiting: 0, open: 0 };
    loads.set(choice.candidate.agentId, { waiting: l.waiting + 1, open: l.open + 1 });
    moved.push({ id: c.id, to: choice.candidate.name, why });
  }
  return { mode: rules.mode, due, moved };
}

/**
 * A client moved by hand (the administration, the bot): to a colleague of ours, with a reason. A conversation with a
 * sale or a confirmed service stays with its colleague unless an administrator forces it — and says why.
 */
export async function reassignConversation(
  conversationId: number,
  toEmployeeId: string,
  reason: string,
  actor: { id: string; name: string; admin: boolean },
  opts: { force?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const why = (reason ?? "").trim().slice(0, 300);
  if (!why) return { ok: false, error: "اكتب سبب النقل." };
  const [{ data: emp }, conv] = await Promise.all([
    db().from("employees").select("id, arabic_name, teletel_agent_id, status").eq("id", toEmployeeId).maybeSingle(),
    teletelGet<{ meta?: { assignee?: { id?: number; name?: string } | null; team?: { id?: number } | null } }>(`/conversations/${conversationId}`),
  ]);
  const to = emp as { id: string; arabic_name: string; teletel_agent_id: number | null; status: string } | null;
  if (!to?.teletel_agent_id || to.status !== "Active") return { ok: false, error: "الموظف غير مربوط بتيلي تيل." };
  if (!conv?.meta) return { ok: false, error: "تعذّر قراءة المحادثة من تيلي تيل." };
  if (conv.meta.assignee?.id && conv.meta.assignee.id !== to.teletel_agent_id && (await hasSaleOrService(conversationId)) && !(opts.force && actor.admin)) {
    return { ok: false, error: "في هذه المحادثة بيع أو خدمة مؤكدة — تبقى مع موظفها. للإدارة فقط: النقل بالقوة مع سبب." };
  }
  const rules = await loadRules();
  const teamId = conv.meta.team?.id && !rules.sharedTeams.includes(conv.meta.team.id) ? conv.meta.team.id : rules.salesTeam;
  const target: Candidate = {
    agentId: Number(to.teletel_agent_id),
    name: to.arabic_name.trim(),
    employeeId: to.id,
    available: true,
    reason: null,
    paused: false,
    inboxOk: true,
    waiting: 0,
    open: 0,
  };
  const forced = Boolean(opts.force && actor.admin);
  const note = `🔀 نُقلت إلى ${target.name} بيد ${actor.name}${forced ? " (بالقوة)" : ""}: ${why}${conv.meta.assignee?.name ? ` — كانت عند ${conv.meta.assignee.name}` : ""}.`;
  if (!(await move({ id: conversationId, teamId }, target, why, { id: actor.id, label: actor.name }, note)))
    return { ok: false, error: "تعذّر النقل في تيلي تيل." };
  await logAudit({
    action: "switchboard.reassigned",
    entity: "teletel_conversations",
    entity_id: String(conversationId),
    meta: { to: to.id, from_agent: conv.meta.assignee?.id ?? null, reason: why, forced },
    actor: { id: actor.id, label: actor.name },
  });
  return { ok: true };
}

export { DEFAULT_RULES };
