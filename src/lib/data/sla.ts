"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import {
  addTeletelNote,
  assignTeletelTeam,
  conversationThread,
  getTeletelConfig,
  listOpenConversations,
  listTeletelTeams,
  sendTeletelMessage,
  type OpenConversation,
  type TeletelTeam,
  type ThreadMessage,
} from "@/lib/providers/teletel";
import {
  autoFollowup,
  autoTeamMove,
  SLA_KINDS,
  SLA_UNITS,
  slaClock,
  suggestRules,
  tierFor,
  waitParts,
  type SlaKind,
  type SlaRule,
  type Suggestion,
} from "@/lib/sla/classify";

/**
 * «SLA» (the owner, 2026-10-17) — the administration's and the developer's only:
 * every open Teletel conversation by how long it has gone (classify.ts), the
 * rules in minutes, hours or days, and «ينقل إلى»: a conversation that reaches a
 * rule marked for it lands in our «المتابعة» — a manager hands it to an
 * employee, who answers it FROM HERE (sendTeletelMessage) and closes it — or is
 * handed to a team in Teletel, with a team note saying why (sla_moves logs it).
 *
 * Every export checks on the server: the board and the rules take
 * dashboard.admin or developer.access; a follow-up also opens to the employee
 * it is assigned to, and to nobody else.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function isManager(): Promise<boolean> {
  const [admin, dev] = await Promise.all([currentCan("dashboard.admin"), currentCan("developer.access")]);
  return admin || dev;
}

export type SlaRow = OpenConversation & {
  kind: SlaKind;
  minutes: number;
  tierId: string | null;
  followupId: string | null;
  /** the Teletel team an SLA rule handed it to this week */
  movedTo: string | null;
};

export type Followup = {
  id: string;
  conversation_id: number;
  contact_name: string | null;
  contact_phone: string | null;
  kind: SlaKind;
  rule_name: string | null;
  waited_minutes: number | null;
  teletel_assignee: string | null;
  status: "open" | "done";
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_at: string | null;
  replied_at: string | null;
  done_at: string | null;
  done_name: string | null;
  note: string | null;
  created_at: string;
};

export type SlaBoard =
  | {
      ok: true;
      rules: SlaRule[];
      /** null: Teletel could not be reached — never a partial list shown as the whole */
      rows: SlaRow[] | null;
      followups: Followup[];
      employees: { id: string; name: string }[];
      /** what «ينقل إلى» may name besides our «المتابعة» */
      teams: TeletelTeam[];
      /** «قواعد مقترحة بناء على محادثات النظام» — empty while Teletel cannot be read */
      suggestions: Suggestion[];
      /** «فتح في Teletel» — the conversation's page there */
      teletelLink: string | null;
      at: string;
    }
  | { ok: false; error: "forbidden" };

type Fail = { ok: false; error: "forbidden" | "invalid" | "notFound" | "window" | "unreachable" | "done" | "failed" };

const FOLLOWUP_COLS =
  "id, conversation_id, contact_name, contact_phone, kind, rule_name, waited_minutes, teletel_assignee, status, assigned_to, assigned_at, replied_at, done_at, note, created_at, assignee:employees!sla_followups_assigned_to_fkey(arabic_name), closer:employees!sla_followups_done_by_fkey(arabic_name)";

type RawFollowup = Omit<Followup, "assigned_name" | "done_name"> & {
  assignee: { arabic_name: string | null } | null;
  closer: { arabic_name: string | null } | null;
};
const shape = (r: RawFollowup): Followup => {
  const { assignee, closer, ...rest } = r;
  return { ...rest, assigned_name: assignee?.arabic_name ?? null, done_name: closer?.arabic_name ?? null };
};

function teletelLink(): string | null {
  const c = getTeletelConfig();
  return c ? `${c.baseUrl}/app/accounts/${c.accountId}/conversations/` : null;
}

async function loadRules(): Promise<SlaRule[]> {
  const { data } = await db().from("sla_rules").select("id, kind, name, amount, unit, color, to_followup, teletel_team_id, teletel_team_name, active").order("created_at");
  return (data ?? []) as SlaRule[];
}

/** A late conversation enters «المتابعة» — once while it is open (the unique index keeps a race to one). */
const AR_UNIT = { minute: "دقيقة", hour: "ساعة", day: "يوم" } as const;
const arWait = (minutes: number) => {
  const w = waitParts(minutes);
  return `${w.n} ${AR_UNIT[w.unit]}`;
};

