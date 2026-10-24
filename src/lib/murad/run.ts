import { parseControl, inMuradScope, type MuradControl } from "./control";
import { readRequest } from "./reception";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getFeatureFlags } from "@/lib/features-server";
import {
  addTeletelLabels,
  addTeletelNote,
  getTeletelConfig,
  inferDestinations,
  intlPhone,
  listOpenConversations,
  sendTeletelMessage,
  teletelGet,
  type OpenConversation,
} from "@/lib/providers/teletel";
import { getClientTrip } from "@/lib/data/client-trip";
import { getClientHub } from "@/lib/data/operation-hub";
import { getTripGuide } from "@/lib/data/destination-guides";
import { paidState } from "@/lib/operations/wizard/payment";
import { DOCUMENT_LABEL } from "@/lib/operations/voucher-dto";
import {
  autoNote,
  muradMessageIds,
  noteFor,
  capFor,
  clientTurn,
  decide,
  isCandidate,
  isHumanReply,
  maskPhone,
  MURAD_LABEL,
  parseAutoPhones,
  SETTING,
  suggestionNote,
  toTurnMessage,
  turnKey,
  type MuradContext,
  type MuradFile,
  type MuradReadyOffer,
  type RawMessage,
  type TurnMessage,
} from "./core";
import { muradProvider, muradReply, type MuradProvider } from "./model";
import { handOver } from "./handover";
import { lessonsText, relevantLessons } from "./lessons-text";

/**
 * The minute job behind POST /api/murad/run (core.ts says when Murad acts).
 *
 * Cheap on Teletel by design: the open list is the SLA board's own cached copy
 * (listOpenConversations — never a forced re-read of its 26 pages), and a
 * thread is read only for a conversation that is a candidate AND changed since
 * it was last read; fifteen a run at most.
 *
 * Safe to run every minute and to overlap: a lease row in app_settings keeps a
 * second run out, and the turn is CLAIMED in murad_log (unique per client
 * message) before the model is called — so a turn is answered at most once,
 * whatever happens, and the model is never asked twice about it.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

const READS_PER_RUN = 15;
/** stop starting new work after this: the route's maxDuration is 60 s */
const RUN_BUDGET_MS = 25_000;
const LOCK_KEY = "murad_run_lock";
const LEASE_MS = 2 * 60_000;

