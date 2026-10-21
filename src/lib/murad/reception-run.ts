import { routeCompletedVisa, retryVisaHandoffs } from "./visa-routing";
import type { MuradReceipt } from "./visa-assignment";
import { visaIntakeReply } from "./visa-intake";
import { inMuradScope } from "./control";
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getFeatureFlags } from "@/lib/features-server";
import {
  addTeletelNote,
  assignMuradHandoff,
  conversationEvents,
  intlPhone,
  listOpenConversations,
  listTeletelTeams,
  markTeletelSeen,
  type OpenConversation,
  sendTeletelAttachment,
  sendTeletelMessage,
  setTeletelTyping,
} from "@/lib/providers/teletel";
import { asSystem } from "@/lib/supabase/system-actor";
import { produceOfferFromDraft } from "@/lib/data/drafts";
import { getTourPrograms } from "@/lib/data/tour-programs";
import { offerMessage } from "@/lib/data/client-whatsapp";
import { clientOfferPdf } from "@/lib/offer-doc/client-pdf";
import { tidyWhatsapp } from "@/lib/operations/client-messages";
import { logAudit } from "@/lib/data/audit";
import { parseAssignment } from "@/lib/leads/auto";
import { getRates } from "@/lib/data/rates-actions";
import { USD_SAR_DEFAULT } from "@/lib/offer/pricing";
import { askText, datesSaid, holdToText, missing, offerDraftData, offerText, priceOffer, readOffers, routeCity, tripChanged, tripDays, tripSummary, type OfferAsk, type OfferCountry } from "./auto-offer";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { fold, normalizePhone } from "@/lib/leads/sheet";
import { isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
import { isHumanReply, maskPhone, muradMessageIds, noteFor, SETTING } from "./core";
import { notNeededText, SCHENGEN, uncoveredTopics, visaAnswerText, visaAskText, visaHandoffText, visaStep, visaSummary, type VisaAsk, type VisaRow } from "./visa";
import { visaFor } from "@/lib/operations/travelers";
import { readSettings, readThread } from "./run";
import {
  clarifyText,
  decideReception,
  DEPARTMENT,
  firstName,
  holdText,
  isWorkingTime,
  lastClosedAt,
  MAX_WAIT_SEC,
  parseDelay,
  parseHours,
  pickDelay,
  readRequest,
  readRoutes,
  receptionText,
  sayTime,
  teamFor,
  type RouteKey,
} from "./reception";

/**
 * «المستقبل الآلي» doing what reception.ts decides, for one incoming message —
 * from the Teletel webhook (api/teletel/webhook) the moment it arrives, or from
 * the minute job as a fallback when the webhook missed one.
 *
 * Its gates, in order: the switch (murad_reception), the scope — the owner's
 * two test numbers until they say «الكل» (murad_reception_scope) — and client
 * WhatsApp not switched off. Then the turn is CLAIMED in murad_log (unique per
 * client message), so a webhook retried, or the job arriving second, does
 * nothing. Every act and every refusal after the claim is that row.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** how far back «this visit» reaches: a colleague's answer, or a reception, older than this belongs to an earlier one */
const VISIT_SEC = 12 * 3600;

export type IncomingMessage = {
  conversationId: number;
  messageId: number;
  at: number;
  phone: string;
  contactName: string;
  content: string;
  /** the first message of the burst Murad waited on — every client message since is read as one */
  since?: number;
};

export type ReceptionOutcome =
  | "off"
  | "out_of_scope"
  | "duplicate"
  | "unreadable"
  | `none:${"routed" | "staff" | "assigned" | "window"}`
  | "asked"
  | `routed:${RouteKey}`
  /** answered in full by Murad, nothing handed over («لا تحتاج تأشيرة») */
  | "answered"
  | "send_failed";

export type ReceptionSettings = { scope: "test" | "all"; routesRaw: string | null; hours: string | null; delay: string | null; offersRaw: string | null };

export async function readReceptionSettings(service: SupabaseClient): Promise<ReceptionSettings> {
  const { data } = await service.from("app_settings").select("key, value").in("key", [SETTING.receptionScope, SETTING.receptionRoutes, SETTING.receptionHours, SETTING.receptionDelay, SETTING.receptionOffers]);
  const v = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return {
    scope: v.get(SETTING.receptionScope) === "all" ? "all" : "test",
    routesRaw: v.get(SETTING.receptionRoutes) ?? null,
    hours: v.get(SETTING.receptionHours) ?? null,
    delay: v.get(SETTING.receptionDelay) ?? null,
    offersRaw: v.get(SETTING.receptionOffers) ?? null,
  };
}

// ---------- «عرض آلي»: the trip's facts, from everything the client wrote ----------

/**
 * The trip the client wants NOW, from the whole visit read in order — the
 * client's lines and Murad's questions and offers between them, so «8» answers
 * «عدد الأيام؟» and a later line replaces an earlier one (the owner,
 * 2026-10-19: «يحتاج… فهم الرسائل والاعتماد على المحادثات السابقة»). Relative
 * dates are counted from today in Riyadh. Only the client's words are facts
 * (`clientText` holds the dates to them, holdToText). Null on any failure:
 * the conversation then goes to a colleague like any other.
 */
async function readTrip(transcript: string, clientText: string, offer: OfferCountry): Promise<OfferAsk | null> {
  if (!isOpenAIConfigured()) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  try {
    const raw = await openaiJson({
      name: "trip_facts",
      system: [
        `Today is ${today} (Riyadh). Below is one visit of a client's WhatsApp conversation with a travel company, oldest first: «العميل» lines are the client's, «مُراد» lines are our assistant's questions and offers.`,
        "Extract the trip the client wants NOW. Read every line in order: an answer completes what «مُراد» asked, and a later client line replaces an earlier one (a new party, length, date or city wins). Only the client's lines are facts — never take a date, a price or a city from «مُراد»'s lines as the client's.",
        "name: the client's own personal name if they gave it (e.g. «محمد», «احمد الرفاعي») — never a place, and never words about who travels («انا وزوجتي», «شخصين», «عائلة»), which are null.",
        "arrival_date / departure_date: YYYY-MM-DD, in the future; a month without a year is the next one to come; a relative date counts from today («بعد عشرة ايام» = today + 10, «الأسبوع الجاي» = the coming Sunday, «بداية الشهر الجاي» = the 1st of next month).",
        "days: the trip's length in days only when the client states one («10 أيام», «مدة اسبوع» = 7) — two dates without a stated length leave it null. adults and children («شخصين» = 2 adults, «انا وزوجتي» = 2 adults, «4 اشخاص» = 4 adults when no children are mentioned).",
        "rooms: only if the client said how many rooms and it still fits the latest party; else null.",
        `only_city: when the client wants every night in one city («المبيت فقط في تبليسي», «تبليسي فقط») — that city, spelled as one of ${offer.cities.map((c) => `«${c.city}»`).join("، ")} when it is one of them, else as written; else null.`,
        "special: a short Arabic phrase for any requirement beyond the destination, dates, party, rooms and one city — a specific hotel or star level, flights, a villa, a budget, another country's cities — else null.",
        "null for anything not said. Never invent.",
      ].join("\n"),
      user: transcript.slice(-3500),
      schema: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          arrival_date: { type: ["string", "null"] },
          departure_date: { type: ["string", "null"] },
          days: { type: ["integer", "null"] },
          adults: { type: ["integer", "null"] },
          children: { type: ["integer", "null"] },
          rooms: { type: ["integer", "null"] },
          only_city: { type: ["string", "null"] },
          special: { type: ["string", "null"] },
        },
        required: ["name", "arrival_date", "departure_date", "days", "adults", "children", "rooms", "only_city", "special"],
        additionalProperties: false,
      },
      temperature: 0,
      timeoutMs: 15000,
    });
    const r = JSON.parse(raw ?? "{}") as Record<string, string | number | null>;
    const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
    const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);
    return holdToText(
      clientText,
      { name: s("name"), arrival: s("arrival_date"), departure: s("departure_date"), days: n("days"), adults: n("adults"), children: n("children"), rooms: n("rooms"), only_city: s("only_city"), special: s("special") },
      today,
    );
  } catch {
    return null;
  }
}