/**
 * The rules that name a Teletel team hand their conversations over now — a
 * recent delay, not already there, not moved there by us this week (a colleague
 * who moves it back is not fought). Fifty a look at most.
 */
async function moveToTeams(service: SupabaseClient, rows: SlaRow[], rules: SlaRule[]): Promise<void> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await service.from("sla_moves").select("conversation_id, team_id, team_name").gte("created_at", weekAgo).order("created_at");
  const moves = (data ?? []) as { conversation_id: number; team_id: number; team_name: string | null }[];
  const done = new Set(moves.map((m) => `${m.conversation_id}:${m.team_id}`));
  const last = new Map(moves.map((m) => [m.conversation_id, m.team_name]));
  for (const r of rows) r.movedTo = last.get(r.id) ?? null;

  const ruleOf = new Map(rules.map((x) => [x.id, x]));
  // ponytail: 50 a look keeps a first switch-on from flooding Teletel; the rest follow on the next looks
  const due = rows
    .map((r) => ({ r, rule: r.tierId ? ruleOf.get(r.tierId) : undefined }))
    .map((x) => ({ ...x, team: autoTeamMove(x.rule, x.r.minutes, x.r.teamId) }))
    .filter((x): x is { r: SlaRow; rule: SlaRule; team: number } => x.team !== null && !done.has(`${x.r.id}:${x.team}`))
    .slice(0, 50);
  await Promise.all(
    due.map(async ({ r, rule, team }) => {
      if (!(await assignTeletelTeam(r.id, team))) return;
      const teamName = rule.teletel_team_name ?? `#${team}`;
      await addTeletelNote(r.id, `نُقلت تلقائياً إلى «${teamName}» — SLA: «${rule.name}» بعد انتظار ${arWait(r.minutes)}.`);
      await service.from("sla_moves").insert({ conversation_id: r.id, team_id: team, team_name: teamName, rule_id: rule.id, rule_name: rule.name, waited_minutes: r.minutes });
      Object.assign(r, { teamId: team, team: teamName, movedTo: teamName });
    }),
  );
}

function followupRow(c: SlaRow, rule: SlaRule | null) {
  return {
    conversation_id: c.id,
    contact_id: c.contactId,
    contact_name: c.name,
    contact_phone: c.phone,
    kind: c.kind,
    rule_id: rule?.id ?? null,
    rule_name: rule?.name ?? null,
    waited_minutes: c.minutes,
    teletel_assignee: c.assignee,
  };
}

/** The board: the conversations by their clock, the rules, «المتابعة» and who may take one. */
export async function getSlaBoard(fresh = false): Promise<SlaBoard> {
  if (!(await isManager())) return { ok: false, error: "forbidden" };
  const service = db();
  const [rules, fetched, teams] = await Promise.all([loadRules(), listOpenConversations(fresh), listTeletelTeams()]);
  const conversations = fetched?.rows ?? null;
  const now = Math.floor(Date.now() / 1000);

  const { data: openRows } = await service.from("sla_followups").select("id, conversation_id").eq("status", "open");
  const open = new Map(((openRows ?? []) as { id: string; conversation_id: number }[]).map((r) => [r.conversation_id, r.id]));

  const rows: SlaRow[] | null =
    conversations?.map((c) => {
      const clock = slaClock(c, now);
      return { ...c, ...clock, tierId: tierFor(rules, clock.kind, clock.minutes)?.id ?? null, followupId: open.get(c.id) ?? null, movedTo: null };
    }) ?? null;
  if (rows) await moveToTeams(service, rows, rules);

  // the ones that reached a rule marked «إلى المتابعة» move there now — recent delays only (classify.ts)
  const due = (rows ?? []).filter((r) => !r.followupId && autoFollowup(rules.find((x) => x.id === r.tierId), r.minutes));
  if (due.length > 0) {
    const made = await Promise.all(
      due.map((r) => service.from("sla_followups").insert(followupRow(r, rules.find((x) => x.id === r.tierId) ?? null)).select("id").maybeSingle()),
    );
    made.forEach((m, i) => {
      const id = (m.data as { id: string } | null)?.id;
      if (id) due[i].followupId = id;
    });
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: fu }, { data: emps }] = await Promise.all([
    service.from("sla_followups").select(FOLLOWUP_COLS).or(`status.eq.open,done_at.gte.${weekAgo}`).order("created_at", { ascending: false }).limit(300),
    service.from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
  ]);

  return {
    ok: true,
    rules,
    rows,
    followups: ((fu ?? []) as unknown as RawFollowup[]).map(shape),
    employees: ((emps ?? []) as { id: string; arabic_name: string | null }[]).map((e) => ({ id: e.id, name: e.arabic_name ?? "—" })),
    teams,
    suggestions: rows ? suggestRules(rows, teams, rules) : [],
    teletelLink: teletelLink(),
    // when Teletel was read, not when the page was drawn
    at: new Date(fetched?.at ?? Date.now()).toISOString(),
  };
}

