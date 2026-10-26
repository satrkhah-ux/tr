"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan, currentPermissions, currentRealPermissions } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { listOpenConversations, teletelConversationUrl } from "@/lib/providers/teletel";
import { followupPeople } from "@/lib/followups/service";
import { loadSettings, myDay, SETTINGS_KEY } from "@/lib/mine/day";
import { dayCounts, parseSettings, type DayItem, type DaySettings } from "@/lib/mine/rank";

/**
 * «متابعتي» (the owner, 2026-10-25) — each seller's own list, and the follow-up
 * team's view of everyone's. A seller (offers.write) reads and acts on their own
 * list only; the follow-up team and the administration (followups.work /
 * followups.manage / dashboard.admin / developer.access) may READ anyone's — never
 * act on it. Every read and write goes through the service client after that check.
 *
 * The administration sees every employee's real list (the owner, 2026-10-26: «اجعل
 * حساب الإدارة يشاهد كل الاختصاصات … وبشكل حقيقي»): opened with no one picked, the
 * list is the first colleague's when the account holds no Teletel conversations of
 * its own; and the picker stays while it looks through another role («عرض كموظف»),
 * because reading is the account's own right — acting stays with the list's owner.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const TEAM = ["followups.work", "followups.manage", "dashboard.admin", "developer.access"] as const;

async function who() {
  const [me, seller, now, real] = await Promise.all([getCurrentEmployeeId(), currentCan("offers.write"), currentPermissions(), currentRealPermissions()]);
  // board: the team page itself follows the role being looked through (section-access)
  return me ? { me, seller, team: TEAM.some((p) => now.includes(p) || real.includes(p)), board: TEAM.some((p) => now.includes(p)) } : null;
}

export type MyFollowupItem = DayItem & { url: string | null };
export type MyFollowupsView = {
  employeeId: string;
  name: string;
  /** another employee's list, opened by the follow-up team: nothing can be done on it */
  readOnly: boolean;
  /** the team may open anyone's list */
  team: boolean;
  /** the team board opens in the role being used now */
  board: boolean;
  items: MyFollowupItem[];
  settings: DaySettings;
  teletel: boolean;
  people: { id: string; name: string }[];
  /** when the list was read (ms): the page's clock, the same on the server and in the browser */
  at: number;
};

export async function getMyFollowups(employeeId?: string): Promise<MyFollowupsView | null> {
  const w = await who();
  if (!w || !(w.seller || w.team)) return null;
  // the picker: every colleague with Teletel conversations (sellers and the follow-up team), not the developer's account
  const people = w.team ? (await followupPeople()).filter((p) => p.person && p.agentId).sort((a, b) => Number(b.seller) - Number(a.seller) || a.name.localeCompare(b.name, "ar")) : [];
  const picked = employeeId && /^[0-9a-f-]{36}$/i.test(employeeId) ? employeeId : null;
  const target = picked ?? (w.team && !people.some((p) => p.id === w.me) && people[0] ? people[0].id : w.me);
  if (target !== w.me && !w.team) return null;
  const [day, { data: emp }] = await Promise.all([myDay(target), db().from("employees").select("arabic_name").eq("id", target).maybeSingle()]);
  if (!day) return null;
  return {
    employeeId: target,
    name: ((emp as { arabic_name?: string } | null)?.arabic_name ?? "").trim(),
    readOnly: target !== w.me,
    team: w.team,
    board: w.board,
    items: day.items.map((i) => ({ ...i, url: i.conversationId ? teletelConversationUrl(i.conversationId) : null })),
    settings: day.settings,
    teletel: day.teletel,
    people: people.map((p) => ({ id: p.id, name: p.name.trim() })),
    at: Date.now(),
  };
}

/** «أنجزت اليوم» — one done client: when, and how Murad knew (a «تمّت» press, a reply, an offer step acted on). */
export type DoneItem = { conversationId: number; name: string; at: string; how: "mark" | "replied" | "acted" };
export type SecretaryBoard = { view: MyFollowupsView; doneToday: DoneItem[]; yesterdayDone: number };

const riyadhDayStart = (nowMs: number, daysBack = 0) =>
  new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(nowMs - daysBack * 86_400_000) + "T00:00:00+03:00").toISOString();

