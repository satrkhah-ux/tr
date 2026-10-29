import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { parseAutoPhones } from "@/lib/murad/core";
import { addTeletelLabels, addTeletelNote, assignMuradHandoff, conversationEvents, intlPhone, listAssignableAgents, listLifecycleStages, listOpenConversations, setTeletelStatus, teletelGet, unassignTeletel, type OpenConversation } from "@/lib/providers/teletel";
import { closerOf, CONFIRMED_TRIP, decideReturn, durationText, externalTripEnd, heldSale, marksFollowed, phoneKey, staleToClose, TRAVEL_LABEL, travellerReturn, travellersToClose, travelUntil, type ClosedBy, type SaleFacts, type TravelFile } from "./lifecycle-rules";

// always the service role: the in-app «تحديث» runs the pull with a staff session, and closures are written by the system only
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/**
 * The conversation's life in Teletel (order 2, part C — the user, 2026-10-22:
 * «اغلاق المحادثات و ارجاعها للموظف التي كانت لديه … نظام تليتيل»):
 *   · resolved by an employee → when the client writes again it goes back to THAT employee;
 *   · resolved by the system (stale, nobody waiting on us) → it comes back unassigned, as a new request;
 *   · every closing kept (conversation_closures): who, when, why, and what happened on return.
 * client_leads.conversation_state says where each one stands, for «الشاشات» and /m (order 3).
 * The rules are lifecycle-rules.ts; this file does them.
 */

/** «أرقام التجربة» of «إعدادات مُراد» and the client-WhatsApp trial number (murad/run.ts readSettings reads the same two) */
async function isMuradTestPhone(service: SupabaseClient, raw: string | null): Promise<boolean> {
  const phone = raw ? intlPhone(raw) : null;
  if (!phone) return false;
  const { data } = await service.from("app_settings").select("key, value").in("key", ["murad_auto_phones", "client_whatsapp_test_phone"]);
  const v = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return parseAutoPhones(v.get("murad_auto_phones")).includes(phone) || intlPhone(v.get("client_whatsapp_test_phone") ?? "") === phone;
}

type Closure = { id: string; conversation_id: number; closed_at: string; closed_by_kind: ClosedBy; closed_by_agent_id: number | null; closed_by_name: string | null; travel_operation_id: string | null; travel_external_id: string | null; travel_until: string | null };

/**
 * The pull saw a conversation leave Teletel's open list: who resolved it, from
 * Teletel's own «تم تحديث حالة المحادثة لـ"مغلقة" بواسطة X». A closing the
 * system recorded itself (closeStale) is already there and stays the system's.
 */