/**
 * A visa request from the whole visit (the owner, 2026-10-19: «كأن مراد موظف
 * تأشيرات»): the destination as our list spells it — never the client's own
 * country («مقيم في السعودية» is where they live) — the kind, each passport
 * among the applicants (the writer's, and others' when they differ: «عراقي
 * مقيم… وصديق لي سعودي»), the party, an approximate date, what they asked
 * about, a refusal before, a request already with the team. Only the client's
 * words are facts; a date counts only when the client named one. Null on any
 * failure: the request then goes to the visa team like any other.
 */
async function readVisa(transcript: string, clientText: string, countryNames: string[]): Promise<VisaAsk | null> {
  if (!isOpenAIConfigured()) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  try {
    const raw = await openaiJson({
      name: "visa_facts",
      system: [
        `Today is ${today} (Riyadh). Below is one visit of a client's WhatsApp conversation with a travel company in Saudi Arabia, oldest first: «العميل» lines are the client's, «مُراد» lines are our assistant's. The client is asking about a visa. Extract what the client wants NOW: a later client line replaces an earlier one. When the latest client line names another country («وإسبانيا؟», «طيب وايطاليا؟») that country IS the destination now, and the nationality, the applicants and the date said before carry over to it. Only the client's lines are facts.`,
        `country: the DESTINATION country, spelled as one of: ${countryNames.join("، ")} — or as written when it is none of them (a city means its country: لندن → المملكة المتحدة, باريس → فرنسا; امريكا → الولايات المتحدة; بريطانيا → المملكة المتحدة). Never the country the client lives in or holds a passport of. null when only «شنغن» is said.`,
        "schengen: true when the client says شنغن without naming one country.",
        "kind: tourist (the default for تأشيرة/فيزا/فيزه/زيارة/سياحة), medical, study, work, family (to join a relative), other.",
        "nationality: ISO 3166-1 alpha-3 of the writer's passport, only when said («سعودي» = SAU, «عراقي» = IRQ; «مقيم» alone is no nationality); nationality_ar: as an Arabic adjective («عراقي»); resident: true when the writer lives in Saudi Arabia on an إقامة, else null.",
        "others: the other applicants whose passport differs from the writer's, one item per nationality — {nationality (alpha-3), nationality_ar, resident} («وصديق لي سعودي» → SAU). Empty when all share the writer's.",
        "applicants: how many people apply in all («انا وزوجتي» = 2, «انا وصديقي» = 2), children included. travel_date: approximate travel date YYYY-MM-DD in the future (a month alone = the 1st of the next such month; relative dates from today).",
        "topics: what the client asks about — requirements, price, time (how long it takes), appointment (موعد/مقابلة), fingerprints (بصمة), validity (how long the visa lasts), refund (if refused), guarantee (is approval guaranteed).",
        "status_query: true when the client asks where an existing request stands («وين وصلت تأشيرتي»). wants_trip: true when the client also asks for a trip or package. refused_before: true only when the client says a visa WAS refused in the past («انرفضت قبل»); a question about what happens if refused («لو انرفضت») is the refund topic, not a refusal. special: a short Arabic phrase for anything unusual (urgent, a minor alone, an expired passport), else null.",
        "null or empty for anything not said. Never invent.",
      ].join("\n"),
      user: transcript.slice(-3000),
      schema: {
        type: "object",
        properties: {
          country: { type: ["string", "null"] },
          schengen: { type: ["boolean", "null"] },
          kind: { type: ["string", "null"], enum: ["tourist", "medical", "study", "work", "family", "other", null] },
          nationality: { type: ["string", "null"] },
          nationality_ar: { type: ["string", "null"] },
          resident: { type: ["boolean", "null"] },
          others: {
            type: "array",
            items: {
              type: "object",
              properties: { nationality: { type: "string" }, nationality_ar: { type: ["string", "null"] }, resident: { type: ["boolean", "null"] } },
              required: ["nationality", "nationality_ar", "resident"],
              additionalProperties: false,
            },
          },
          applicants: { type: ["integer", "null"] },
          travel_date: { type: ["string", "null"] },
          topics: { type: "array", items: { type: "string", enum: ["requirements", "price", "time", "appointment", "fingerprints", "validity", "refund", "guarantee"] } },
          status_query: { type: ["boolean", "null"] },
          wants_trip: { type: ["boolean", "null"] },
          refused_before: { type: ["boolean", "null"] },
          special: { type: ["string", "null"] },
        },
        required: ["country", "schengen", "kind", "nationality", "nationality_ar", "resident", "others", "applicants", "travel_date", "topics", "status_query", "wants_trip", "refused_before", "special"],
        additionalProperties: false,
      },
      temperature: 0,
      timeoutMs: 15000,
    });
    const r = JSON.parse(raw ?? "{}") as VisaAsk;
    const iso3 = (s: string | null | undefined) => (s && /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : null);
    const date = r.travel_date && /^\d{4}-\d{2}-\d{2}$/.test(r.travel_date) && r.travel_date >= today && datesSaid(clientText) > 0 ? r.travel_date : null;
    const nat = iso3(r.nationality);
    const others = (r.others ?? []).map((o) => ({ ...o, nationality: iso3(o.nationality) ?? "" })).filter((o) => o.nationality && o.nationality !== nat);
    return { ...r, nationality: nat, nationality_ar: nat ? r.nationality_ar : null, others, travel_date: date, applicants: r.applicants && r.applicants > 0 ? r.applicants : null };
  } catch {
    return null;
  }
}

/**
 * «الإصدار الآلي» (the owner, 2026-10-18): Murad issues the file it priced —
 * the employee's own producer (produceOfferFromDraft), run as Murad
 * (system-actor.ts: offers.write, no employee) — and sends the client the
 * programme's link and its PDF in this conversation, recorded as the
 * employee's send is (offer.client_sent). Null when the file could not be
 * issued: the proposal already went, and the colleague issues it from Basic.
 */
/** Murad doing an employee's part — system-actor.ts */
const MURAD = { name: "مُراد (آلي)", can: ["offers.write"] } as const;

async function issueAndSend(draftId: string, conversationId: number, updated = false): Promise<{ serial: string; sent: boolean; version: number; ids: number[] } | null> {
  return asSystem(MURAD, async () => {
    const issued = await produceOfferFromDraft(draftId).catch(() => null);
    if (!issued?.ok) return null;
    const { serial } = issued;
    const version = issued.version ?? 1;
    // a re-issue («حدّثت الطلب») goes out as «تم تحديث ملفك», the same serial's next version
    const message = await offerMessage(serial, updated);
    if (!message) return { serial, sent: false, version, ids: [] };
    // the link and the PDF are Murad's too (core.ts muradMessageIds) — never a colleague's answer
    const ids: number[] = [];
    const linkId = await sendTeletelMessage(conversationId, tidyWhatsapp(message.text));
    const sent = linkId !== null;
    if (linkId) ids.push(linkId);
    if (sent) {
      // Chromium takes seconds; the client has the link meanwhile
      const bytes = await clientOfferPdf(serial).catch(() => null);
      const pdfId = bytes ? await sendTeletelAttachment(conversationId, "📎 برنامج رحلتك", { name: message.pdfName, type: "application/pdf", bytes }) : null;
      if (pdfId) ids.push(pdfId);
      const { data: offer } = await db().from("offers").select("id").eq("serial", serial).maybeSingle();
      const offerId = (offer as { id: string } | null)?.id;
      if (offerId) await logAudit({ action: "offer.client_sent", entity: "offers", entity_id: offerId, meta: { result: "sent", version, serial, by: "murad", pdf: Boolean(bytes) } });
    }
    return { serial, sent, version, ids };
  });
}

/**
 * The country a message names when the catalogue does not know the place
 * («تأشيرة الى لندن» — no London among our cities): the model says it, and our
 * own spelling of it wins when the countries table has it, else its own. Asked
 * only after the client has been answered, so it never slows the reply; null
 * on any failure.
 */
