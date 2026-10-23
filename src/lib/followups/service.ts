import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listOpenConversations, recentResolvedConversations, teletelGet, type OpenConversation } from "@/lib/providers/teletel";
export async function followupRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[] }> {
  const data: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await page(from, from + 999);
    if (result.error) throw new Error("followup query unavailable");
    data.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return { data };
  }
}
import { grantedPermissions } from "@/lib/roles/roles";
import { CADENCE_MS, clientLine, isOfferRow, lastOffer, QUIET_MS, stepDue, stepFor, toOfferMsg, WORK_COLS, type RawThreadMsg, type WorkRow } from "./rules";

export const followupDb = () => createSupabaseServiceClient() as unknown as SupabaseClient;
/** Who may hold a follow-up: the follow-up team, its managers, and the sellers (their own offers). */
export async function followupPeople() {
  const { data, error } = await followupDb().from("employees").select("id,arabic_name,status,teletel_agent_id,extra_permission_keys,removed_permission_keys,roles(permission_keys)").eq("status", "Active");
  if (error) throw new Error("employees unavailable");
  type Person = { id: string; arabic_name: string; status: string; teletel_agent_id: number | null; extra_permission_keys: string[] | null; removed_permission_keys: string[] | null; roles: { permission_keys: string[] } | null };
  return ((data ?? []) as unknown as Person[]).filter((p) => {
    const keys = grantedPermissions({ ...p, permission_keys: p.roles?.permission_keys ?? [] });
    return keys.some((k) => ["followups.work", "followups.manage", "dashboard.admin", "developer.access", "offers.write"].includes(k));
  }).map((p) => ({ id: p.id, name: p.arabic_name, agentId: p.teletel_agent_id }));
}
/** The employee behind a Teletel agent: their own link (employees.teletel_agent_id), else the follow-up map. */
async function agentEmployees(people: Awaited<ReturnType<typeof followupPeople>>): Promise<(agentId: number | null) => string | null> {
  const { data } = await followupDb().from("followup_agent_map").select("agent_id,employee_id");
  const map = new Map<number, string>(((data ?? []) as { agent_id: number; employee_id: string }[]).map((m) => [m.agent_id, m.employee_id]));
  for (const p of people) if (p.agentId) map.set(p.agentId, p.id);
  const known = new Set(people.map((p) => p.id));
  return (agentId) => {
    const id = agentId === null ? undefined : map.get(agentId);
    return id && known.has(id) ? id : null;
  };
}
export async function followupTeamId(): Promise<number> {
  const { data, error } = await followupDb().from("app_settings").select("value").eq("key", "followup_team_id").maybeSingle();
  if (error) throw new Error("followup settings unavailable");
  const id = Number(data?.value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("followup team not configured");
  return id;
}
export async function enrollFollowup(c: OpenConversation, source: "manual" | "teletel" | "sla", reason: string, actor: string | null = null): Promise<string> {
  const db = followupDb();
  const { data: active, error: activeError } = await db.from("sla_followups").select("id").eq("conversation_id", c.id).eq("status", "open").maybeSingle();
  if (activeError) throw new Error("followup read failed");
  if (active) return String(active.id);
  const [{ data: lead }, byAgent] = await Promise.all([
    db.from("client_leads").select("last_visit_at,created_at").eq("teletel_conversation_id", c.id).maybeSingle(),
    followupPeople().then(agentEmployees),
  ]);
  const employee = byAgent(c.assigneeId);
  const { data, error } = await db.from("sla_followups").insert({
    conversation_id: c.id, contact_id: c.contactId, contact_name: c.name, contact_phone: c.phone,
    kind: "waiting", status: "open", stage: employee ? "working" : "new",
    assigned_to: employee, assigned_at: employee ? new Date().toISOString() : null, assigned_by: actor,
    teletel_assignee: c.assignee, source, source_team_id: c.teamId, transfer_reason: reason,
    request_started_at: new Date(Math.max(Date.parse(lead?.last_visit_at ?? lead?.created_at ?? "") || 0, c.waitingSince * 1000 || 0, c.createdAt * 1000)).toISOString(),
    last_client_at: c.waitingSince ? new Date(c.waitingSince * 1000).toISOString() : null,
    client_waiting: c.waitingSince > 0,
    external_status: "open",
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      const existing = await db.from("sla_followups").select("id").eq("conversation_id", c.id).eq("status", "open").single();
      if (existing.data) return String(existing.data.id);
    }
    throw new Error("followup enrollment failed");
  }
  return String(data.id);
}

/** conversations already read for an offer, at their last activity (a restart reads them once more) */
const offerChecked = new Map<number, number>();
// ponytail: a dozen threads a minute; a deploy's backlog of a few hundred clears within the hour
const THREADS_PER_RUN = 12;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * «المتابعة» follows offers (the owner, 2026-10-23): a conversation whose last
 * public message is ours, carries a price or a programme (lastOffer), and has
 * been quiet two hours becomes its seller's file — the seller being the Basic
 * offer's issuer when the message names its file number, else the agent who
 * sent the price, else the conversation's assignee. A client conversation
 * only (it has a client_leads row); never one the cadence is over for, nor an
 * offer a closed file already followed.
 */
async function enrolOffers(candidates: OpenConversation[], openIds: Set<number>, active: Map<number, WorkRow>, latestDone: Map<number, WorkRow>, now: number): Promise<number> {
  if (!candidates.length) return 0;
  const db = followupDb();
  const { data: leads } = await db.from("client_leads").select("teletel_conversation_id,destination").in("teletel_conversation_id", candidates.map((c) => c.id));
  const leadOf = new Map(((leads ?? []) as { teletel_conversation_id: number; destination: string | null }[]).map((l) => [Number(l.teletel_conversation_id), l]));
  const queue = candidates.filter((c) => leadOf.has(c.id)).sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, THREADS_PER_RUN);
  if (!queue.length) return 0;
  const byAgent = await followupPeople().then(agentEmployees);
  let added = 0;
  for (const c of queue) {
    const list = await teletelGet<{ payload?: RawThreadMsg[] }>(`/conversations/${c.id}/messages`);
    if (!list) continue;
    offerChecked.set(c.id, c.lastActivityAt);
    const messages = (list.payload ?? []).map(toOfferMsg).filter((m) => m !== null);
    const offer = lastOffer(messages);
    if (!offer || now - offer.lastAt * 1000 < QUIET_MS || now - offer.at * 1000 > CADENCE_MS) continue;
    const done = latestDone.get(c.id);
    if (done && offer.at * 1000 <= Date.parse(done.done_at ?? done.created_at)) continue;
    const serial = offer.serial;
    const { data: basic } = serial
      ? await db.from("offers").select("id,serial,status,employee_id,destination,total,currency").eq("serial", serial).maybeSingle()
      : { data: null };
    if (basic && ["confirmed", "cancelled"].includes(basic.status)) continue;
    const seller = basic?.employee_id ?? byAgent(offer.senderId) ?? byAgent(c.assigneeId);
    const offerAt = offer.at * 1000;
    const step = stepFor(offerAt, now);
    const fields = {
      source: basic ? "offer" : "price",
      offer_id: basic?.id ?? null,
      offer_at: iso(offerAt),
      offer_line: basic ? [basic.serial, basic.total ? `${Number(basic.total).toLocaleString("en-US")} ${basic.currency ?? ""}`.trim() : ""].filter(Boolean).join(" · ") : offer.text.replace(/\s+/g, " ").slice(0, 160),
      destination: basic?.destination ?? leadOf.get(c.id)?.destination ?? null,
      step,
      next_followup_at: iso(stepDue(step, offerAt, offer.lastAt * 1000)),
      client_line: clientLine(messages),
      client_waiting: false,
      transfer_reason: "عرض سعر بلا رد من العميل",
      request_started_at: iso(offerAt),
      last_synced_at: iso(now),
      external_status: openIds.has(c.id) ? "open" : "resolved",
    };
    const old = active.get(c.id);
    if (old) {
      // the old intake list or a team transfer: it becomes this offer's file, its history kept
      await db.from("sla_followups").update({ ...fields, assigned_to: old.assigned_to ?? seller, stage: (old.assigned_to ?? seller) ? "waiting" : "new" }).eq("id", old.id).eq("status", "open").is("step", null);
    } else {
      const { error } = await db.from("sla_followups").insert({
        ...fields, conversation_id: c.id, contact_id: c.contactId, contact_name: c.name, contact_phone: c.phone,
        kind: "waiting", status: "open", stage: seller ? "waiting" : "new",
        assigned_to: seller, assigned_at: seller ? iso(now) : null, teletel_assignee: c.assignee, source_team_id: c.teamId,
      });
      if (error && error.code !== "23505") throw new Error("followup offer enrollment failed");
    }
    added++;
  }
  return added;
}