export async function recordClosed(conversationId: number, assigneeId: number | null, inboxId: number | null, requireCloser = false): Promise<ClosedBy | null> {
  const service = db();
  const { data: open } = await service.from("conversation_closures").select("closed_by_kind").eq("conversation_id", conversationId).is("reopened_at", null).maybeSingle();
  if (open) return (open as { closed_by_kind: ClosedBy }).closed_by_kind;
  const [events, agents] = await Promise.all([conversationEvents(conversationId), listAssignableAgents(inboxId)]);
  const closer = closerOf(events ?? [], Math.floor(Date.now() / 1000), agents);
  // the webhook may come before Teletel writes its «…مغلقة بواسطة X» line: no guess then, the pull decides
  if (!closer && requireCloser) return null;
  const kind: ClosedBy = closer ? "employee" : "system";
  const closedAt = new Date((closer?.at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const { error } = await service.from("conversation_closures").insert({
    conversation_id: conversationId,
    closed_at: closedAt,
    closed_by_kind: kind,
    closed_by_agent_id: closer?.agentId ?? null,
    closed_by_name: closer?.name ?? null,
    assignee_agent_id: assigneeId,
    reason: closer ? null : "أُغلقت في تيلي تيل دون موظف معروف",
  });
  if (error) return null;
  await service
    .from("client_leads")
    .update({ conversation_state: kind === "employee" ? "closed_by_employee" : "closed_by_system", closed_at: closedAt, closed_by_kind: kind, closed_by_name: closer?.name ?? null })
    .eq("teletel_conversation_id", conversationId);
  return kind;
}

/**
 * The client wrote to a conversation we saw closed: back to the employee who
 * closed it, or — the system's closing — unassigned, so Teletel's own intake
 * (and «مُراد»'s reception) takes it as a new request. Once per closing.
 */
export async function onClientReturn(conversationId: number, atSec: number, byClient = true): Promise<"returned_to_employee" | "returned_to_file_owner" | "unassigned" | "kept" | null> {
  const service = db();
  const { data } = await service
    .from("conversation_closures")
    .select("id, conversation_id, closed_at, closed_by_kind, closed_by_agent_id, closed_by_name, travel_operation_id, travel_external_id, travel_until")
    .eq("conversation_id", conversationId)
    .is("reopened_at", null)
    .lte("closed_at", new Date(atSec * 1000).toISOString())
    .maybeSingle();
  const closure = data as Closure | null;
  if (!closure) return null;
  // claimed: the webhook and the pull may both see the same return
  const reopenedAt = new Date(atSec * 1000).toISOString();
  const { data: claimed } = await service.from("conversation_closures").update({ reopened_at: reopenedAt }).eq("id", closure.id).is("reopened_at", null).select("id").maybeSingle();
  if (!claimed) return null;
  // a colleague reopened it themselves (nobody waiting on us): theirs, nothing moved
  if (!byClient) {
    await service.from("conversation_closures").update({ reopen_action: "kept" }).eq("id", closure.id);
    await service.from("client_leads").update({ conversation_state: "open", closed_at: null, closed_by_kind: null, closed_by_name: null }).eq("teletel_conversation_id", conversationId);
    return "kept";
  }
  const conv = await teletelGet<{ meta?: { assignee?: { id?: number; name?: string } | null; team?: { id?: number } | null; sender?: { phone_number?: string | null; lifecycle_stage_id?: number | null } | null } }>(`/conversations/${conversationId}`);
  const assigneeId = conv?.meta?.assignee?.id ?? null;
  // Murad's test numbers come back unassigned, a new request: the owner tests on them, never an employee's (2026-10-23:
  // 5050 went to its test trip's owner on «مرحبا» — «لا تسندها لموظف»)
  const test = await isMuradTestPhone(service, conv?.meta?.sender?.phone_number ?? null);
  // a traveller before the return + 3 days: the trip's owner (who holds the file NOW); after, the normal rules
  const file = closure.travel_until && !test ? await travelFileOf(service, closure) : null;
  const travel = closure.travel_until && !test ? travellerReturn(closure.travel_until, riyadhDay(atSec), file?.ownerAgentId ?? null, assigneeId) : null;
  // a client who bought, held by an employee: it stays with them — never unassigned, never moved (the owner, 2026-10-29)
  const facts = test || !assigneeId ? null : await saleFacts();
  const kept = !test && assigneeId !== null && (facts === null || heldSale({ assigneeId, phone: conv?.meta?.sender?.phone_number ?? null, stageId: conv?.meta?.sender?.lifecycle_stage_id ?? null }, facts));
  const decision = test ? ({ act: "unassign" } as const) : kept ? ({ act: "keep" } as const) : (travel ?? decideReturn(closure, assigneeId));
  let done = true;
  if (decision.act === "assign") done = await assignMuradHandoff(conversationId, null, decision.agentId);
  if (decision.act === "unassign") done = await unassignTeletel(conversationId);
  const action = kept ? "returned_to_employee" : travel ? "returned_to_file_owner" : decision.act === "unassign" ? "unassigned" : "returned_to_employee";
  const to = decision.act === "assign" ? decision.agentId : decision.act === "keep" ? (travel || kept ? assigneeId : (closure.closed_by_agent_id ?? assigneeId)) : null;
  await service
    .from("conversation_closures")
    .update({ reopen_action: action, reopened_to_agent_id: to, ...(done ? {} : { reason: "تعذّر الإسناد عند العودة" }) })
    .eq("id", closure.id);
  await service.from("client_leads").update({ conversation_state: "waiting", status: "open", closed_at: null, closed_by_kind: null, closed_by_name: null }).eq("teletel_conversation_id", conversationId);
  const failed = done ? "" : " (تعذّر الإسناد — أسندها يدوياً)";
  const trip = file?.destination ? ` (${file.destination})` : file?.serial ? ` (${file.serial})` : "";
  await addTeletelNote(
    conversationId,
    test
      ? "🧪 رقم تجربة مُراد — عاد بعد الإغلاق طلباً جديداً غير مسند."
      : kept
        ? `🔒 عاد العميل — المحادثة باقية مع ${conv?.meta?.assignee?.name ?? "موظفها"}: العميل اشترى منّا، فلا يغلقها النظام ولا ينقلها.`
        : action === "returned_to_file_owner"
      ? `✈️ عاد العميل المسافر${trip} — المحادثة لصاحب الرحلة ${file?.ownerName ?? ""}، وليست طلباً جديداً${failed}.`
      : action === "unassigned"
        ? "🔁 عاد العميل بعد إغلاق آلي — المحادثة طلب جديد غير مسند."
        : `🔁 عاد العميل — أُعيدت المحادثة إلى ${closure.closed_by_name ?? "الموظف"} الذي أغلقها${failed}.`,
  );
  return action;
}

/**
 * The webhook's «conversation_status_changed» (api/teletel/webhook): resolved now —
 * the closer kept at once, so a client writing a minute later already goes back
 * to them. A few seconds first: Teletel writes its activity line after the change.
 */
export async function conversationResolved(body: Record<string, unknown>): Promise<void> {
  const id = Number(body["id"]);
  if (!id || body["status"] !== "resolved") return;
  const meta = (body["meta"] ?? {}) as { assignee?: { id?: number } | null };
  await new Promise((r) => setTimeout(r, 5000));
  await recordClosed(id, meta.assignee?.id ?? null, typeof body["inbox_id"] === "number" ? (body["inbox_id"] as number) : null, true);
}

/** The webhook's entry: an incoming client message (api/teletel/webhook). */
export async function clientWrote(conversationId: number, atSec: number): Promise<void> {
  if (conversationId) await onClientReturn(conversationId, atSec);
}

/** Murad keeps out of a conversation that came back to its employee or its trip's owner this visit (reception-run.ts). */
export async function returnedToEmployee(conversationId: number, sinceSec: number): Promise<boolean> {
  const service = db();
  const { count } = await service
    .from("conversation_closures")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .in("reopen_action", ["returned_to_employee", "returned_to_file_owner"])
    .gte("reopened_at", new Date(sinceSec * 1000).toISOString());
  return Boolean(count);
}

// ---------- the trips a client is confirmed on: operations files and «المؤكدون خارج النظام» ----------

const riyadhDay = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
type Emp = { arabic_name: string | null; teletel_agent_id: number | null } | null;
type RawOperation = { id: string; travel_start: string | null; travel_end: string | null; assignee: Emp; offers: { serial: string | null; seller: Emp; customers: { mobile: string | null; second_mobile: string | null } | null } | null };
type RawExternal = { id: string; phone: string; travel_start: string; days: number; destination: string; employees: Emp };
const OPERATION = "id, travel_start, travel_end, assignee:employees!operations_assignee_id_fkey(arabic_name, teletel_agent_id), offers(serial, seller:employees!offers_employee_id_fkey(arabic_name, teletel_agent_id), customers!offers_customer_id_fkey(mobile, second_mobile))";
const EXTERNAL = "id, phone, travel_start, days, destination, employees(arabic_name, teletel_agent_id)";

/** the file's owner: its operations employee when they are on Teletel, else the seller */
function fromOperation(o: RawOperation): TravelFile | null {
  if (!o.travel_end) return null;
  const owner = o.assignee?.teletel_agent_id ? o.assignee : (o.offers?.seller ?? o.assignee);
  const phones = [o.offers?.customers?.mobile, o.offers?.customers?.second_mobile].filter((p): p is string => Boolean(p));
  return { source: "operation", id: o.id, serial: o.offers?.serial ?? null, destination: null, travelStart: o.travel_start, travelEnd: o.travel_end, phones, ownerName: owner?.arabic_name ?? null, ownerAgentId: owner?.teletel_agent_id ?? null };
}
const fromExternal = (e: RawExternal): TravelFile => ({ source: "external", id: e.id, serial: null, destination: e.destination, travelStart: e.travel_start, travelEnd: externalTripEnd(e.travel_start, e.days), phones: [e.phone], ownerName: e.employees?.arabic_name ?? null, ownerAgentId: e.employees?.teletel_agent_id ?? null });

/** confirmed trips not over by more than 3 days — a client with no trip here follows the normal rules */
async function travelFiles(service: SupabaseClient, today: string): Promise<TravelFile[]> {
  const back = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const [ops, ext] = await Promise.all([
    service.from("operations").select(OPERATION).in("client_status", CONFIRMED_TRIP).neq("execution_status", "cancelled").gte("travel_end", back(3)),
    service.from("external_trips").select(EXTERNAL).neq("status", "cancelled").gte("travel_start", back(368)),
  ]);
  return [
    ...((ops.data ?? []) as unknown as RawOperation[]).map(fromOperation).filter((f): f is TravelFile => f !== null),
    ...((ext.data ?? []) as unknown as RawExternal[]).map(fromExternal),
  ];
}

async function travelFileOf(service: SupabaseClient, c: Closure): Promise<TravelFile | null> {
  if (c.travel_operation_id) {
    const { data } = await service.from("operations").select(OPERATION).eq("id", c.travel_operation_id).maybeSingle();
    return data ? fromOperation(data as unknown as RawOperation) : null;
  }
  if (c.travel_external_id) {
    const { data } = await service.from("external_trips").select(EXTERNAL).eq("id", c.travel_external_id).maybeSingle();
    return data ? fromExternal(data as unknown as RawExternal) : null;
  }
  return null;
}

// ---------- a sale stays with its employee (lifecycle-rules.ts heldSale) ----------

let factsCache: { at: number; facts: SaleFacts } | null = null;

/**
 * heldSale's facts — the mobiles of every confirmed or completed trip (operations files and the ones entered by
 * hand) and Teletel's «won» stages — kept a minute. Null when our own files cannot be read: callers then hold still.
 * ponytail: every trip's phones in memory; a normalized phone column when the trips run to the tens of thousands.
 */
export async function saleFacts(): Promise<SaleFacts | null> {
  if (factsCache && Date.now() - factsCache.at < 60_000) return factsCache.facts;
  const service = db();
  const [ops, ext, stages] = await Promise.all([
    service.from("operations").select("offers(customers!offers_customer_id_fkey(mobile, second_mobile))").in("client_status", [...CONFIRMED_TRIP, "completed"]).neq("execution_status", "cancelled"),
    service.from("external_trips").select("phone").neq("status", "cancelled"),
    listLifecycleStages(),
  ]);
  if (ops.error || ext.error) return null;
  const phones = new Set<string>();
  const add = (p: string | null | undefined) => {
    const k = phoneKey(p);
    if (k) phones.add(k);
  };
  for (const o of (ops.data ?? []) as unknown as { offers: { customers: { mobile: string | null; second_mobile: string | null } | null } | null }[]) {
    add(o.offers?.customers?.mobile);
    add(o.offers?.customers?.second_mobile);
  }
  for (const e of (ext.data ?? []) as { phone: string }[]) add(e.phone);
  const facts: SaleFacts = { phones, wonStages: new Set<number>((stages as { id: number; category: string }[]).filter((x) => x.category === "won").map((x) => x.id)) };
  factsCache = { at: Date.now(), facts };
  return facts;
}

/**
 * The employee a conversation stays with because the client bought (heldSale), read from Teletel now — null when it
 * may move. Every hand-over Murad makes asks this first (murad/handover.ts), and so do his reception and the
 * withdrawal after a warning letter.
 */
export async function saleHolder(conversationId: number): Promise<{ agentId: number; name: string | null } | null> {
  const conv = await teletelGet<{ meta?: { assignee?: { id?: number; name?: string } | null; sender?: { phone_number?: string | null; lifecycle_stage_id?: number | null } | null } }>(`/conversations/${conversationId}`);
  const holder = conv?.meta?.assignee?.id ?? null;
  if (!holder) return null;
  const facts = await saleFacts();
  const held = !facts || heldSale({ assigneeId: holder, phone: conv?.meta?.sender?.phone_number ?? null, stageId: conv?.meta?.sender?.lifecycle_stage_id ?? null }, facts);
  return held ? { agentId: holder, name: conv?.meta?.assignee?.name ?? null } : null;
}

// ---------- «@#@#@#»: the employee followed it up (lifecycle-rules.ts followedSince) ----------

/**
 * A colleague's private note with the code (the webhook, the moment it is written; the pull as a fallback): kept
 * on the conversation's row in «العملاء» — only a newer mark replaces an older one.
 */
export async function markFollowed(conversationId: number, atSec: number, by: string | null): Promise<void> {
  if (!conversationId || !atSec) return;
  const at = new Date(atSec * 1000).toISOString();
  await db()
    .from("client_leads")
    .update({ followed_at: at, followed_by: by })
    .eq("teletel_conversation_id", conversationId)
    .or(`followed_at.is.null,followed_at.lt.${at}`);
}

/** The webhook's private note: the code in it marks the conversation followed. */
export async function noteWritten(conversationId: number, atSec: number, text: string | null | undefined, by: string | null): Promise<void> {
  if (marksFollowed(text)) await markFollowed(conversationId, atSec, by);
}

/**
 * Each conversation's latest mark, for a reminder to check before it goes out. Empty when it cannot be read (the
 * column not there yet included): a reminder is then sent as before — never silenced by our own failure.
 */
export async function followedMarks(conversationIds: readonly number[]): Promise<Map<number, string>> {
  const ids = [...new Set(conversationIds.filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (!ids.length) return new Map();
  const { data, error } = await db().from("client_leads").select("teletel_conversation_id, followed_at").in("teletel_conversation_id", ids).not("followed_at", "is", null);
  if (error) return new Map();
  return new Map(((data ?? []) as { teletel_conversation_id: number; followed_at: string }[]).map((r) => [Number(r.teletel_conversation_id), r.followed_at]));
}

// ---------- the system's closings ----------

/** One closing by the system: recorded before Teletel is asked (the pull then reads it as the system's), undone if Teletel refuses. */
async function closeOne(service: SupabaseClient, c: OpenConversation, reason: string, note: string, travel: TravelFile | null): Promise<boolean> {
  const { data, error } = await service
    .from("conversation_closures")
    .insert({
      conversation_id: c.id,
      closed_at: new Date().toISOString(),
      closed_by_kind: "system",
      closed_by_name: "النظام",
      assignee_agent_id: c.assigneeId,
      reason,
      ...(travel ? { [travel.source === "operation" ? "travel_operation_id" : "travel_external_id"]: travel.id, travel_until: travelUntil(travel.travelEnd) } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return false;
  await addTeletelNote(c.id, note);
  if (travel) await addTeletelLabels(c.id, [TRAVEL_LABEL]);
  if (!(await setTeletelStatus(c.id, "resolved"))) {
    await service.from("conversation_closures").delete().eq("id", (data as { id: string }).id);
    return false;
  }
  await service
    .from("client_leads")
    .update({ status: "closed", delay: null, conversation_state: travel ? "travelling" : "closed_by_system", closed_at: new Date().toISOString(), closed_by_kind: "system", closed_by_name: "النظام" })
    .eq("teletel_conversation_id", c.id);
  return true;
}

/**
 * The 5-minute pull's closings («إدارة المحادثات»), a few a run, never a client
 * waiting on us: first the confirmed travellers («مؤكد — مسافر قريباً», the
 * user's approval 2026-10-22), then — when a time is set — the conversations
 * idle that long where WE spoke last. A traveller's is never closed as a plain one.
 */
export async function closeIdle(opts: { hours: number | null; travellers: boolean }, limit = 20): Promise<{ travellers: number; idle: number }> {
  const out = { travellers: 0, idle: 0 };
  if (!opts.hours && !opts.travellers) return out;
  const service = db();
  const list = await listOpenConversations(true);
  if (!list) return out;
  const nowSec = Math.floor(Date.now() / 1000);
  const today = riyadhDay(nowSec);
  // never a conversation an employee holds once the client bought (the owner, 2026-10-29: 39733 was closed seven
  // times by the travellers' class while its seller worked it); our files unreadable: no closing this run
  const facts = await saleFacts();
  if (!facts) return out;
  const free = list.rows.filter((c) => !heldSale(c, facts));
  const files = opts.travellers ? await travelFiles(service, today) : [];
  for (const { c, file } of travellersToClose(free, files, nowSec, today).slice(0, limit)) {
    const trip = [file.destination, file.serial].filter(Boolean).join(" · ") || "رحلة مؤكدة";
    const note = `✈️ مؤكد — مسافر قريباً (${trip}، ${file.travelStart ?? "؟"} ← ${file.travelEnd}). أُغلقت المحادثة؛ إذا كتب العميل حتى ${travelUntil(file.travelEnd)} تعود مباشرة إلى ${file.ownerName ?? "صاحب الرحلة"}.`;
    if (await closeOne(service, c, "مؤكد — مسافر قريباً", note, file)) out.travellers += 1;
  }
  if (opts.hours) {
    const travelling = new Set(files.filter((f) => today <= travelUntil(f.travelEnd)).flatMap((f) => f.phones.map((p) => phoneKey(p))).filter((k): k is string => k !== null));
    const idle = free.filter((c) => !travelling.has(phoneKey(c.phone) ?? ""));
    for (const c of staleToClose(idle, nowSec, opts.hours).slice(0, limit)) {
      const note = `🤖 أُغلقت آلياً («إدارة المحادثات»): لا رد منذ ${durationText(opts.hours)} وآخر رسالة منّا. إذا كتب العميل تعود طلباً جديداً.`;
      if (await closeOne(service, c, `لا رد منذ ${durationText(opts.hours)} وآخر رسالة منّا`, note, null)) out.idle += 1;
    }
  }
  return out;
}