/**
 * «سكرتيري الخاص» work screen: the day list PLUS what Murad sees as already
 * done — automatically, no button needed: the employee replied in Teletel (we
 * spoke last, today), acted on a follow-up (last_attempt_at / done_at today),
 * or pressed «تمّت». Derived on read from what the tables already say, so
 * nothing new is stored and nothing can drift.
 */
export async function getSecretaryBoard(employeeId?: string): Promise<SecretaryBoard | null> {
  const view = await getMyFollowups(employeeId);
  if (!view) return null;
  const nowMs = view.at;
  const today = riyadhDayStart(nowMs);
  const yesterday = riyadhDayStart(nowMs, 1);
  const service = db();
  const [{ data: emp }, { data: markRows }, { data: acted }] = await Promise.all([
    service.from("employees").select("teletel_agent_id").eq("id", view.employeeId).maybeSingle(),
    service.from("my_followup_marks").select("key, done_at").eq("employee_id", view.employeeId).gte("done_at", yesterday).like("key", "c:%"),
    service
      .from("sla_followups")
      .select("conversation_id, contact_name, last_attempt_at, done_at")
      .eq("assigned_to", view.employeeId)
      .or(`last_attempt_at.gte.${yesterday},done_at.gte.${yesterday}`),
  ]);
  const agentId = (emp as { teletel_agent_id: number | string | null } | null)?.teletel_agent_id;
  const open = agentId != null ? await listOpenConversations().catch(() => null) : null;

  const todayMap = new Map<number, DoneItem>();
  let yCount = 0;
  const add = (conversationId: number, name: string, at: string, how: DoneItem["how"]) => {
    if (at >= today) {
      const had = todayMap.get(conversationId);
      if (!had || at > had.at) todayMap.set(conversationId, { conversationId, name: name || `عميل #${conversationId}`, at, how });
    } else if (at >= yesterday) yCount += 1;
  };
  const nameOf = new Map(((acted ?? []) as { conversation_id: number; contact_name: string | null }[]).map((r) => [r.conversation_id, r.contact_name ?? ""]));
  for (const m of (markRows ?? []) as { key: string; done_at: string | null }[]) {
    const id = Number(m.key.slice(2));
    if (m.done_at && Number.isFinite(id)) add(id, nameOf.get(id) ?? "", m.done_at, "mark");
  }
  for (const r of (acted ?? []) as { conversation_id: number; contact_name: string | null; last_attempt_at: string | null; done_at: string | null }[]) {
    const at = [r.last_attempt_at, r.done_at].filter((x): x is string => Boolean(x)).sort().at(-1);
    if (at) add(r.conversation_id, r.contact_name ?? "", at, "acted");
  }
  for (const c of open?.rows ?? []) {
    if (c.assigneeId !== Number(agentId) || c.waitingSince) continue;
    const at = new Date(c.lastActivityAt * 1000).toISOString();
    if (at >= today) add(c.id, c.name, at, "replied");
  }
  // yesterday's Teletel replies are gone from the open list's clock — the count is marks + follow-up acts only
  return { view, doneToday: [...todayMap.values()].sort((a, b) => (a.at < b.at ? 1 : -1)), yesterdayDone: yCount };
}

/** the badge beside «متابعتي»: how many cards are on me now */
export async function getMyFollowupCount(): Promise<number> {
  const w = await who();
  if (!w?.seller) return 0;
  return (await myDay(w.me))?.items.length ?? 0;
}

type Done = { ok: true } | { ok: false; error: string };
const fail = (error: string): Done => ({ ok: false, error });
const KEY = /^(c|r):(\d{1,15})$/;

/** «تمّت»: a client's card goes until something new happens on it; a reminder is done for good. */
export async function markMyDone(key: string): Promise<Done> {
  const w = await who();
  const m = KEY.exec(key);
  if (!w?.seller || !m) return fail("forbidden");
  const now = new Date().toISOString();
  const { error } =
    m[1] === "c"
      ? await db().from("my_followup_marks").upsert({ employee_id: w.me, key, done_at: now, updated_at: now }, { onConflict: "employee_id,key" })
      : await db().from("my_followup_reminders").update({ done_at: now }).eq("id", Number(m[2])).eq("employee_id", w.me).is("done_at", null);
  return error ? fail("failed") : { ok: true };
}

