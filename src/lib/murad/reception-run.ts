import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getFeatureFlags } from "@/lib/features-server";
import {
  addTeletelNote,
  assignTeletelTeam,
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
import { askText, holdToText, missing, offerDraftData, offerText, outOfRule, priceOffer, readOffers, tripDays, type OfferAsk } from "./auto-offer";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { fold, normalizePhone } from "@/lib/leads/sheet";
import { isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
import { isHumanReply, maskPhone, noteFor, SETTING } from "./core";
import { readSettings, readThread } from "./run";
import {
  clarifyText,
  decideReception,
  DEPARTMENT,
  firstName,
  holdText,
  isWorkingTime,
  MAX_WAIT_SEC,
  parseDelay,
  parseHours,
  pickDelay,
  readRequest,
  readRoutes,
  receptionText,
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
 * The name, dates, days and party from the client's own words — Arabic
 * months, «شخصين», «انا وزوجتي» — by the model, with today's date to place a
 * month in the right year. Null on any failure: the conversation then goes to
 * a colleague like any other.
 */
async function readTrip(text: string): Promise<OfferAsk | null> {
  if (!isOpenAIConfigured()) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  try {
    const raw = await openaiJson({
      name: "trip_facts",
      system: [
        `Today is ${today} (Riyadh). A client writes to a travel company in Arabic. Extract only what the client actually said:`,
        "name: the client's own personal name if they gave it (e.g. «محمد») — never a place, and never words about who travels («انا وزوجتي», «شخصين», «عائلة»), which are null; arrival_date / departure_date as YYYY-MM-DD in the future (a month without a year is the next one to come);",
        "days: the trip's length in days if they said it («10 أيام», «اسبوع» = 7); adults and children counts («شخصين» = 2 adults, «انا وزوجتي» = 2 adults, «عائلة 4» unknown split = 4 adults only if no children are mentioned).",
        "null for anything not said. Never invent.",
      ].join(" "),
      user: text.slice(0, 2000),
      schema: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          arrival_date: { type: ["string", "null"] },
          departure_date: { type: ["string", "null"] },
          days: { type: ["integer", "null"] },
          adults: { type: ["integer", "null"] },
          children: { type: ["integer", "null"] },
        },
        required: ["name", "arrival_date", "departure_date", "days", "adults", "children"],
        additionalProperties: false,
      },
      temperature: 0,
      timeoutMs: 15000,
    });
    const r = JSON.parse(raw ?? "{}") as { name: string | null; arrival_date: string | null; departure_date: string | null; days: number | null; adults: number | null; children: number | null };
    return holdToText(text, { name: r.name, arrival: r.arrival_date, departure: r.departure_date, days: r.days, adults: r.adults, children: r.children }, today);
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

async function issueAndSend(draftId: string, conversationId: number): Promise<{ serial: string; sent: boolean } | null> {
  return asSystem(MURAD, async () => {
    const issued = await produceOfferFromDraft(draftId).catch(() => null);
    if (!issued?.ok) return null;
    const { serial } = issued;
    const message = await offerMessage(serial, false);
    if (!message) return { serial, sent: false };
    const sent = (await sendTeletelMessage(conversationId, tidyWhatsapp(message.text))) !== null;
    if (sent) {
      // Chromium takes seconds; the client has the link meanwhile
      const bytes = await clientOfferPdf(serial).catch(() => null);
      if (bytes) await sendTeletelAttachment(conversationId, "📎 برنامج رحلتك", { name: message.pdfName, type: "application/pdf", bytes });
      const { data: offer } = await db().from("offers").select("id").eq("serial", serial).maybeSingle();
      const offerId = (offer as { id: string } | null)?.id;
      if (offerId) await logAudit({ action: "offer.client_sent", entity: "offers", entity_id: offerId, meta: { result: "sent", version: 1, serial, by: "murad", pdf: Boolean(bytes) } });
    }
    return { serial, sent };
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
  fields: { inquiry: string | null; destination: string | null; route: string; at: string; waitSec: number; draftId?: string; name?: string | null },
): Promise<void> {
  const name = m.contactName.trim();
  const realName = name && !name.startsWith("#") && normalizePhone(name) !== normalizePhone(m.phone) ? name : null;
  const { data } = await service.from("client_leads").select("id, name, inquiry, destination, status, created_at, last_visit_at").eq("teletel_conversation_id", m.conversationId).maybeSingle();
  const had = data as { id: string; name: string | null; inquiry: string | null; destination: string | null; status: string; created_at: string; last_visit_at: string | null } | null;
  const routed = {
    auto_route: fields.route,
    auto_routed_at: fields.at,
    auto_wait_sec: fields.waitSec,
    assigned_at: fields.at,
    assignee_reply_at: null,
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
        ...(fields.inquiry ? { inquiry: fields.inquiry } : {}),
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

export async function receive(m: IncomingMessage): Promise<ReceptionOutcome> {
  if (!m.conversationId || !m.messageId) return "unreadable";
  const service = db();
  const [flags, settings, reception] = await Promise.all([getFeatureFlags(), readSettings(service), readReceptionSettings(service)]);
  if (!flags.murad_reception || settings.clientWhatsapp === "off") return "off";
  const phone = intlPhone(m.phone);
  // the trial: the owner's two numbers only, until they widen it from /developer
  if (reception.scope !== "all" && (!phone || !settings.autoList.includes(phone))) return "out_of_scope";

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
    if (!thread) {
      await finish({ reason: "unreadable", error: "teletel: the thread could not be read" });
      return "unreadable";
    }
    const rows = (past.data ?? []) as { mode: string; reason: string | null; reply_message_id: number | null; created_at: string; intake: { country?: string | null } | null }[];
    // this visit, not the conversation's whole life: WhatsApp reopens the same conversation when a client writes
    // again — a reception or a colleague's answer from back then is not this time's. A conversation closed
    // (resolved) before this message starts a new visit here and now (the owner, 2026-10-18: «لكي يكون طلباً
    // جديداً كاملاً»); an open one reaches back 12 hours, never before the visit it is in.
    const { data: leadRow } = await service.from("client_leads").select("id, status, last_visit_at").eq("teletel_conversation_id", m.conversationId).maybeSingle();
    const lead = leadRow as { id: string; status: string; last_visit_at: string | null } | null;
    let visitStart = Math.max(m.at - VISIT_SEC, lead?.last_visit_at ? Date.parse(lead.last_visit_at) / 1000 : 0);
    if (lead?.status === "closed") {
      visitStart = since;
      await service.from("client_leads").update({ status: "open", last_visit_at: new Date(since * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", lead.id);
    }
    const thisVisit = (sec: number) => sec >= visitStart - 1;
    const received = rows.filter((r) => r.mode === "reception" && thisVisit(Date.parse(r.created_at) / 1000));
    const ours = new Set(rows.filter((r) => r.reply_message_id != null).map((r) => Number(r.reply_message_id)));
    // everything the client wrote while Murad waited, read as one («ابغى» … «تأشيرة» … «الى لندن»)
    const said = thread.messages.filter((t) => t.fromClient && !t.isPrivate && t.at >= since).map((t) => t.text).join("\n").trim() || m.content;
    const request = readRequest(said, places);
    const waitSec = Math.max(0, Math.round(Date.now() / 1000 - since));
    const intake = { kind: request.kind, country: request.country, wants_human: request.wantsHuman, wait_sec: waitSec };
    const staffReplied = thread.messages.some((t) => thisVisit(t.at) && isHumanReply(t, ours));
    const handedByHand = (events ?? []).some((e) => e.kind === "activity" && e.at >= since && parseAssignment(e.text)?.by != null);

    // «عرض آلي»: a trip to a country the company prices this way — asked for what is missing, then proposed
    const offers = readOffers(reception.offersRaw);
    const offerAsked = received.filter((r) => r.reason?.startsWith("offer:asked"));
    const offerCountry = offerAsked[0]?.intake?.country ?? request.country;
    const offer = offers.find((o) => o.enabled && offerCountry && fold(o.country) === fold(offerCountry));
    const done = received.some((r) => r.reason?.startsWith("routed") || r.reason === "offer:sent");
    // a trip to such a country that Murad does not price himself still goes to packages, never to «كيف نقدر نخدمك»
    let routeAs = request;
    if (offer && !done && !staffReplied && !handedByHand && thread.canReply && !request.wantsHuman && (offerAsked.length > 0 || request.kind === "بكج" || request.kind === null)) {
      const visitSaid = thread.messages.filter((t) => t.fromClient && !t.isPrivate && thisVisit(t.at)).map((t) => t.text).join("\n");
      const trip = await readTrip(visitSaid || said);
      if (trip && !outOfRule(trip, offer)) {
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
          const rate = (await getRates().catch(() => null))?.sarPer[offer.currency] ?? (offer.currency === "USD" ? 3.75 : null);
          if (rate) {
            const price = priceOffer(offer, days, trip.adults ?? 2, rate);
            const name = trip.name ?? firstName(m.contactName) ?? "";
            const text = offerText({ name, country: offer.country, price, arrival, provisional, c: offer });
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
            const issued = draftId ? await issueAndSend(draftId, m.conversationId) : null;
            const teams = await listTeletelTeams();
            const teamId = teamFor(readRoutes(reception.routesRaw, teams), "بكج");
            const team = teams.find((t) => t.id === teamId) ?? null;
            const assigned = teamId ? await assignTeletelTeam(m.conversationId, teamId) : false;
            const site = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
            await addTeletelNote(
              m.conversationId,
              `🤖 عرض آلي: ${offer.country} ${days} أيام لـ${trip.adults ?? 2} — ${price.totalSar.toLocaleString("en-US")} ريال${provisional ? " (تواريخ مبدئية)" : ""}. ${issued ? `أُصدر العرض ${issued.serial}${issued.sent ? " وأُرسل للعميل رابطه وملف PDF" : " ولم يُرسل رابطه — أرسله من بيسك"}. الملف: ${site}/basic/${draftId} — تابع مع العميل للتأكيد.` : draftId ? `الملف في بيسك: ${site}/basic/${draftId} — راجعه وأصدره.` : "تعذّر إنشاء ملف بيسك."} ${assigned && team ? `حُوّلت إلى «${team.name}».` : ""}`,
            );
            const at = new Date().toISOString();
            await finish({ reason: "offer:sent", reply: text, reply_message_id: replyId, intake: { country: offer.country, ...trip, days, arrival, provisional, total_sar: price.totalSar, draft_id: draftId, serial: issued?.serial ?? null, link_sent: issued?.sent ?? false, team_id: teamId, assigned, wait_sec: waitSec } });
            await markLead(service, m, { inquiry: "بكج", destination: offer.country, route: team?.name.trim() ?? DEPARTMENT["بكج"], at, waitSec, draftId: draftId ?? undefined, name: trip.name });
            return "routed:بكج";
          }
        }
      }
      // not priced this way (more than four, children, a model that did not answer, still missing after two asks): a colleague's
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
      await finish({ reason: `none:${decision.why}`, intake });
      return `none:${decision.why}`;
    }

    if (decision.act === "ask") {
      const text = clarifyText(request.salam);
      const replyId = await sendTeletelMessage(m.conversationId, text);
      await finish({ reason: replyId ? "asked" : "send_failed", reply: text, reply_message_id: replyId, intake, ...(replyId ? {} : { error: "send_failed" }) });
      return replyId ? "asked" : "send_failed";
    }

    // the hand-over: the greeting by name, the department, the team in Teletel
    const hours = parseHours(reception.hours);
    const now = new Date();
    const text = receptionText({ name: firstName(m.contactName), salam: request.salam, to: decision.to, opensAt: isWorkingTime(now, hours) ? null : hours.open });
    const replyId = await sendTeletelMessage(m.conversationId, text);
    if (!replyId) {
      await finish({ reason: "send_failed", reply: text, intake, error: "send_failed" });
      return "send_failed";
    }
    const teams = await listTeletelTeams();
    const teamId = teamFor(readRoutes(reception.routesRaw, teams), decision.to);
    const team = teams.find((t) => t.id === teamId) ?? null;
    const assigned = teamId ? await assignTeletelTeam(m.conversationId, teamId) : false;
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
      inquiry: decision.to === "موظف" || decision.to === "غير واضح" ? null : decision.to,
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
  if (!flags.murad_reception || settings.clientWhatsapp === "off") return "off";
  const phone = intlPhone(m.phone);
  if (reception.scope !== "all" && (!phone || !settings.autoList.includes(phone))) return "out_of_scope";
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
  if (!flags.murad_reception || !list) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  // a client waiting on us for under half an hour — a new conversation, or an old one the client reopened
  const fresh = list.rows.filter((c) => c.waitingSince > 0 && nowSec - c.waitingSince < 1800 && (reception.scope === "all" || settings.autoList.includes(intlPhone(c.phone) ?? "")));
  if (!fresh.length) return 0;
  // where Murad's own five-minute answer runs (run.ts: murad_auto on the auto list) it answers the client's words — better than «وصلت رسالتك», and it comes next in this same run
  const held = await holdSweep(service, fresh.filter((c) => !(flags.murad_auto && settings.autoList.includes(intlPhone(c.phone) ?? ""))), nowSec, reception.hours);
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
    const handedAt = Math.max(0, ...mine.filter((r) => r.reason?.startsWith("routed") || r.reason === "offer:sent").map((r) => Date.parse(r.created_at) / 1000));
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