// ---------- the rules ----------

export type RuleInput = Omit<SlaRule, "id"> & { id?: string };

export async function saveSlaRule(input: RuleInput): Promise<{ ok: true } | Fail> {
  if (!(await isManager())) return { ok: false, error: "forbidden" };
  const name = String(input.name ?? "").trim().slice(0, 60);
  const amount = Math.floor(Number(input.amount));
  if (
    !name ||
    !SLA_KINDS.includes(input.kind) ||
    !SLA_UNITS.includes(input.unit) ||
    !Number.isFinite(amount) ||
    amount < 1 ||
    amount > 100_000 ||
    !/^#[0-9a-f]{6}$/i.test(input.color)
  ) {
    return { ok: false, error: "invalid" };
  }
  // a team is one Teletel has — its name taken from there, not from the browser
  let team: TeletelTeam | null = null;
  if (input.teletel_team_id != null) {
    team = (await listTeletelTeams()).find((t) => t.id === Number(input.teletel_team_id)) ?? null;
    if (!team) return { ok: false, error: "invalid" };
  }
  const row = {
    kind: input.kind,
    name,
    amount,
    unit: input.unit,
    color: input.color,
    // «ينقل إلى» is one place: a team, or our «المتابعة», or nowhere
    to_followup: !team && Boolean(input.to_followup),
    teletel_team_id: team?.id ?? null,
    teletel_team_name: team?.name ?? null,
    active: input.active !== false,
  };
  const { error } = input.id
    ? await db().from("sla_rules").update({ ...row, updated_at: new Date().toISOString() }).eq("id", input.id)
    : await db().from("sla_rules").insert(row);
  return error ? { ok: false, error: "failed" } : { ok: true };
}

export async function deleteSlaRule(id: string): Promise<{ ok: true } | Fail> {
  if (!(await isManager())) return { ok: false, error: "forbidden" };
  const { error } = await db().from("sla_rules").delete().eq("id", String(id));
  return error ? { ok: false, error: "failed" } : { ok: true };
}

// ---------- «المتابعة» ----------

/** A manager sends a conversation there by hand, whatever its clock says. */
export async function sendToFollowup(conversationId: number): Promise<{ ok: true; id: string } | Fail> {
  if (!(await isManager())) return { ok: false, error: "forbidden" };
  const service = db();
  const { data: existing } = await service.from("sla_followups").select("id").eq("conversation_id", conversationId).eq("status", "open").maybeSingle();
  if (existing) return { ok: true, id: (existing as { id: string }).id };
  const c = (await listOpenConversations())?.rows.find((x) => x.id === conversationId);
  if (!c) return { ok: false, error: "notFound" };
  const clock = slaClock(c, Math.floor(Date.now() / 1000));
  const rules = await loadRules();
  const rule = tierFor(rules, clock.kind, clock.minutes);
  const { data, error } = await service
    .from("sla_followups")
    .insert(followupRow({ ...c, ...clock, tierId: rule?.id ?? null, followupId: null, movedTo: null }, rule))
    .select("id")
    .single();
  return error || !data ? { ok: false, error: "failed" } : { ok: true, id: (data as { id: string }).id };
}

export async function assignFollowup(id: string, employeeId: string | null): Promise<{ ok: true } | Fail> {
  if (!(await isManager())) return { ok: false, error: "forbidden" };
  const me = await getCurrentEmployeeId();
  const { error } = await db()
    .from("sla_followups")
    .update(employeeId ? { assigned_to: employeeId, assigned_by: me, assigned_at: new Date().toISOString() } : { assigned_to: null, assigned_by: null, assigned_at: null })
    .eq("id", String(id))
    .eq("status", "open");
  return error ? { ok: false, error: "failed" } : { ok: true };
}