/** «ذكّرني بعد…» on a client, or a reminder of my own (no client): due within two months. */
export async function remindMe(input: { conversationId: number | null; dueAt: string; text: string; doneKey?: string }): Promise<Done> {
  const w = await who();
  if (!w?.seller) return fail("forbidden");
  const due = Date.parse(input.dueAt);
  const text = (input.text ?? "").trim().slice(0, 500);
  if (!Number.isFinite(due) || due < Date.now() - 60_000 || due > Date.now() + 62 * 86_400_000) return fail("bad_date");
  if (input.conversationId === null && !text) return fail("empty");
  if (input.conversationId !== null && !(Number.isInteger(input.conversationId) && input.conversationId > 0)) return fail("forbidden");
  const { error } = await db().from("my_followup_reminders").insert({ employee_id: w.me, conversation_id: input.conversationId, text, due_at: new Date(due).toISOString() });
  if (error) return fail("failed");
  // a reminder snoozed again: the old one is done
  const m = input.doneKey ? KEY.exec(input.doneKey) : null;
  if (m?.[1] === "r") await db().from("my_followup_reminders").update({ done_at: new Date().toISOString() }).eq("id", Number(m[2])).eq("employee_id", w.me).is("done_at", null);
  return { ok: true };
}

export async function saveMyNote(conversationId: number, note: string): Promise<Done> {
  const w = await who();
  if (!w?.seller || !(Number.isInteger(conversationId) && conversationId > 0)) return fail("forbidden");
  const now = new Date().toISOString();
  const { error } = await db()
    .from("my_followup_marks")
    .upsert({ employee_id: w.me, key: `c:${conversationId}`, note: note.trim().slice(0, 1000) || null, updated_at: now }, { onConflict: "employee_id,key" });
  return error ? fail("failed") : { ok: true };
}

export async function saveMySettings(input: Partial<DaySettings>): Promise<Done & { settings?: DaySettings }> {
  const w = await who();
  if (!w?.seller) return fail("forbidden");
  const settings = parseSettings(JSON.stringify({ ...(await loadSettings(w.me)), ...input }));
  const { error } = await db().from("app_settings").upsert({ key: SETTINGS_KEY(w.me), value: JSON.stringify(settings), updated_at: new Date().toISOString() });
  return error ? fail("failed") : { ok: true, settings };
}

export type TeamRow = { id: string; name: string; total: number; waiting: number; late: number; hot: number; offers: number; lastSeen: string | null };

/**
 * «فريق المتابعة»: each seller's list in numbers — how much is on them, how much
 * is late (a client waiting past their own limit, or a follow-up step due since
 * yesterday), the hot ones, and when their system was last open.
 * ponytail: one myDay per seller (the open list is cached once); a single pass over all when the team grows past a few dozen.
 */
export async function getMyFollowupsTeam(): Promise<{ rows: TeamRow[]; at: number } | null> {
  const w = await who();
  if (!w?.team) return null;
  const people = (await followupPeople()).filter((p) => p.seller);
  const { data: seen } = await db().from("presence").select("employee_id,last_seen_at").in("employee_id", people.map((p) => p.id));
  const last = new Map(((seen ?? []) as { employee_id: string; last_seen_at: string }[]).map((s) => [s.employee_id, s.last_seen_at]));
  const now = Date.now();
  const rows = await Promise.all(
    people.map(async (p): Promise<TeamRow> => {
      const day = await myDay(p.id, now);
      const items = day?.items ?? [];
      const c = dayCounts(items);
      const late = items.filter(
        (i) => (i.kind === "waiting" && i.since !== null && now - i.since >= (day?.settings.waitMinutes ?? 15) * 60_000) || (i.kind === "offer" && i.since !== null && now - i.since >= 86_400_000),
      ).length;
      return { id: p.id, name: p.name.trim(), total: c.total, waiting: c.waiting, late, hot: items.filter((i) => i.heat === "hot").length, offers: c.offer, lastSeen: last.get(p.id) ?? null };
    }),
  );
  return { rows: rows.sort((a, b) => b.late - a.late || b.total - a.total), at: now };
}