/** An offer confirmed (a booking) or cancelled in Basic closes its file. */
async function closeSettled(rows: WorkRow[], nowIso: string) {
  const open = rows.filter((r) => r.status === "open" && r.offer_id);
  if (!open.length) return;
  const db = followupDb();
  const { data } = await db.from("offers").select("id,status").in("id", open.map((r) => r.offer_id)).in("status", ["confirmed", "cancelled"]);
  for (const o of (data ?? []) as { id: string; status: string }[]) {
    const won = o.status === "confirmed";
    for (const r of open.filter((x) => x.offer_id === o.id)) {
      await db.from("sla_followups").update({
        status: "done", stage: "completed", done_at: nowIso, outcome: won ? "completed" : "not_completed",
        close_reason: won ? "حجز" : "أخرى", note: won ? "أكّد العميل الحجز" : "أُلغي العرض", next_followup_at: null,
      }).eq("id", r.id).eq("status", "open").is("send_lock", null);
    }
  }
}

/** Read-only Teletel synchronization. No messages, team moves, or SLA activation. */
export async function syncFollowups() {
  const db = followupDb();
  const [teamId, fetched, resolved, { data: stored }] = await Promise.all([
    followupTeamId(), listOpenConversations(true), recentResolvedConversations(2),
    followupRows((a, b) => db.from("sla_followups").select(WORK_COLS).order("created_at").range(a, b)),
  ]);
  if (!fetched) throw new Error("followup sync unavailable");
  const rows = (stored ?? []) as WorkRow[];
  const active = new Map(rows.filter((r) => r.status === "open").map((r) => [r.conversation_id, r]));
  const latestDone = new Map<number, WorkRow>();
  for (const row of rows) if (row.status === "done") {
    const prev = latestDone.get(row.conversation_id);
    if (!prev || Date.parse(row.done_at ?? row.created_at) > Date.parse(prev.done_at ?? prev.created_at)) latestDone.set(row.conversation_id, row);
  }
  let added = 0, awakened = 0;
  const nowMs = Date.now();
  const now = iso(nowMs);
  // an offer's thread is worth reading: we spoke last, two hours ago or more, inside the cadence, changed since we looked
  const quietAfterUs = (c: OpenConversation) => {
    const row = active.get(c.id);
    const idle = nowMs - c.lastActivityAt * 1000;
    return !(row && isOfferRow(row)) && !c.waitingSince && idle >= QUIET_MS && idle <= CADENCE_MS && offerChecked.get(c.id) !== c.lastActivityAt;
  };
  const candidates = [...fetched.rows, ...(resolved ?? [])].filter(quietAfterUs);
  for (const c of fetched.rows) {
    const row = active.get(c.id);
    // the team transfers (the follow-up team in Teletel) stay; the unclear intake no longer comes here (the owner, 2026-10-23)
    if (!row && c.teamId === teamId) {
      const done = latestDone.get(c.id);
      if (done && c.waitingSince * 1000 <= Date.parse(done.done_at ?? done.created_at)) continue;
      await enrollFollowup(c, "teletel", done ? "عودة العميل بطلب جديد" : "تحويل إلى فريق متابعة المبيعات");
      added++;
    } else if (row) {
      const patch: Record<string, unknown> = { last_synced_at: now, external_status: "open" };
      const incomingAt = c.waitingSince ? new Date(c.waitingSince * 1000).toISOString() : null;
      if (incomingAt && Date.parse(incomingAt) > Date.parse(row.last_client_at ?? row.created_at)) {
        patch.last_client_at = incomingAt;
        patch.client_waiting = true;
        if (c.preview) patch.client_line = c.preview;
        if (["waiting", "scheduled"].includes(row.stage)) { patch.stage = row.assigned_to ? "working" : "new"; patch.next_followup_at = null; awakened++; }
      } else if (!c.waitingSince && row.client_waiting) {
        // answered in Teletel: the cadence goes on from that answer
        patch.client_waiting = false;
        if (isOfferRow(row) && !row.next_followup_at && row.offer_at) {
          patch.stage = "waiting";
          patch.next_followup_at = iso(stepDue(row.step ?? 0, Date.parse(row.offer_at), nowMs));
        }
      }
      if (row.source === "teletel" && c.teamId !== teamId && !row.send_lock) {
        patch.external_status = "transferred";
        patch.status = "done"; patch.stage = "transferred"; patch.done_at = now;
        patch.outcome = "transferred"; patch.note = "نُقلت المحادثة إلى قسم آخر في Teletel";
      }
      let query = db.from("sla_followups").update(patch).eq("id", row.id).eq("status", "open").eq("stage", row.stage);
      query = row.last_client_at ? query.eq("last_client_at", row.last_client_at) : query.is("last_client_at", null);
      query = row.last_attempt_at ? query.eq("last_attempt_at", row.last_attempt_at) : query.is("last_attempt_at", null);
      // A staff action / pending send wins over this snapshot.
      if (patch.stage) query = query.is("send_lock", null);
      const { error: updateError } = await query;
      if (updateError) throw new Error("followup sync update failed");
    }
  }
  const openIds = new Set(fetched.rows.map((c) => c.id));
  added += await enrolOffers(candidates, openIds, active, latestDone, nowMs);
  await closeSettled(rows, now);
  for (const row of rows.filter((r) => r.status === "open" && !openIds.has(r.conversation_id)).sort((a, b) => Date.parse(a.last_synced_at ?? a.created_at) - Date.parse(b.last_synced_at ?? b.created_at)).slice(0, 25)) {
    const conversation = await teletelGet<{ status?: string }>(`/conversations/${row.conversation_id}`);
    if (conversation) await db.from("sla_followups").update({ external_status: conversation.status ?? "unknown", last_synced_at: now }).eq("id", row.id);
  }
  return { added, awakened, scanned: fetched.rows.length };
}

/** Authenticated incoming webhook; the database serializes it with staff work. */
export async function wakeFollowup(conversationId: number, at: number, text = "") {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0 || !Number.isFinite(at)) return;
  const { error } = await followupDb().rpc("followup_wake", { p_conversation: conversationId, p_at: new Date(at * 1000).toISOString(), p_text: text.slice(0, 200) || null });
  if (error) throw new Error("followup wake failed");
}