async function countryOf(service: SupabaseClient, text: string): Promise<string | null> {
  if (!isOpenAIConfigured() || text.replace(/[^p{L}]/gu, "").length < 3) return null;
  try {
    const raw = await openaiJson({
      name: "named_country",
      system: "Return the country (in Arabic) of the destination the message names — a country, a city or a place (لندن → بريطانيا، دبي → الإمارات، أنطاليا → تركيا). null when it names none.",
      user: text.slice(0, 500),
      schema: { type: "object", properties: { country: { type: ["string", "null"] } }, required: ["country"], additionalProperties: false },
      temperature: 0,
      timeoutMs: 8000,
    });
    const country = (JSON.parse(raw ?? "{}") as { country?: string | null }).country?.trim();
    if (!country) return null;
    const { data } = await service.from("countries").select("arabic_name");
    return ((data ?? []) as { arabic_name: string }[]).find((c) => fold(c.arabic_name) === fold(country))?.arabic_name ?? country;
  } catch {
    return null;
  }
}

/**
 * The conversation's row in «العملاء», made or completed now — the pull fills
 * the rest within five minutes. What the reception understood is this visit's:
 * a conversation WhatsApp reopened days later takes its new kind and country,
 * never the last visit's (the evaluator: «اندونيسيا» from a former visit).
 */
async function markLead(
  service: SupabaseClient,
  m: IncomingMessage,
  fields: { inquiry: string | null; destination: string | null; route: string; at: string; waitSec: number; draftId?: string; name?: string | null; intakeOnly?: boolean },
): Promise<void> {
  const name = m.contactName.trim();
  const realName = name && !name.startsWith("#") && normalizePhone(name) !== normalizePhone(m.phone) ? name : null;
  const { data } = await service.from("client_leads").select("id, name, inquiry, inquiry_source, destination, status, created_at, last_visit_at").eq("teletel_conversation_id", m.conversationId).maybeSingle();
  const had = data as { id: string; name: string | null; inquiry: string | null; inquiry_source: string | null; destination: string | null; status: string; created_at: string; last_visit_at: string | null } | null;
  const routed = {
    ...(!fields.intakeOnly ? {
    auto_route: fields.route,
    auto_routed_at: fields.at,
    auto_wait_sec: fields.waitSec,
    assigned_at: fields.at,
    assignee_reply_at: null,
    } : {}),
    updated_at: fields.at,
    ...(fields.draftId ? { draft_id: fields.draftId } : {}),
    ...(fields.name ? { name: fields.name } : {}),
  };
  if (had) {
    await service
      .from("client_leads")
      .update({
        ...routed,
        ...(!had.name && realName ? { name: realName } : {}),
        ...(fields.inquiry && had.inquiry_source !== "manual" ? { inquiry: fields.inquiry, inquiry_source: "murad" } : {}),
        ...(fields.destination ? { destination: fields.destination } : {}),
        // a conversation WhatsApp reopened: this message is a new visit (0104)
        ...(had.status === "closed" || m.at - Date.parse(had.last_visit_at ?? had.created_at) / 1000 > 86_400
          ? { last_visit_at: new Date(m.at * 1000).toISOString(), status: "open" }
          : {}),
      })
      .eq("id", had.id);
    return;
  }
  const first = new Date(m.at * 1000).toISOString();
  await service.from("client_leads").upsert(
    {
      ...routed,
      phone: normalizePhone(m.phone),
      name: realName,
      inquiry: fields.inquiry,
      inquiry_source: "murad",
      destination: fields.destination,
      status: "open",
      source: "teletel",
      teletel_conversation_id: m.conversationId,
      created_at: first,
      first_message_at: first,
    },
    { onConflict: "teletel_conversation_id", ignoreDuplicates: true },
  );
}

/** Widen only visa intake; other services retain their current trial scope. */
async function visaConversation(service: SupabaseClient, m: IncomingMessage): Promise<boolean> {
  const explicit = readRequest(m.content, []);
  if (explicit.kind) return explicit.kind === "تأشيرات";
  const [{ data: lead }, thread] = await Promise.all([
    service.from("client_leads").select("inquiry").eq("teletel_conversation_id", m.conversationId).maybeSingle(),
    readThread(m.conversationId),
  ]);
  const latest = [...(thread?.messages ?? [])].reverse().filter((t) => t.fromClient && !t.isPrivate).map((t) => readRequest(t.text, []).kind).find(Boolean);
  return latest ? latest === "تأشيرات" : lead?.inquiry === "تأشيرات";
}