const site = () => (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const riyadhDayStart = () => new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })}T00:00:00+03:00`).toISOString();

// ---------- Teletel: one thread, with what the helpers in teletel.ts leave out ----------

type RawConversation = { inbox_id?: number; can_reply?: boolean; labels?: string[]; meta?: { team?: { id?: number }; sender?: { name?: string | null; phone_number?: string | null } } };

export type FreshThread = { inboxId?: number | null; teamId?: number | null; messages: TurnMessage[]; canReply: boolean; phone: string; name: string; labels: string[] };

/** The latest messages (the API's last page) and the conversation itself — read now, not from the list's copy. */
export async function readThread(conversationId: number): Promise<FreshThread | null> {
  const [list, conv] = await Promise.all([
    teletelGet<{ payload?: RawMessage[] }>(`/conversations/${conversationId}/messages`),
    teletelGet<RawConversation>(`/conversations/${conversationId}`),
  ]);
  if (!list || !conv) return null;
  return {
    inboxId: conv.inbox_id ?? null,
    teamId: conv.meta?.team?.id ?? null,
    messages: (list.payload ?? []).map(toTurnMessage).filter((m): m is TurnMessage => m !== null),
    canReply: conv.can_reply === true,
    phone: conv.meta?.sender?.phone_number ?? "",
    name: conv.meta?.sender?.name?.trim() ?? "",
    labels: Array.isArray(conv.labels) ? conv.labels : [],
  };
}

// ---------- settings, lease, log ----------

type Settings = { control: MuradControl; clientWhatsapp: string | null; autoList: string[]; policies: string; visaFaq: string; cap: number };

export async function readSettings(service: SupabaseClient): Promise<Settings & { autoPhones: string[]; testPhone: string | null }> {
  const [{ data }, taught, taughtVisa] = await Promise.all([
    service.from("app_settings").select("key, value").in("key", Object.values(SETTING)),
    lessonsText(service).catch(() => ""),
    lessonsText(service, "تأشيرات").catch(() => ""),
  ]);
  const v = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const autoPhones = parseAutoPhones(v.get(SETTING.autoPhones));
  const testPhone = intlPhone(v.get(SETTING.testPhone) ?? "");
  return {
    control: parseControl(v.get(SETTING.control)),
    clientWhatsapp: v.get(SETTING.clientWhatsapp) ?? null,
    // the auto list: the owner's test number (the client-WhatsApp trial's) and the developer's list
    autoList: [...new Set([...(testPhone ? [testPhone] : []), ...autoPhones])],
    autoPhones,
    testPhone,
    // what the management taught Murad sits beside the company's own words (lessons-text.ts)
    policies: [v.get(SETTING.policies) ?? "", taught].filter(Boolean).join("\n\n"),
    visaFaq: [v.get(SETTING.visaFaq) ?? "", taughtVisa].filter(Boolean).join("\n\n"),
    cap: capFor(v.get(SETTING.cap)),
  };
}

/** A lease, not a lock: a run that died holds it two minutes at most. */
async function takeLease(service: SupabaseClient, runId: string): Promise<boolean> {
  const now = new Date();
  const { error } = await service.from("app_settings").insert({ key: LOCK_KEY, value: runId, updated_at: now.toISOString() });
  if (!error) return true;
  const { data } = await service
    .from("app_settings")
    .update({ value: runId, updated_at: now.toISOString() })
    .eq("key", LOCK_KEY)
    .lt("updated_at", new Date(now.getTime() - LEASE_MS).toISOString())
    .select("key");
  return (data?.length ?? 0) > 0;
}

async function dropLease(service: SupabaseClient, runId: string): Promise<void> {
  await service.from("app_settings").delete().eq("key", LOCK_KEY).eq("value", runId);
}

type LogRow = {
  id: string;
  conversation_id: number;
  client_message_id: number;
  mode: "auto" | "suggest" | "skipped";
  reply_message_id: number | null;
  acted_at: string | null;
  staff_replied_at: string | null;
  intake: unknown;
};

async function callsToday(service: SupabaseClient): Promise<number> {
  const { count } = await service.from("murad_log").select("id", { count: "exact", head: true }).not("provider", "is", null).gte("created_at", riyadhDayStart());
  return count ?? 0;
}

// ---------- what Murad knows about this client ----------

const CLIENT_STATE: Record<string, string> = {
  awaiting_reply: "بانتظار رد العميل",
  confirmed: "مؤكد",
  paid_partial: "مؤكد",
  paid_full: "مؤكد",
  completed: "رحلة منتهية",
  cancelled: "ملغى",
};

type OfferRow = {
  id: string;
  serial: string;
  destination: string | null;
  duration: string | null;
  total: number | null;
  currency: string | null;
  status: string;
  operations: OpRow | OpRow[] | null;
};
type OpRow = { client_status: string; client_token: string | null; client_token_revoked_at: string | null };

/** What the trip link shows, in words: tickets, hotels, money, documents — never a cost (getClientTrip / getClientHub are client-safe). */
async function tripFacts(op: OpRow): Promise<MuradFile["trip"]> {
  const token = op.client_token;
  if (!token || op.client_token_revoked_at) return null;
  const [trip, hub, guide] = await Promise.all([getClientTrip(token), getClientHub(token), getTripGuide(token)]);
  if (!trip || !hub) return null;
  const ticketed = trip.flights.filter((f) => f.ticketed).length;
  const confirmed = trip.hotels.filter((h) => h.confirmation).length;
  const state = trip.money ? paidState(trip.money.total, trip.money.paid) : null;
  return {
    state: CLIENT_STATE[op.client_status] ?? op.client_status,
    tickets: !trip.flights.length ? "لا طيران في الملف" : ticketed === trip.flights.length ? "صدرت" : ticketed ? `صدرت ${ticketed} من ${trip.flights.length}` : "لم تصدر بعد",
    hotels: !trip.hotels.length ? "لا فنادق في الملف" : confirmed === trip.hotels.length ? "وصل تأكيد الفنادق" : `بانتظار تأكيد الفندق (${trip.hotels.length - confirmed} من ${trip.hotels.length})`,
    payment: !trip.money
      ? "—"
      : state === "paid"
        ? "مسدّد بالكامل"
        : state === "partial"
          ? `مسدّد جزئياً — المتبقي ${trip.money.remaining.toLocaleString("en-US")} ${trip.money.currency}`
          : `لم يُسدَّد بعد — الإجمالي ${trip.money.total.toLocaleString("en-US")} ${trip.money.currency}`,
    link: `${site()}/trip/${token}`,
    documents: [...new Set(hub.documents.map((d) => DOCUMENT_LABEL[d.kind]))],
    pending: hub.pending.map((p) => p.title).slice(0, 6),
    guide: guide
      ? [
          guide.embassy_phone && `السفارة السعودية: ${guide.embassy_phone}`,
          guide.ambulance && `الإسعاف: ${guide.ambulance}`,
          guide.police && `الشرطة: ${guide.police}`,
          guide.local_agent_phone && `وكيلنا المحلي: ${guide.local_agent_phone}`,
        ].filter((x): x is string => Boolean(x))
      : [],
  };
}

/** The client's issued files, by the last nine digits of the number they write from — ours only, never a partner's. */
async function clientFiles(service: SupabaseClient, phone: string): Promise<MuradFile[]> {
  const nine = digits(phone).slice(-9);
  if (nine.length < 9) return [];
  const { data: customers } = await service.from("customers").select("id, mobile").ilike("mobile", `%${nine}`).limit(20);
  const ids = ((customers ?? []) as { id: string; mobile: string | null }[]).filter((c) => digits(c.mobile).endsWith(nine)).map((c) => c.id);
  if (!ids.length) return [];
  const { data } = await service
    .from("offers")
    .select("id, serial, destination, duration, total, currency, status, operations(client_status, client_token, client_token_revoked_at)")
    .in("customer_id", ids)
    .is("partner_company_id", null)
    .in("status", ["sent", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(3);
  const offers = (data ?? []) as unknown as OfferRow[];
  if (!offers.length) return [];
  const { data: days } = await service.from("offer_days").select("offer_id, day_date").in("offer_id", offers.map((o) => o.id)).not("day_date", "is", null);
  const span = new Map<string, { from: string; to: string }>();
  for (const d of (days ?? []) as { offer_id: string; day_date: string }[]) {
    const s = span.get(d.offer_id);
    span.set(d.offer_id, { from: !s || d.day_date < s.from ? d.day_date : s.from, to: !s || d.day_date > s.to ? d.day_date : s.to });
  }
  // the trip of the newest live case only: three files' worth of trip pages is a lot of reading for one answer
  const live = offers.find((o) => {
    const op = Array.isArray(o.operations) ? o.operations[0] : o.operations;
    return op && op.client_status !== "cancelled" && op.client_token && !op.client_token_revoked_at;
  });
  return Promise.all(
    offers.map(async (o) => {
      const op = Array.isArray(o.operations) ? o.operations[0] : o.operations;
      return {
        serial: o.serial,
        destination: o.destination,
        from: span.get(o.id)?.from ?? null,
        to: span.get(o.id)?.to ?? null,
        duration: o.duration,
        total: o.total == null ? null : Number(o.total),
        currency: o.currency,
        status: op?.client_status === "cancelled" ? "ملغى" : op ? "أكّد العميل الحجز" : o.status === "confirmed" ? "مؤكد" : "أُرسل للعميل",
        trip: o === live && op ? await tripFacts(op) : null,
      };
    }),
  );
}

/** The company's ready packages for where the client is going — first word of each destination against title / country. */
async function readyOffersFor(service: SupabaseClient, destinations: string[]): Promise<MuradReadyOffer[]> {
  const words = [...new Set(destinations.map((d) => d.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/)[0]).filter((w) => w && w.length >= 3))].slice(0, 2);
  if (!words.length) return [];
  const { data } = await service
    .from("ready_offers")
    .select("title, variant, nights, price, currency, includes_text, validity_raw, valid_to, problems")
    .eq("active", true)
    .eq("status", "ready")
    // never quote an offer that is not published or that the sheet contradicts itself on
    .eq("published", true)
    .or(words.flatMap((w) => [`country.ilike.%${w}%`, `title.ilike.%${w}%`]).join(","))
    .limit(5);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return ((data ?? []) as { title: string; variant: string | null; nights: number | null; price: number | null; currency: string | null; includes_text: string | null; validity_raw: string | null; valid_to: string | null; problems: string[] | null }[])
    .filter((o) => (!o.valid_to || o.valid_to >= today) && !o.problems?.length)
    .slice(0, 3)
    .map((o) => ({
      title: [o.title, o.variant].filter(Boolean).join(" — "),
      nights: o.nights,
      price: o.price == null ? null : Number(o.price),
      currency: o.currency,
      includes: o.includes_text ?? "",
      validity: o.validity_raw ?? "",
    }));
}

async function buildContext(service: SupabaseClient, c: OpenConversation, thread: FreshThread, muradIds: ReadonlySet<number>, policies: string): Promise<MuradContext> {
  const phone = thread.phone || c.phone;
  const [files, { data: lead }] = await Promise.all([
    clientFiles(service, phone),
    // «العملاء» already read the destination off this conversation's labels and the client's words
    service.from("client_leads").select("destination").eq("teletel_conversation_id", c.id).maybeSingle(),
  ]);
  const destinations = [files[0]?.destination, (lead as { destination?: string | null } | null)?.destination, ...inferDestinations(thread.labels, {})].filter(
    (d): d is string => Boolean(d?.trim()),
  );
  return {
    now: new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    // Teletel names an unnamed contact by its number (or «#id»): that is not a name to greet
    contact: { name: [thread.name, c.name].find((n) => n && !/\d{6}|^#/.test(n)) ?? "", labels: thread.labels },
    // private notes stay out: they are staff talk, and may name a cost
    messages: thread.messages
      .filter((m) => !m.isPrivate)
      .slice(-15)
      .map((m) => ({ who: m.fromClient ? "client" : muradIds.has(m.id) ? "murad" : m.template ? "template" : "staff", at: m.at, text: m.text })),
    files,
    readyOffers: await readyOffersFor(service, destinations),
    policies,
  };
}

// ---------- the run ----------

/** conversation → the list's lastActivityAt when its thread was last read: unchanged means nothing new to read */
const readAt = new Map<number, number>();

export type MuradRunSummary = {
  skipped?: "switched_off" | "no_provider" | "not_configured" | "busy";
  provider?: string;
  open?: number;
  read?: number;
  auto?: number;
  suggest?: number;
  failed?: number;
  staffReplied?: number;
  used?: number;
  cap?: number;
  capped?: boolean;
};

export async function runMurad(): Promise<MuradRunSummary> {
  const flags = await getFeatureFlags();
  if (!flags.murad_suggest && !flags.murad_auto) return { skipped: "switched_off" };
  const provider = muradProvider();
  if (!provider) return { skipped: "no_provider" };
  if (!getTeletelConfig()) return { skipped: "not_configured" };

  const service = db();
  const runId = crypto.randomUUID();
  if (!(await takeLease(service, runId))) return { skipped: "busy" };
  try {
    return await work(service, provider, { suggest: flags.murad_suggest, auto: flags.murad_auto });
  } finally {
    await dropLease(service, runId);
  }
}

type Answer = { mode: "auto" | "suggest" | "skipped"; fault: string | null; replyId: number | null; reply: string | null; needsStaff: boolean | null; reason: string | null; intake: unknown };

/**
 * Ask the model and write to Teletel for one claimed turn. Never throws: the
 * claim is already taken, so a failure is recorded on it, not retried.
 */
async function answer(
  service: SupabaseClient,
  c: OpenConversation,
  thread: FreshThread,
  mode: "auto" | "suggest",
  messageId: number,
  muradIds: Set<number>,
  policies: string,
  control: MuradControl,
): Promise<Answer> {
  try {
    // what past conversations show about what the client is asking now (lessons-text.ts)
    const asked = thread.messages.filter((t) => t.fromClient && !t.isPrivate).slice(-3).map((t) => t.text).join("\n");
    const examples = await relevantLessons(service, asked).catch(() => "");
    const context = await buildContext(service, c, thread, muradIds, [policies, examples].filter(Boolean).join("\n\n"));
    context.includePrice = control.includePrice;
    if (!control.includePrice) {
      context.files = context.files.map((f) => ({ ...f, total: null, trip: f.trip ? { ...f.trip, payment: "", link: null } : null }));
      context.readyOffers = context.readyOffers.map((o) => ({ ...o, price: null }));
    }
    const r = await muradReply(context);
    const out: Answer = { mode, fault: r.error ?? null, replyId: null, reply: r.reply, needsStaff: r.needsStaff, reason: r.reason || null, intake: r.intake ?? null };
    if (mode === "suggest") {
      if (!(await addTeletelNote(c.id, suggestionNote(r)))) Object.assign(out, { mode: "skipped", fault: "note_failed" });
      return out;
    }
    // the model took seconds: never answer over a colleague who just did, nor past a client who just wrote more
    const again = await readThread(c.id);
    const still = Boolean(again?.canReply) && inMuradScope(control, again?.inboxId ?? null, again?.teamId ?? null) && clientTurn(again?.messages ?? [], Math.floor(Date.now() / 1000), muradIds)?.messageId === messageId;
    out.replyId = still ? await sendTeletelMessage(c.id, r.reply) : null;
    if (out.replyId === null) return { ...out, mode: "skipped", fault: still ? "send_failed" : again ? "turn_changed" : "recheck_failed" };
    muradIds.add(out.replyId);
    await addTeletelNote(c.id, autoNote(r, noteFor(c)));
    await addTeletelLabels(c.id, [MURAD_LABEL]);
    if (r.needsStaff) {
      const lastClient = [...thread.messages].reverse().find((m) => m.fromClient && !m.isPrivate)?.text ?? "";
      const route = readRequest(lastClient, []).kind ?? "موظف";
      const handoff = control.handoffs[route];
      if (handoff && (handoff.teamId || handoff.agentId)) {
        const assigned = await handOver(control, c.id, handoff.teamId, handoff.agentId, c.phone);
        await addTeletelNote(c.id, assigned ? "تم تحويل الطلب حسب إعدادات مُراد." : "تعذّر التحويل حسب إعدادات مُراد — يرجى إسناد الطلب يدويًا.");
      }
    }
    return out;
  } catch (error) {
    return { mode: "skipped", fault: (error instanceof Error ? error.message : String(error)).slice(0, 300), replyId: null, reply: null, needsStaff: null, reason: null, intake: null };
  }
}

async function work(service: SupabaseClient, provider: MuradProvider, flags: { suggest: boolean; auto: boolean }): Promise<MuradRunSummary> {
  const started = Date.now();
  const [settings, list, logsRes, used] = await Promise.all([
    readSettings(service),
    listOpenConversations(),
    // two days of log: a client turn older than a day is never answered, so older keys never matter
    service
      .from("murad_log")
      .select("id, conversation_id, client_message_id, mode, reply_message_id, acted_at, staff_replied_at, intake")
      .gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
      .limit(5000),
    callsToday(service),
  ]);
  if (logsRes.error) throw new Error(`murad_log: ${logsRes.error.message}`);
  if (!list) throw new Error("teletel: the open conversations could not be read");
  flags = { suggest: flags.suggest && settings.control.tasks.suggest, auto: flags.auto && settings.control.tasks.auto };
  const logs = (logsRes.data ?? []) as LogRow[];

  const logged = new Set(logs.map((l) => turnKey(l.conversation_id, Number(l.client_message_id))));
  const muradIds = muradMessageIds(logs);
  const lastActed = new Map<number, number>();
  // Murad's answers nobody has followed up yet: the first human reply after one is the quality metric
  const awaiting = new Map<number, number>();
  for (const l of logs) {
    if (!l.acted_at) continue;
    const sec = Math.floor(Date.parse(l.acted_at) / 1000);
    lastActed.set(l.conversation_id, Math.max(lastActed.get(l.conversation_id) ?? 0, sec));
    if (l.mode !== "skipped" && !l.staff_replied_at) awaiting.set(l.conversation_id, Math.min(awaiting.get(l.conversation_id) ?? sec, sec));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const onList = (phone: string) => {
    const p = intlPhone(phone);
    return p !== null && settings.autoList.includes(p);
  };
  const queue = list.rows
    .filter((c) => inMuradScope(settings.control, c.inboxId, c.teamId))
    .map((c) => ({
      c,
      turn: isCandidate(c, nowSec, lastActed.get(c.id) ?? null),
      followUp: awaiting.has(c.id) && c.lastActivityAt > (lastActed.get(c.id) ?? 0) + 15,
    }))
    .filter((x) => (x.turn || x.followUp) && readAt.get(x.c.id) !== x.c.lastActivityAt)
    // the auto list first (the trial is the point), then the freshest
    .sort((a, b) => Number(onList(b.c.phone)) - Number(onList(a.c.phone)) || b.c.lastActivityAt - a.c.lastActivityAt)
    .slice(0, READS_PER_RUN);

  const n = { read: 0, auto: 0, suggest: 0, failed: 0, staffReplied: 0 };
  let calls = used;
  let capped = false;
  for (const { c, turn, followUp } of queue) {
    if (Date.now() - started > RUN_BUDGET_MS) break;
    const thread = await readThread(c.id);
    if (!thread || !inMuradScope(settings.control, thread.inboxId ?? null, thread.teamId ?? null)) continue;
    n.read += 1;

    if (followUp) {
      const since = awaiting.get(c.id) ?? 0;
      const human = thread.messages.find((m) => m.at > since && isHumanReply(m, muradIds));
      if (human) {
        const at = new Date(human.at * 1000).toISOString();
        await service.from("murad_log").update({ staff_replied_at: at }).eq("conversation_id", c.id).is("staff_replied_at", null).lte("acted_at", at);
        n.staffReplied += 1;
      }
    }
    const phone = thread.phone || c.phone;
    const d = turn
      ? decide({
          conversationId: c.id,
          messages: thread.messages,
          nowSec: Math.floor(Date.now() / 1000),
          muradIds,
          logged,
          phone,
          canReply: thread.canReply,
          flags,
          clientWhatsapp: settings.clientWhatsapp,
          autoList: settings.autoList,
          used: calls,
          cap: settings.cap,
        })
      : null;
    if (d && !d.act && d.why === "cap") {
      // left unread: tomorrow's allowance must still see this one
      capped = true;
      break;
    }
    readAt.set(c.id, c.lastActivityAt);
    if (!d?.act) continue;

    // claim the turn before the model is asked: a second run (or a retry) finds it taken
    const { data: claim, error } = await service
      .from("murad_log")
      .insert({
        conversation_id: c.id,
        client_message_id: d.messageId,
        client_message_at: new Date(d.at * 1000).toISOString(),
        phone,
        mode: d.mode,
        provider: provider.provider,
        model: provider.model,
      })
      .select("id")
      .single();
    if (error || !claim) continue;
    logged.add(turnKey(c.id, d.messageId));
    calls += 1;

    const a = await answer(service, c, thread, d.mode, d.messageId, muradIds, settings.policies, settings.control);
    n[a.mode === "skipped" ? "failed" : a.mode] += 1;
    await service
      .from("murad_log")
      .update({ mode: a.mode, reply: a.reply, needs_staff: a.needsStaff, reason: a.reason, intake: a.intake, error: a.fault, reply_message_id: a.replyId, acted_at: new Date().toISOString() })
      .eq("id", (claim as { id: string }).id);
  }
  return { provider: provider.provider, open: list.rows.length, ...n, used: calls, cap: settings.cap, capped };
}

// ---------- /developer ----------

export type MuradLogView = { id: string; at: string; phone: string; mode: string; needsStaff: boolean | null; preview: string; staffReplied: boolean; error: string | null };

export type MuradPanelData = {
  provider: MuradProvider | null;
  /** false: murad_log cannot be read — the migration is not applied yet */
  ready: boolean;
  autoPhones: string[];
  testPhone: string | null;
  cap: number;
  usedToday: number;
  logs: MuradLogView[];
};

/** The developer page's «مُراد» section. The caller holds developer.access. */
export async function muradPanel(): Promise<MuradPanelData> {
  const service = db();
  const [settings, used, { data, error }] = await Promise.all([
    readSettings(service),
    callsToday(service),
    service.from("murad_log").select("id, created_at, phone, mode, needs_staff, reply, staff_replied_at, error").order("created_at", { ascending: false }).limit(20),
  ]);
  return {
    provider: muradProvider(),
    ready: !error,
    autoPhones: settings.autoPhones,
    testPhone: settings.testPhone ? maskPhone(settings.testPhone) : null,
    cap: settings.cap,
    usedToday: used,
    logs: ((data ?? []) as { id: string; created_at: string; phone: string | null; mode: string; needs_staff: boolean | null; reply: string | null; staff_replied_at: string | null; error: string | null }[]).map((l) => ({
      id: l.id,
      at: l.created_at,
      phone: maskPhone(l.phone),
      mode: l.mode,
      needsStaff: l.needs_staff,
      preview: (l.reply ?? "").replace(/\s+/g, " ").slice(0, 90),
      staffReplied: Boolean(l.staff_replied_at),
      error: l.error,
    })),
  };
}