/** Every open, unassigned follow-up to OUR employee of the same name as its Teletel holder — one press for a backlog. */
export async function assignToTeletelHolders(): Promise<{ ok: true; assigned: number } | Fail> {
  if (!(await isManager())) return { ok: false, error: "forbidden" };
  const service = db();
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const [{ data: open }, { data: emps }, me] = await Promise.all([
    service.from("sla_followups").select("id, teletel_assignee").eq("status", "open").is("assigned_to", null),
    service.from("employees").select("id, arabic_name").eq("status", "Active"),
    getCurrentEmployeeId(),
  ]);
  const byName = new Map(((emps ?? []) as { id: string; arabic_name: string | null }[]).map((e) => [norm(e.arabic_name), e.id]));
  let assigned = 0;
  for (const f of (open ?? []) as { id: string; teletel_assignee: string | null }[]) {
    const to = norm(f.teletel_assignee) ? byName.get(norm(f.teletel_assignee)) : undefined;
    if (!to) continue;
    const { error } = await service
      .from("sla_followups")
      .update({ assigned_to: to, assigned_by: me, assigned_at: new Date().toISOString() })
      .eq("id", f.id)
      .is("assigned_to", null);
    if (!error) assigned += 1;
  }
  return { ok: true, assigned };
}

/** The follow-up, if this person may act on it: a manager, or the employee it was handed to. */
async function followupFor(id: string): Promise<{ row: Followup; manager: boolean; me: string | null } | null> {
  const [user, manager, me] = await Promise.all([getServerUser(), isManager(), getCurrentEmployeeId()]);
  if (!user) return null;
  const { data } = await db().from("sla_followups").select(FOLLOWUP_COLS).eq("id", String(id)).maybeSingle();
  if (!data) return null;
  const row = shape(data as unknown as RawFollowup);
  if (!manager && (!me || row.assigned_to !== me)) return null;
  return { row, manager, me };
}

export type FollowupThread =
  | { ok: true; followup: Followup; messages: ThreadMessage[] | null; canReply: boolean; teletelLink: string | null; manager: boolean }
  | Fail;

export async function getFollowupThread(id: string): Promise<FollowupThread> {
  const f = await followupFor(id);
  if (!f) return { ok: false, error: "forbidden" };
  const thread = await conversationThread(f.row.conversation_id);
  return { ok: true, followup: f.row, messages: thread?.messages ?? null, canReply: thread?.canReply ?? false, teletelLink: teletelLink(), manager: f.manager };
}

/** The answer goes out on the client's own thread — only inside WhatsApp's 24 hours. */
export async function replyFollowup(id: string, text: string): Promise<{ ok: true } | Fail> {
  const f = await followupFor(id);
  if (!f) return { ok: false, error: "forbidden" };
  if (f.row.status !== "open") return { ok: false, error: "done" };
  const body = String(text ?? "").trim().slice(0, 4000);
  if (!body) return { ok: false, error: "invalid" };
  const thread = await conversationThread(f.row.conversation_id);
  if (!thread) return { ok: false, error: "unreachable" };
  if (!thread.canReply) return { ok: false, error: "window" };
  if ((await sendTeletelMessage(f.row.conversation_id, body)) === null) return { ok: false, error: "unreachable" };
  await db().from("sla_followups").update({ replied_at: new Date().toISOString() }).eq("id", f.row.id);
  return { ok: true };
}

/** «تمت المتابعة» — with what was done, said once. */
export async function closeFollowup(id: string, note: string): Promise<{ ok: true } | Fail> {
  const f = await followupFor(id);
  if (!f) return { ok: false, error: "forbidden" };
  if (f.row.status !== "open") return { ok: false, error: "done" };
  const { error } = await db()
    .from("sla_followups")
    .update({ status: "done", done_by: f.me, done_at: new Date().toISOString(), note: String(note ?? "").trim().slice(0, 500) || null })
    .eq("id", f.row.id)
    .eq("status", "open");
  return error ? { ok: false, error: "failed" } : { ok: true };
}

/** «لوحتي»: the open follow-ups handed to me — no Teletel call, the list only. */
export async function myFollowups(): Promise<Followup[]> {
  const me = await getCurrentEmployeeId();
  if (!me) return [];
  const { data } = await db().from("sla_followups").select(FOLLOWUP_COLS).eq("assigned_to", me).eq("status", "open").order("assigned_at", { ascending: false }).limit(50);
  return ((data ?? []) as unknown as RawFollowup[]).map(shape);
}