export async function receive(m: IncomingMessage): Promise<ReceptionOutcome> {
  if (!m.conversationId || !m.messageId) return "unreadable";
  const service = db();
  const [flags, settings, reception] = await Promise.all([getFeatureFlags(), readSettings(service), readReceptionSettings(service)]);
  if (!flags.murad_reception || !settings.control.tasks.reception || settings.clientWhatsapp === "off") return "off";
  const phone = intlPhone(m.phone);
  // the trial: the owner's two numbers only, until they widen it from /developer
  if (reception.scope !== "all" && (!phone || !settings.autoList.includes(phone)) && !(settings.control.visaAll && settings.control.tasks.visas && await visaConversation(service, m))) return "out_of_scope";

  // claimed before anything is read or sent — one answer per client message, whoever comes second
  const claim = await service
    .from("murad_log")
    .insert({ conversation_id: m.conversationId, client_message_id: m.messageId, client_message_at: new Date((m.since ?? m.at) * 1000).toISOString(), phone: m.phone, mode: "reception" })
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) return "duplicate";
  const logId = (claim.data as { id: string }).id;
  const finish = async (patch: Record<string, unknown>) => {
    await service.from("murad_log").update({ ...patch, acted_at: new Date().toISOString() }).eq("id", logId);
  };

  try {
    const [thread, past, places, events] = await Promise.all([
      readThread(m.conversationId),
      service.from("murad_log").select("mode, reason, reply_message_id, created_at, intake").eq("conversation_id", m.conversationId),
      loadPlaces(service),
      conversationEvents(m.conversationId),
    ]);
    const since = m.since ?? m.at;
    if (!thread || !inMuradScope(settings.control, thread.inboxId ?? null, thread.teamId ?? null)) {
      await finish({ reason: "unreadable", error: "teletel: the thread could not be read" });
      return "unreadable";
    }
    const rows = (past.data ?? []) as { mode: string; reason: string | null; reply_message_id: number | null; created_at: string; intake: Record<string, unknown> | null }[];
    // this visit, not the conversation's whole life: WhatsApp reopens the same conversation when a client writes
    // again — a reception or a colleague's answer from back then is not this time's. The visit starts where Teletel
    // last closed the conversation before this message (the owner, 2026-10-18: «لكي يكون طلباً جديداً كاملاً»),
    // never more than 12 hours back — Teletel's own closing line, not «العملاء»'s status (lastClosedAt).
    const closedAt = lastClosedAt(events ?? [], since);
    const visitStart = Math.max(m.at - VISIT_SEC, closedAt);
    const { data: leadRow } = await service.from("client_leads").select("id, status, last_visit_at").eq("teletel_conversation_id", m.conversationId).maybeSingle();
    const lead = leadRow as { id: string; status: string; last_visit_at: string | null } | null;
    const newVisit = closedAt > 0 && (!lead?.last_visit_at || Date.parse(lead.last_visit_at) / 1000 < closedAt);
    if (lead && (newVisit || lead.status === "closed")) {
      await service
        .from("client_leads")
        .update({ status: "open", ...(newVisit ? { last_visit_at: new Date(since * 1000).toISOString() } : {}), updated_at: new Date().toISOString() })
        .eq("id", lead.id);
    }
    const thisVisit = (sec: number) => sec >= visitStart - 1;
    const received = rows.filter((r) => r.mode === "reception" && thisVisit(Date.parse(r.created_at) / 1000));
    const ours = muradMessageIds(rows);
    // everything the client wrote while Murad waited, read as one («ابغى» … «تأشيرة» … «الى لندن»)
    const said = thread.messages.filter((t) => t.fromClient && !t.isPrivate && t.at >= since).map((t) => t.text).join("\n").trim() || m.content;
    const request = readRequest(said, places);
    const waitSec = Math.max(0, Math.round(Date.now() / 1000 - since));
    const intake = { kind: request.kind, country: request.country, wants_human: request.wantsHuman, wait_sec: waitSec };
    const staffReplied = thread.messages.some((t) => thisVisit(t.at) && isHumanReply(t, ours));
    const handedByHand = (events ?? []).some((e) => e.kind === "activity" && e.at >= since && parseAssignment(e.text)?.by != null);
    const hours = parseHours(reception.hours);
    const now = new Date();
    const opensAt = isWorkingTime(now, hours) ? null : hours.open;

    // «عرض آلي»: a trip to a country the company prices this way — asked for what is missing, then proposed. The
    // whole visit is read each time, the client's lines and Murad's between them, the newest word winning (the
    // owner, 2026-10-19: «فهم الرسائل والاعتماد على المحادثات السابقة»); a change after the offer re-issues it.
    const offers = settings.control.tasks.offers ? readOffers(reception.offersRaw) : [];
    const offerRows = received.filter((r) => r.reason?.startsWith("offer:"));
    const offerAsked = offerRows.filter((r) => r.reason?.startsWith("offer:asked"));
    const sentRow = [...offerRows].reverse().find((r) => r.reason === "offer:sent" || r.reason === "offer:updated");
    const handedOff = offerRows.some((r) => r.reason === "offer:handoff");
    // «لا تحتاج تأشيرة… وإذا تحب نجهز لك برنامج» — the next message is about that country's package
    const visaFree = received.find((r) => r.reason === "visa:not_needed")?.intake?.country as string | undefined;
    const offerCountry = (offerRows[0]?.intake?.country as string | undefined) ?? request.country ?? visaFree;
    const offer = offers.find((o) => o.enabled && offerCountry && fold(o.country) === fold(offerCountry));
    const routedTo = received.filter((r) => r.reason?.startsWith("routed:")).map((r) => r.reason!.slice("routed:".length));
    // a visa answered or handed over is a hand-over too («لا تحتاج تأشيرة» is not: the client may want the package next)
    const visaDone = received.some((r) => r.reason === "visa:answered" || r.reason === "visa:handoff");
    const done = routedTo.length > 0 || Boolean(sentRow) || handedOff || visaDone;
    const knownName = offerRows.map((r) => r.intake?.name).filter((x): x is string => typeof x === "string" && x.trim() !== "").at(-1) ?? null;
    const visitLines = thread.messages.filter((t) => !t.isPrivate && thisVisit(t.at) && (t.fromClient || ours.has(t.id)));
    const transcript = visitLines.map((t) => `${t.fromClient ? "العميل" : "مُراد"}: ${t.text}`).join("\n");
    const clientText = visitLines.filter((t) => t.fromClient).map((t) => t.text).join("\n") || said;
    const free = !staffReplied && !handedByHand && thread.canReply && !request.wantsHuman;
    // a visit the reception handed to packages before its trip was clear («بكج») may still be priced here, while no colleague has answered
    const offerOpen = offer && free && !sentRow && !handedOff && routedTo.every((to) => to === "بكج") && (offerAsked.length > 0 || routedTo.length > 0 || request.kind === "بكج" || request.kind === null);
    let routeAs = request;

    /** a detail the package as priced cannot honour: said plainly, what was understood with it, and to packages */
    const handOff = async (c: OfferCountry, trip: OfferAsk, special: string): Promise<ReceptionOutcome> => {
      const summary = tripSummary(c.country, trip);
      const text = `${request.salam && received.length === 0 ? "وعليكم السلام ورحمة الله، " : ""}طلبك فيه تفصيل خاص (${special})، سأحوّله لزميل يجهزه لك. سجّلت: ${summary}.${opensAt ? ` ويتواصل معك عند بداية الدوام الساعة ${sayTime(opensAt)}.` : ""}`;
      const replyId = await sendTeletelMessage(m.conversationId, text);
      if (!replyId) {
        await finish({ reason: "send_failed", reply: text, error: "send_failed" });
        return "send_failed";
      }
      const teams = await listTeletelTeams();
      const handoff = settings.control.handoffs["بكج"];
    const teamId = handoff?.teamId ?? teamFor(readRoutes(reception.routesRaw, teams), "بكج");
      const team = teams.find((t) => t.id === teamId) ?? null;
      const assigned = await assignMuradHandoff(m.conversationId, teamId, handoff?.agentId ?? null);
      await addTeletelNote(m.conversationId, `🤖 عرض آلي — يحتاج زميلاً${team ? ` من «${team.name}»` : ""}: ${special}. ما فُهم: ${summary}.`);
      await finish({ reason: "offer:handoff", reply: text, reply_message_id: replyId, intake: { country: c.country, ...trip, special, team_id: teamId, assigned, wait_sec: waitSec } });
      await markLead(service, m, { inquiry: "بكج", destination: c.country, route: team?.name.trim() ?? DEPARTMENT["بكج"], at: new Date().toISOString(), waitSec, name: trip.name });
      return "routed:بكج";
    };
    /** what keeps a trip from being priced here: the client's own detail, a city off the route, children, more than the car seats */
    const specialOf = (c: OfferCountry, trip: OfferAsk): string | null =>
      trip.special ??
      (trip.only_city && !routeCity(c, trip.only_city) ? `المبيت في ${trip.only_city}` : null) ??
      ((trip.children ?? 0) > 0 ? "أطفال" : (trip.adults ?? 0) > c.maxPeople ? `أكثر من ${c.maxPeople} أشخاص` : null);

    if (received.some((r) => r.intake?.visa_handoff)) {
      await finish({ reason: "none:routed" });
      return "none:routed";
    }
    // Persistent visa intake: no two-question cutoff and no handoff on a damaged photo.
    if (settings.control.visaAll && settings.control.tasks.visas && await visaConversation(service, m) && !request.wantsHuman) {
      const latest = thread.messages.filter((t) => t.fromClient && !t.isPrivate).at(-1);
      if (!thread.canReply || !latest || Date.now() / 1000 - latest.at > 24 * 3600) { await finish({ reason: "none:window" }); return "none:window"; }
      if (thread.messages.some((t) => t.at >= latest.at && isHumanReply(t, ours))) { await finish({ reason: "none:staff" }); return "none:staff"; }
      const previous = rows.filter((r) => Date.parse(r.created_at) / 1000 >= closedAt).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).find((r) => r.intake?.visa_intake)?.intake?.visa_intake ?? null;
      const { data: catalog, error: catalogError } = await service.from("visas").select("country, visa_type, sell_price, sell_currency, arabic_requirements").eq("status", "Active");
      const result = await visaIntakeReply({ messages: visitLines, previous, catalog: catalogError ? [] : catalog, includePrice: settings.control.includePrice });
      const again = await readThread(m.conversationId);
      const lastNow = again?.messages.filter((t) => t.fromClient && !t.isPrivate).at(-1);
      if (!again?.canReply || lastNow?.id !== latest.id || again.messages.some((t) => t.at >= latest.at && isHumanReply(t, ours))) {
        await finish({ reason: "none:staff", error: "turn_changed" }); return "none:staff";
      }
      const replyId = await sendTeletelMessage(m.conversationId, result.reply);
      if (!replyId) { await finish({ reason: "send_failed", error: "send_failed" }); return "send_failed"; }
      // Persist before notes/assignment: even if those fail the next turn knows this public reply is ours.
      await finish({ reason: "visa:intake", reply: result.reply, reply_message_id: replyId, intake: { ...intake, country: result.country, visa_intake: result } });
      await addTeletelNote(m.conversationId, `مُراد — ملف التأشيرة\n${result.summary}\nالنواقص: ${result.missing.join("، ") || "لا نواقص مسجلة؛ يلزم تدقيق المختص"}\nللمراجعة: ${result.review.join("، ") || "تدقيق المستندات قبل التقديم"}`);
      await markLead(service, m, { inquiry: "تأشيرات", destination: result.country, route: DEPARTMENT["تأشيرات"], at: new Date().toISOString(), waitSec, name: null, intakeOnly: true });
      const { data: savedLead } = await service.from("client_leads").select("id,murad_receipt").eq("teletel_conversation_id", m.conversationId).maybeSingle();
      const savedReceipt = savedLead?.murad_receipt as MuradReceipt | null;
      const receivedAt = new Date().toISOString();
      const start = visitLines.find((t) => t.fromClient)?.at ?? since;
      const receipt: MuradReceipt = savedReceipt && Date.parse(savedReceipt.receivedAt) / 1000 >= closedAt ? savedReceipt : { receivedAt, firstResponder: !staffReplied, waitSec: Math.max(0, Math.round(Date.parse(receivedAt) / 1000 - start)) };
      if (savedLead) await service.from("client_leads").update({ murad_receipt: { ...receipt, pending: result.completed } }).eq("id", savedLead.id);
      if (result.completed) {
        await service.from("murad_log").update({ reason: "visa:handoff_pending" }).eq("id", logId);
        await routeCompletedVisa(service, logId);
      }
      return "answered";
    }

    // «موظف التأشيرات» (the owner, 2026-10-19): a visa request is answered from the company's visa list — or said to be
    // needless for those passports — asked only for what is missing, and handed to the visa team with what was heard.
    // Murad keeps the conversation (a follow-up «وإسبانيا؟», a question more) until a colleague answers the client.
    const visaRows = received.filter((r) => r.reason?.startsWith("visa:"));
    const visaAsked = visaRows.filter((r) => r.reason?.startsWith("visa:asked") || r.reason === "visa:info");
    const visaOpen = settings.control.tasks.visas && free && routedTo.length === 0 && !sentRow && (request.kind === "تأشيرات" || visaRows.length > 0);
    let tripWithVisa = false;
    // with the trip, the visa in one line of the offer: needless for those passports, else the visa team's
    let visaLine: string | null = null;
    if (visaOpen) {
      const { data: countryRows } = await service.from("countries").select("id, arabic_name, iso2, visa_required");
      const countries = (countryRows ?? []) as { id: string; arabic_name: string; iso2: string | null; visa_required: boolean | null }[];
      const a = await readVisa(transcript, clientText, countries.map((c) => c.arabic_name));
      const country = a?.country ? (countries.find((c) => fold(c.arabic_name) === fold(a.country!)) ?? null) : null;
      // a trip to a country Murad prices, with a visa question beside it: the offer answers both (the owner's case 11)
      tripWithVisa = Boolean(a?.wants_trip && country && offers.some((o) => o.enabled && fold(o.country) === fold(country.arabic_name)));
      if (tripWithVisa && a && country) {
        const passports = [a.nationality, ...(a.others ?? []).map((o) => o.nationality)].filter((n): n is string => Boolean(n));
        const exempt = passports.length > 0 && passports.every((n) => visaFor(n, { iso2: country.iso2, visa_required: country.visa_required }, false) === "not_required");
        visaLine = exempt ? `🛂 التأشيرة: لا تحتاج تأشيرة مسبقة لـ${country.arabic_name} بجوازك.` : `🛂 التأشيرة: يؤكدها لك زميلنا في قسم التأشيرات حسب الجنسية.`;
      }
      if (a && !tripWithVisa) {
        const known: VisaAsk = { ...a, country: country?.arabic_name ?? a.country };
        const { data: listRows } = await service.from("visas").select("country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, status").eq("status", "Active");
        const listAll = (listRows ?? []) as (VisaRow & { country_id: string | null })[];
        const list = country ? listAll.filter((v) => v.country_id === country.id) : [];
        const row = list.find((v) => v.visa_type?.includes("سياح")) ?? list[0] ?? null;
        // every passport among the applicants: no visa only when none needs one; another passport is «check»
        const statuses = [known.nationality, ...(known.others ?? []).map((o) => o.nationality)]
          .filter((n): n is string => Boolean(n))
          .map((n) => (country ? visaFor(n, { iso2: country.iso2, visa_required: country.visa_required }, false) : "check"));
        const need2 = !country ? "check" : statuses.length === 0 ? visaFor(null, { iso2: country.iso2, visa_required: country.visa_required }, false) : statuses.every((x) => x === "not_required") ? "not_required" : statuses.includes("check") ? "check" : "required";
        const step = visaStep(known, { known: Boolean(country), required: country?.visa_required ?? null, status: need2, row, asks: visaAsked.length });
        const summary = visaSummary(known);
        // the same request answered already in this visit, nothing new said: no second answer (the decision below stays silent)
        const said = visaRows.filter((r) => r.reason === "visa:answered" || r.reason === "visa:handoff" || r.reason === "visa:not_needed").map((r) => r.intake?.summary);
        if (!said.includes(summary) || step.act === "ask") {
          // «شنغن» alone: the Schengen countries the list prices are named
          const schengen = known.schengen && !known.country ? listAll.filter((v) => SCHENGEN.has(countries.find((c) => c.id === v.country_id)?.iso2 ?? "")).map((v) => v.country) : null;
          if (step.act === "ask") {
            const text = `${request.salam && received.length === 0 ? "وعليكم السلام ورحمة الله، " : ""}${visaAskText(known.country, step.need, visaAsked.length === 0, schengen)}`;
            const replyId = await sendTeletelMessage(m.conversationId, text);
            await finish({ reason: replyId ? `visa:asked${visaAsked.length + 1}` : "send_failed", reply: text, reply_message_id: replyId, intake: { ...intake, country: known.country, visa: known, summary } });
            return replyId ? "asked" : "send_failed";
          }
          if (step.act === "not_needed" && country) {
            const text = notNeededText(country.arabic_name, [known.nationality_ar, ...(known.others ?? []).map((o) => o.nationality_ar)].filter(Boolean).join(" و") || null);
            const replyId = await sendTeletelMessage(m.conversationId, text);
            await finish({ reason: replyId ? "visa:not_needed" : "send_failed", reply: text, reply_message_id: replyId, intake: { ...intake, country: country.arabic_name, visa: known, summary } });
            await markLead(service, m, { inquiry: "تأشيرات", destination: country.arabic_name, route: "مُراد", at: new Date().toISOString(), waitSec });
            return replyId ? "answered" : "send_failed";
          }
          const rate = row?.sell_currency && row.sell_currency !== "SAR" ? ((await getRates().catch(() => null))?.sarPer[row.sell_currency] ?? null) : 1;
          const reason = step.act === "handoff" ? step.reason : !rate ? "السعر يحدده زميلنا بعد مراجعة الطلب" : null;
          const answer =
            !reason && row && rate && country
              ? visaAnswerText({ includePrice: settings.control.includePrice, country: country.arabic_name, row, applicants: known.applicants, sarPer: rate, check: need2 !== "required" || !known.nationality, topics: known.topics, need: step.act === "info" ? step.need : undefined })
              : null;
          const text = answer ?? visaHandoffText(reason ?? "السعر يحدده زميلنا بعد مراجعة الطلب", summary, opensAt ? sayTime(opensAt) : null);
          const replyId = await sendTeletelMessage(m.conversationId, text);
          if (!replyId) {
            await finish({ reason: "send_failed", reply: text, error: "send_failed" });
            return "send_failed";
          }
          const per = row?.sell_price && rate ? Math.ceil(row.sell_price * rate) : null;
          // «info» answers a question and keeps the request open; an answer or a hand-over goes to the visa team — and so does
          // a question the list does not answer (a refund, the visa's validity): never invented, the colleague answers it
          const open = uncoveredTopics(known.topics, row?.arabic_requirements ?? null);
          if (step.act === "info" && !open.length) {
            await finish({ reason: "visa:info", reply: text, reply_message_id: replyId, intake: { ...intake, country: known.country, visa: known, summary, price_per: per } });
            return "asked";
          }
          const teams = await listTeletelTeams();
          const handoff = settings.control.handoffs["تأشيرات"];
    const teamId = handoff?.teamId ?? teamFor(readRoutes(reception.routesRaw, teams), "تأشيرات");
          const team = teams.find((t) => t.id === teamId) ?? null;
          const assigned = await assignMuradHandoff(m.conversationId, teamId, handoff?.agentId ?? null);
          await addTeletelNote(
            m.conversationId,
            answer
              ? `🤖 طلب تأشيرة: ${summary}${open.length ? ` — يسأل عن: ${open.join("، ")} (ليست في قائمة التأشيرات)` : ""}${per ? ` — ${per.toLocaleString("en-US")} ريال للشخص${known.applicants && known.applicants > 1 ? ` × ${known.applicants} = ${(per * known.applicants).toLocaleString("en-US")} ريال` : ""}` : ""}. أُرسل للعميل ${settings.control.includePrice ? "السعر والمتطلبات" : "المتطلبات بدون السعر"} من قائمة التأشيرات${need2 !== "required" ? " (جنسية غير سعودية بين المتقدمين — تحقق من متطلباتها وسعرها)" : ""}، وينتظر المستندات.`
              : `🤖 طلب تأشيرة — يحتاج زميلاً (${reason}): ${summary}.`,
          );
          await finish({
            reason: answer ? "visa:answered" : "visa:handoff",
            reply: text,
            reply_message_id: replyId,
            intake: { ...intake, country: country?.arabic_name ?? known.country, visa: known, summary, price_per: per, handoff: answer ? null : reason, team_id: teamId, assigned },
          });
          await markLead(service, m, { inquiry: "تأشيرات", destination: country?.arabic_name ?? known.country, route: team?.name.trim() ?? DEPARTMENT["تأشيرات"], at: new Date().toISOString(), waitSec });
          return "routed:تأشيرات";
        }
      }
      // the model did not answer, or nothing new: the decision below (the visa team, or quiet when already handed over)
    }

    // after the offer: the client changed the trip — the same file, its next version («حدّثت الطلب»)
    if (offer && sentRow && free) {
      const trip = await readTrip(transcript, clientText, offer);
      const before = sentRow.intake ?? {};
      if (trip && tripChanged(before as Partial<OfferAsk>, trip)) {
        const merged: OfferAsk = { ...trip, name: trip.name ?? (before.name as string | null) ?? null, adults: trip.adults ?? (before.adults as number | null) ?? null };
        const special = specialOf(offer, merged);
        if (special) return await handOff(offer, merged, special);
        const days = tripDays(merged) ?? (before.days as number | null) ?? 0;
        const provisional = !merged.arrival;
        const arrival = merged.arrival ?? (before.arrival as string | null) ?? new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
        const rate = (await getRates().catch(() => null))?.sarPer[offer.currency] ?? (offer.currency === "USD" ? USD_SAR_DEFAULT : null);
        if (rate && days > 1 && merged.adults) {
          const price = priceOffer(offer, days, merged.adults, rate, { rooms: merged.rooms, onlyCity: merged.only_city });
          const name = merged.name ?? firstName(m.contactName) ?? "";
          const text = `حدّثت الطلب: ${tripSummary(offer.country, { ...merged, days, arrival: provisional ? null : arrival })}\n\n${offerText({ includePrice: settings.control.includePrice, name, country: offer.country, price, arrival, provisional, c: offer })}`;
          const replyId = await sendTeletelMessage(m.conversationId, text);
          if (!replyId) {
            await finish({ reason: "send_failed", reply: text, error: "send_failed" });
            return "send_failed";
          }
          const programs = await asSystem(MURAD, () => getTourPrograms(price.route.map((r) => r.city))).catch(() => []);
          const data = offerDraftData({ name, phone: m.phone, c: offer, arrival, provisional, days, adults: merged.adults, price, programs });
          const serial = typeof before.serial === "string" ? before.serial : null;
          let draftId = typeof before.draft_id === "string" ? before.draft_id : null;
          if (draftId) {
            await service.from("offer_drafts").update({ data: { ...data, produced_serial: serial }, title: `مُراد — ${name}`, updated_at: new Date().toISOString() }).eq("id", draftId);
          } else {
            const { data: row } = await service.from("offer_drafts").insert({ data, title: `مُراد — ${name}` }).select("id").maybeSingle();
            draftId = (row as { id: string } | null)?.id ?? null;
          }
          const issued = draftId && settings.control.includePrice ? await issueAndSend(draftId, m.conversationId, Boolean(serial)) : null;
          await addTeletelNote(
            m.conversationId,
            `🤖 عرض آلي: العميل حدّث الطلب — ${tripSummary(offer.country, { ...merged, days })}، ${price.totalSar.toLocaleString("en-US")} ريال.${issued ? ` صدرت النسخة ${issued.version} من ${issued.serial}${issued.sent ? " وأُرسلت للعميل" : ""}.` : " تعذّر إصدار النسخة — أصدرها من بيسك."}`,
          );
          await finish({
            reason: "offer:updated",
            reply: text,
            reply_message_id: replyId,
            intake: { ...before, country: offer.country, ...merged, days, arrival, provisional, total_sar: price.totalSar, draft_id: draftId, serial: issued?.serial ?? serial, version: issued?.version ?? null, link_sent: issued?.sent ?? false, sent_ids: issued?.ids ?? [], wait_sec: waitSec },
          });
          return "routed:بكج";
        }
      }
    }

    if ((offerOpen || tripWithVisa) && offer) {
      const trip = await readTrip(transcript, clientText, offer);
      if (trip) {
        const special = specialOf(offer, trip);
        if (special) return await handOff(offer, trip, special);
        const need = missing(trip);
        if (need.length && offerAsked.length < 2) {
          // the first question returns the client's salam, as the reception's greeting does
          const text = `${request.salam && offerAsked.length === 0 ? "وعليكم السلام ورحمة الله، " : ""}${askText(offer.country, need, offerAsked.length === 0, Boolean(trip.arrival))}`;
          const replyId = await sendTeletelMessage(m.conversationId, text);
          await finish({ reason: replyId ? `offer:asked${offerAsked.length + 1}` : "send_failed", reply: text, reply_message_id: replyId, intake: { country: offer.country, ...trip } });
          return replyId ? "asked" : "send_failed";
        }
        if (!need.length) {
          const days = tripDays(trip) ?? 0;
          const provisional = !trip.arrival;
          const arrival = trip.arrival ?? new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
          const rate = (await getRates().catch(() => null))?.sarPer[offer.currency] ?? (offer.currency === "USD" ? USD_SAR_DEFAULT : null);
          if (rate) {
            const price = priceOffer(offer, days, trip.adults ?? 2, rate, { rooms: trip.rooms, onlyCity: trip.only_city });
            const name = trip.name ?? firstName(m.contactName) ?? "";
            const text = `${offerText({ includePrice: settings.control.includePrice, name, country: offer.country, price, arrival, provisional, c: offer })}${visaLine ? `
${visaLine}` : ""}`;
            const replyId = await sendTeletelMessage(m.conversationId, text);
            if (!replyId) {
              await finish({ reason: "send_failed", reply: text, error: "send_failed" });
              return "send_failed";
            }
            // the cities' ready tours, read as Murad (getTourPrograms asks for a session)
            const programs = await asSystem(MURAD, () => getTourPrograms(price.route.map((r) => r.city))).catch(() => []);
            const { data: draftRow } = await service
              .from("offer_drafts")
              .insert({ data: offerDraftData({ name, phone: m.phone, c: offer, arrival, provisional, days, adults: trip.adults ?? 2, price, programs }), title: `مُراد — ${name}` })
              .select("id")
              .maybeSingle();
            const draftId = (draftRow as { id: string } | null)?.id ?? null;
            const issued = draftId && settings.control.includePrice ? await issueAndSend(draftId, m.conversationId) : null;
            const teams = await listTeletelTeams();
            const handoff = settings.control.handoffs["بكج"];
    const teamId = handoff?.teamId ?? teamFor(readRoutes(reception.routesRaw, teams), "بكج");
            const team = teams.find((t) => t.id === teamId) ?? null;
            const assigned = await assignMuradHandoff(m.conversationId, teamId, handoff?.agentId ?? null);
            const site = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
            await addTeletelNote(
              m.conversationId,
              `🤖 عرض آلي: ${tripSummary(offer.country, { ...trip, days })} — ${price.totalSar.toLocaleString("en-US")} ريال${provisional ? " (تواريخ مبدئية)" : ""}. ${issued ? `أُصدر العرض ${issued.serial}${issued.sent ? " وأُرسل للعميل رابطه وملف PDF" : " ولم يُرسل رابطه — أرسله من بيسك"}. الملف: ${site}/basic/${draftId} — تابع مع العميل للتأكيد.` : draftId ? `الملف في بيسك: ${site}/basic/${draftId} — راجعه وأصدره.` : "تعذّر إنشاء ملف بيسك."} ${assigned && team ? `حُوّلت إلى «${team.name}».` : ""}`,
            );
            const at = new Date().toISOString();
            await finish({ reason: "offer:sent", reply: text, reply_message_id: replyId, intake: { country: offer.country, ...trip, days, arrival, provisional, total_sar: price.totalSar, draft_id: draftId, serial: issued?.serial ?? null, version: issued?.version ?? null, link_sent: issued?.sent ?? false, sent_ids: issued?.ids ?? [], team_id: teamId, assigned, wait_sec: waitSec } });
            await markLead(service, m, { inquiry: "بكج", destination: offer.country, route: team?.name.trim() ?? DEPARTMENT["بكج"], at, waitSec, draftId: draftId ?? undefined, name: trip.name });
            return "routed:بكج";
          }
        }
      }
      // not priced this way (a model that did not answer, still missing after two asks): a colleague's
      routeAs = { ...request, kind: "بكج" };
    }

    const decision = decideReception({
      routed: done,
      asked: received.some((r) => r.reason === "asked"),
      staffReplied,
      // handed to someone BY A PERSON while Murad waited — Teletel's own auto-assignment on arrival is no one taking it
      handedByHand,
      canReply: thread.canReply,
      request: routeAs,
    });

    if (decision.act === "none") {
      // handed over, out of hours, and the client wrote again: what was heard, and when a colleague takes it (the
      // owner, 2026-10-19: «سجّلت: جورجيا، شخصين، 10 أيام… زميلنا يجهزه لك أول الدوام») — twice a visit at most
      if (decision.why === "routed" && opensAt && free && received.filter((r) => r.reason === "ack").length < 2) {
        const trip = offer ? await readTrip(transcript, clientText, offer) : null;
        const text = trip && offer
          ? `سجّلت: ${tripSummary(offer.country, trip)} — زميلنا يجهزه لك عند بداية الدوام الساعة ${sayTime(opensAt)}.`
          : `وصلت رسالتك وسجّلتها، وزميلنا يكمل معك عند بداية الدوام الساعة ${sayTime(opensAt)}.`;
        const replyId = await sendTeletelMessage(m.conversationId, text);
        await finish({ reason: replyId ? "ack" : "send_failed", reply: text, reply_message_id: replyId, intake: { ...intake, ...(trip ? { trip } : {}) } });
        return replyId ? "none:routed" : "send_failed";
      }
      await finish({ reason: `none:${decision.why}`, intake });
      return `none:${decision.why}`;
    }

    if (decision.act === "ask") {
      const text = clarifyText(request.salam);
      const replyId = await sendTeletelMessage(m.conversationId, text);
      await finish({ reason: replyId ? "asked" : "send_failed", reply: text, reply_message_id: replyId, intake, ...(replyId ? {} : { error: "send_failed" }) });
      return replyId ? "asked" : "send_failed";
    }

    // the hand-over: the greeting by name — the one the client gave in this visit first — the department, the team in Teletel
    const text = receptionText({ name: firstName(knownName ?? m.contactName), salam: request.salam, to: decision.to, opensAt });
    const replyId = await sendTeletelMessage(m.conversationId, text);
    if (!replyId) {
      await finish({ reason: "send_failed", reply: text, intake, error: "send_failed" });
      return "send_failed";
    }
    const teams = await listTeletelTeams();
    const handoff = settings.control.handoffs[decision.to];
    const teamId = handoff?.teamId ?? teamFor(readRoutes(reception.routesRaw, teams), decision.to);
    const team = teams.find((t) => t.id === teamId) ?? null;
    const assigned = await assignMuradHandoff(m.conversationId, teamId, handoff?.agentId ?? null);
    await addTeletelNote(
      m.conversationId,
      `🤖 المستقبل الآلي: ${decision.to}${request.country ? ` · ${request.country}` : ""} — ${assigned && team ? `حُوّلت إلى «${team.name}»` : "لا فريق لهذا القسم في الإعدادات — بانتظار من يستلمها"}`,
    );
    const at = now.toISOString();
    await finish({
      reason: `routed:${decision.to}`,
      reply: text,
      reply_message_id: replyId,
      intake: { ...intake, team_id: teamId, team: team?.name ?? null, assigned },
      ...(teamId && !assigned ? { error: "assign_failed" } : {}),
    });
    await markLead(service, m, {
      inquiry: decision.to === "غير واضح" ? "طلب غير واضح" : decision.to === "موظف" ? null : decision.to,
      destination: request.country ?? (await countryOf(service, said)),
      route: team?.name.trim() ?? DEPARTMENT[decision.to],
      at,
      waitSec,
    });
    return `routed:${decision.to}`;
  } catch (error) {
    await finish({ reason: "error", error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
    return "unreadable";
  }
}

/** Today's reception, for /developer: handed over, asked, held back — and the latest few. */
// ---------- «تأخير بشري»: the wait before Murad answers ----------

type Waiting = { first: number; extended: boolean; message: IncomingMessage; timer: ReturnType<typeof setTimeout> };
// ponytail: one server process (the VPS), so the waits live in it; a restart drops them and the minute sweep answers instead
const waiting = new Map<number, Waiting>();

/**
 * The webhook's entry: an incoming message in scope is marked read at once,
 * and answered after a person's pause — 20–60 seconds unless set. A message
 * that comes during the wait restarts the count once (never past 90 seconds
 * from the first); the answer then reads every message of the burst.
 */
export async function schedule(m: IncomingMessage): Promise<"waiting" | "extended" | "off" | "out_of_scope" | "unreadable"> {
  if (!m.conversationId || !m.messageId) return "unreadable";
  const service = db();
  const [flags, settings, reception] = await Promise.all([getFeatureFlags(), readSettings(service), readReceptionSettings(service)]);
  if (!flags.murad_reception || !settings.control.tasks.reception || settings.clientWhatsapp === "off") return "off";
  const phone = intlPhone(m.phone);
  if (reception.scope !== "all" && (!phone || !settings.autoList.includes(phone)) && !(settings.control.visaAll && settings.control.tasks.visas && await visaConversation(service, m))) return "out_of_scope";
  if (settings.control.inboxIds.length || settings.control.teamIds.length) {
    const thread = await readThread(m.conversationId);
    if (!thread) return "unreadable";
    if (!inMuradScope(settings.control, thread.inboxId ?? null, thread.teamId ?? null)) return "out_of_scope";
  }
  void markTeletelSeen(m.conversationId);
  const delay = parseDelay(reception.delay);
  const now = Date.now();
  const had = waiting.get(m.conversationId);
  if (had) {
    had.message = { ...m, since: had.first };
    if (had.extended) return "extended";
    had.extended = true;
    clearTimeout(had.timer);
    const until = Math.min(now + pickDelay(delay) * 1000, had.first * 1000 + MAX_WAIT_SEC * 1000);
    had.timer = setTimeout(() => void answerNow(m.conversationId), Math.max(until - now, 1000));
    return "extended";
  }
  const first = m.at || Math.floor(now / 1000);
  waiting.set(m.conversationId, {
    first,
    extended: false,
    message: { ...m, since: first },
    timer: setTimeout(() => void answerNow(m.conversationId), pickDelay(delay) * 1000),
  });
  return "waiting";
}

/** The wait is over: «يكتب…» a moment, then the answer (receive() checks again that no colleague came in between). */
async function answerNow(conversationId: number): Promise<void> {
  const w = waiting.get(conversationId);
  waiting.delete(conversationId);
  if (!w) return;
  await setTeletelTyping(conversationId, true).catch(() => false);
  await new Promise((r) => setTimeout(r, 2500 + Math.round(Math.random() * 2000)));
  await receive(w.message).catch(() => undefined);
  await setTeletelTyping(conversationId, false).catch(() => false);
}

export async function receptionToday(): Promise<{ routed: number; asked: number; other: number; recent: { at: string; phone: string; reason: string; reply: string; waitSec: number | null }[] }> {
  const start = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })}T00:00:00+03:00`).toISOString();
  const { data } = await db().from("murad_log").select("created_at, phone, reason, reply, intake").eq("mode", "reception").gte("created_at", start).order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as { created_at: string; phone: string | null; reason: string | null; reply: string | null; intake: { wait_sec?: number } | null }[];
  return {
    routed: rows.filter((r) => r.reason?.startsWith("routed")).length,
    asked: rows.filter((r) => r.reason === "asked").length,
    other: rows.filter((r) => !r.reason?.startsWith("routed") && r.reason !== "asked").length,
    recent: rows.slice(0, 8).map((r) => ({ at: r.created_at, phone: maskPhone(r.phone), reason: r.reason ?? "", reply: (r.reply ?? "").slice(0, 90), waitSec: typeof r.intake?.wait_sec === "number" ? r.intake.wait_sec : null })),
  };
}

/**
 * The minute job's fallback for what the webhook missed (not registered yet, a
 * restart, Teletel retrying late): a conversation in scope whose client has
 * waited on us under half an hour (a new one, or one the client reopened) and
 * no reception turn in that half hour — its latest client message is received
 * as if it had just arrived; receive() decides, its claim keeps it to once.
 */
export async function receptionSweep(): Promise<number> {
  const service = db();
  const [flags, settings, reception, list] = await Promise.all([getFeatureFlags(), readSettings(service), readReceptionSettings(service), listOpenConversations()]);
  if (!flags.murad_reception || !settings.control.tasks.reception || !list) return 0;
  if (settings.control.visaAll && settings.control.tasks.visas) await retryVisaHandoffs(service);
  const nowSec = Math.floor(Date.now() / 1000);
  // a client waiting on us for under half an hour — a new conversation, or an old one the client reopened
  const { data: visaLeads } = settings.control.visaAll ? await service.from("client_leads").select("teletel_conversation_id").eq("inquiry", "تأشيرات").eq("status", "open") : { data: [] };
  const visaIds = new Set((visaLeads ?? []).map((l) => Number(l.teletel_conversation_id)));
  const fresh = list.rows.filter((c) => inMuradScope(settings.control, c.inboxId, c.teamId) && c.waitingSince > 0 && nowSec - c.waitingSince < 1800 && (reception.scope === "all" || (settings.control.visaAll && visaIds.has(c.id)) || settings.autoList.includes(intlPhone(c.phone) ?? "")));
  if (!fresh.length) return 0;
  // where Murad's own five-minute answer runs (run.ts: murad_auto on the auto list) it answers the client's words — better than «وصلت رسالتك», and it comes next in this same run
  const held = settings.control.tasks.holding && reception.scope === "all" ? await holdSweep(service, fresh.filter((c) => !(flags.murad_auto && settings.autoList.includes(intlPhone(c.phone) ?? ""))), nowSec, reception.hours) : 0;
  const { data } = await service
    .from("murad_log")
    .select("conversation_id")
    .eq("mode", "reception")
    .in("conversation_id", fresh.map((c) => c.id))
    .gte("created_at", new Date((nowSec - 1800) * 1000).toISOString());
  const seen = new Set(((data ?? []) as { conversation_id: number }[]).map((r) => Number(r.conversation_id)));
  let n = 0;
  // a conversation Murad is already waiting on is his to answer when the wait ends
  for (const c of fresh.filter((x) => !seen.has(x.id) && !waiting.has(x.id)).slice(0, 5)) {
    const thread = await readThread(c.id);
    const last = [...(thread?.messages ?? [])].reverse().find((t) => t.fromClient && !t.isPrivate);
    if (!thread || !last) continue;
    const out = await receive({ conversationId: c.id, messageId: last.id, at: last.at, phone: c.phone, contactName: thread.name || c.name, content: last.text });
    if (out === "asked" || out.startsWith("routed")) n += 1;
  }
  return n + held;
}

/** how long a client may wait on the colleague Murad handed them to before Murad says it arrived */
const HOLD_AFTER_SEC = 300;

/**
 * «وصلت رسالتك» (the evaluator, 2026-10-19): after Murad handed the visit over,
 * the client wrote and no one has answered for five minutes — once a visit,
 * Murad says it arrived and who answers it (holdText), and a note mentions
 * that colleague so Teletel notifies them. Claimed in murad_log as the
 * client message's NEGATIVE id (its own id is the reception's turn already).
 * Not where run.ts answers the wait itself (the two test numbers while
 * murad_auto is on): there the client hears an answer to what they wrote.
 * ponytail: the colleague only; their supervisor too when the teams name one.
 */
async function holdSweep(service: SupabaseClient, fresh: OpenConversation[], nowSec: number, hoursRaw: string | null): Promise<number> {
  const late = fresh.filter((c) => c.canReply && nowSec - c.waitingSince >= HOLD_AFTER_SEC && !waiting.has(c.id));
  if (!late.length) return 0;
  const { data } = await service
    .from("murad_log")
    .select("conversation_id, reason, created_at")
    .eq("mode", "reception")
    .in("conversation_id", late.map((c) => c.id))
    .gte("created_at", new Date((nowSec - VISIT_SEC) * 1000).toISOString());
  const rows = (data ?? []) as { conversation_id: number; reason: string | null; created_at: string }[];
  const hours = parseHours(hoursRaw);
  let n = 0;
  for (const c of late.slice(0, 5)) {
    const mine = rows.filter((r) => Number(r.conversation_id) === c.id);
    const handedAt = Math.max(0, ...mine.filter((r) => r.reason?.startsWith("routed") || r.reason === "offer:sent" || r.reason === "offer:updated" || r.reason === "offer:handoff").map((r) => Date.parse(r.created_at) / 1000));
    // not handed over by Murad, or the client has waited since before (the hand-over was the answer)
    if (!handedAt || c.waitingSince < handedAt) continue;
    if (mine.some((r) => r.reason === "hold" && Date.parse(r.created_at) / 1000 >= handedAt)) continue;
    const thread = await readThread(c.id);
    const last = [...(thread?.messages ?? [])].reverse().find((t) => t.fromClient && !t.isPrivate);
    if (!last) continue;
    const claim = await service
      .from("murad_log")
      .insert({ conversation_id: c.id, client_message_id: -last.id, client_message_at: new Date(c.waitingSince * 1000).toISOString(), phone: c.phone, mode: "reception" })
      .select("id")
      .maybeSingle();
    if (claim.error || !claim.data) continue;
    const text = holdText({ assignee: c.assignee, team: c.team, opensAt: isWorkingTime(new Date(), hours) ? null : hours.open });
    const replyId = await sendTeletelMessage(c.id, text);
    if (replyId && (c.assignee || c.team)) {
      await addTeletelNote(c.id, `🤖 ${noteFor(c)} العميل كتب بعد التحويل وينتظر منذ ${Math.round((nowSec - c.waitingSince) / 60)} دقائق بلا رد — طمأنه مُراد. ردّ عليه الآن.`);
    }
    await service
      .from("murad_log")
      .update({ reason: replyId ? "hold" : "send_failed", reply: text, reply_message_id: replyId, acted_at: new Date().toISOString(), ...(replyId ? {} : { error: "send_failed" }) })
      .eq("id", (claim.data as { id: string }).id);
    if (replyId) n += 1;
  }
  return n;
}

/**
 * The token in Teletel's webhook URL: a hash of ADMIN_API_SECRET, never the
 * secret itself — Chatwoot sends no signature and no custom header, so the URL
 * is what proves the caller (api/teletel/webhook). Null without the secret.
 */
export function webhookToken(): string | null {
  const secret = process.env["ADMIN_API_SECRET"];
  return secret ? createHash("sha256").update(`teletel-webhook:${secret}`).digest("hex").slice(0, 40) : null;
}
