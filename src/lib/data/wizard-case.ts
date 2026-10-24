import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { listOperationPayments, listOperations, type OperationPayment } from "@/lib/data/operations";
import { listInstallments } from "@/lib/data/operation-payments";
import { listBookings, listDocuments, type OperationBooking, type OperationDocument } from "@/lib/data/operation-bookings";
import { listOrSeedTravelers } from "@/lib/data/operation-travelers";
import { getSupplierWork } from "@/lib/data/supplier-work";
import { getCaseGuide } from "@/lib/data/destination-guides";
import { notifyOps } from "@/lib/data/ops-notify";
import { translate, type TranslationKey } from "@/lib/i18n";
import { riyadhDate } from "@/lib/operations/payments";
import { toTravelerListItem, type TravelerRow } from "@/lib/operations/traveler-dto";
import { ownStates, readiness, readyToTravel, staleWaits } from "@/lib/operations/wizard/index";
import { followUpOf, readWaits, withoutWaits, type FollowUpItem, type FollowUpTone } from "@/lib/operations/wizard/followup";
import { writeWaits } from "@/lib/data/wizard-sync";
import { seedBookingsFromOffer } from "@/lib/data/operation-seed";
import { offerBookingKinds } from "@/lib/data/offer-pull";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { getOcrProvider } from "@/lib/repackage/extract/ocr";
import { currentCan } from "@/lib/roles/current";
import { hotelIdOf } from "@/lib/operations/voucher-dto";
import type { ReadinessItem, ReadyExceptions, WizardCase } from "@/lib/operations/wizard/types";

/**
 * «معالج الحجوزات» on the server: the one load every step reads (the case
 * page, and the «جاهز للسفر» gate in setExecutionStatus — the same data, the
 * same rules, so the button and the server cannot disagree), and the
 * follow-up list of the waits whose day has come.
 *
 * NOT a server action: every list below is the session's own gated loader
 * (operations/access.ts), so this reads exactly what the caller may see.
 *
 * Loading the case also drops the «ينتظر» of every step now done, whichever
 * screen finished it («عرض الكل» loads this too) — the server half of the
 * rule; operation-sync drops the bookings' steps' after each confirmation.
 *
 * A case with no booking at all is pulled from its offer here, as its
 * travelers are seeded: the wizard has no «اسحب» of its own to forget to press.
 */

/** The case's bookings — pulled from the offer first when it holds none yet (the pull adds no twin). */
async function listOrPullBookings(operationId: string) {
  const listed = await listBookings(operationId);
  if (listed.length > 0) return listed;
  const pulled = await seedBookingsFromOffer(operationId);
  return pulled.ok && pulled.added > 0 ? listBookings(operationId) : listed;
}

/**
 * Which hotel bookings TBO can book — their hotel was picked from TBO's list in /basic — and whether the caller may
 * commit one (operations.book). The links are no secret, but where we buy is staff's: the case is already gated.
 */
async function tboOf(bookings: OperationBooking[]): Promise<Pick<WizardCase, "tboBookings" | "canBook">> {
  const hotels = bookings.filter((b) => b.kind === "hotel").map((b) => ({ id: b.id, hotel: hotelIdOf(b.detail) })).filter((b) => b.hotel);
  const canBook = await currentCan("operations.book");
  if (!hotels.length) return { tboBookings: [], canBook };
  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await service.from("hotel_content_cache").select("internal_hotel_id").eq("supplier", "tbo").in("internal_hotel_id", [...new Set(hotels.map((h) => h.hotel!))]);
  const linked = new Set(((data ?? []) as { internal_hotel_id: string }[]).map((r) => r.internal_hotel_id));
  return { tboBookings: hotels.filter((h) => linked.has(h.hotel!)).map((h) => h.id), canBook };
}

/** null when the case is not the caller's to see, or does not exist. */
export async function loadWizardCase(operationId: string): Promise<WizardCase | null> {
  const operation = (await listOperations()).find((o) => o.id === operationId);
  if (!operation) return null;
  const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
  const [travelers, payments, installments, bookings, documents, supplierWork, guide, days, op, offer, offerKinds, offerHotels] = await Promise.all([
    // a new case starts with the travelers the offer was sold for
    listOrSeedTravelers(operationId),
    listOperationPayments(operationId),
    listInstallments(operationId),
    listOrPullBookings(operationId),
    listDocuments(operationId),
    getSupplierWork(operationId),
    getCaseGuide(operationId),
    supabase.from("offer_days").select("id", { count: "exact", head: true }).eq("offer_id", operation.offer_id),
    supabase.from("operations").select("client_token, client_token_revoked_at, waits, ready_exceptions").eq("id", operationId).maybeSingle(),
    supabase.from("offers").select("adults, children, infants").eq("id", operation.offer_id).maybeSingle(),
    // what the offer books — «لا ينطبق» only for a kind it has none of (the caller sees this case: listOperations)
    offerBookingKinds(operationId),
    // the hotels the offer sold, by catalogue id: their missing address/phone/English name is a job here, not in sales
    supabase.from("offer_hotels").select("hotel_id, hotel_name").eq("offer_id", operation.offer_id),
  ]);
  const row = op.data as { client_token: string | null; client_token_revoked_at: string | null; waits: unknown; ready_exceptions: unknown } | null;
  const pax = offer.data as { adults: number | null; children: number | null; infants: number | null } | null;
  const exceptions = row?.ready_exceptions;
  const data: WizardCase = {
    operation,
    travelers,
    payments,
    installments,
    bookings,
    documents,
    supplierWork,
    clientToken: row?.client_token && !row.client_token_revoked_at ? row.client_token : null,
    waits: readWaits(row?.waits),
    readyExceptions: exceptions && typeof exceptions === "object" ? (exceptions as ReadyExceptions) : {},
    hasDays: (days.count ?? 0) > 0,
    today: riyadhDate(),
    sold: pax ? { adults: pax.adults ?? 0, children: pax.children ?? 0, infants: pax.infants ?? 0 } : null,
    guide,
    offerKinds,
    offerHotels: ((offerHotels.data ?? []) as { hotel_id: string | null; hotel_name: string | null }[]).map((h) => ({ hotel_id: h.hotel_id, hotel_name: h.hotel_name ?? "" })),
    // the readers upload-text.ts tries for a picture; without either, only text reads
    readsImages: isOpenAIConfigured() || getOcrProvider().isConfigured(),
    ...(await tboOf(bookings)),
  };
  // a step that is done no longer waits on anyone
  const stale = staleWaits(data.waits, ownStates(data));
  if (stale.length > 0) {
    const res = await writeWaits(supabase, operationId, (waits) => withoutWaits(waits, stale));
    if (res.ok && res.waits) data.waits = res.waits;
  }
  return data;
}

/** The «جاهز للسفر» gate — every mandatory readiness item of every step. */
export async function wizardReady(operationId: string): Promise<boolean> {
  const data = await loadWizardCase(operationId);
  return data !== null && readyToTravel(readiness(data));
}

/**
 * What still blocks «جاهز للسفر» — the wizard's own mandatory items, for the
 * morning's 7/3/1-day alerts (daily.ts). The cron has no session, so this
 * loads with the service role exactly what the rules read (ReadinessCase);
 * the caller must have a reason to see every case. The destination's guide is
 * not looked up: it feeds an optional item only, and only blockers come back.
 * null when the case could not be read.
 */
export async function travelBlockers(operationId: string): Promise<ReadinessItem[] | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: op } = await supabase
      .from("operations")
      .select("offer_id, travel_start, travel_end, client_token, client_token_revoked_at, ready_exceptions, offers(total, adults, children, infants)")
      .eq("id", operationId)
      .maybeSingle();
    type Offer = { total: number | string | null; adults: number | null; children: number | null; infants: number | null };
    const row = op as unknown as {
      offer_id: string;
      travel_start: string | null;
      travel_end: string | null;
      client_token: string | null;
      client_token_revoked_at: string | null;
      ready_exceptions: unknown;
      offers: Offer | Offer[] | null;
    } | null;
    if (!row) return null;
    const offer = one(row.offers);
    const [bookings, documents, payments, travelers, days] = await Promise.all([
      supabase.from("operation_bookings").select("*").eq("operation_id", operationId),
      supabase.from("operation_documents").select("id, kind, booking_id, version, token, revoked_at, created_at").eq("operation_id", operationId),
      supabase.from("operation_payments").select("amount, kind").eq("operation_id", operationId),
      supabase.from("operation_travelers").select("*").eq("operation_id", operationId).order("sort"),
      supabase.from("offer_days").select("id", { count: "exact", head: true }).eq("offer_id", row.offer_id),
    ]);
    const exceptions = row.ready_exceptions;
    const items = readiness({
      operation: { total: offer?.total != null ? Number(offer.total) : null, travel_start: row.travel_start, travel_end: row.travel_end },
      // every column, so a booking is the OperationBooking the rules read; the label is a screen's
      bookings: ((bookings.data ?? []) as OperationBooking[]).map((b) => ({ ...b, assignee_label: null })),
      documents: (documents.data ?? []) as OperationDocument[],
      payments: ((payments.data ?? []) as { amount: number | string; kind: OperationPayment["kind"] }[]).map((p) => ({ amount: Number(p.amount) || 0, kind: p.kind })),
      // redacted on the spot: the passport ciphertext only becomes a yes/no
      travelers: ((travelers.data ?? []) as TravelerRow[]).map(toTravelerListItem),
      supplierWork: null,
      clientToken: row.client_token && !row.client_token_revoked_at ? row.client_token : null,
      readyExceptions: exceptions && typeof exceptions === "object" ? (exceptions as ReadyExceptions) : {},
      hasDays: (days.count ?? 0) > 0,
      today: riyadhDate(),
      sold: offer ? { adults: offer.adults ?? 0, children: offer.children ?? 0, infants: offer.infants ?? 0 } : null,
      guide: null,
    });
    return items.filter((i) => !i.ok && !i.optional);
  } catch {
    return null;
  }
}

// ---------- «قائمة متابعتك اليوم» ----------

type WaitRow = {
  id: string;
  travel_start: string | null;
  waits: unknown;
  assignee_id: string | null;
  offers: One<{ serial: string; employee_id: string | null; customers: One<{ arabic_name: string | null }> }>;
};
type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Every live case holding a wait, with its follow-up today (or none). */
async function followUps(supabase: SupabaseClient, today: string): Promise<(FollowUpItem & { responsible: string | null })[]> {
  const { data } = await supabase
    .from("operations")
    .select("id, travel_start, waits, assignee_id, offers(serial, employee_id, customers(arabic_name))")
    .neq("waits", "{}")
    .not("execution_status", "in", "(cancelled,travelled)")
    .limit(2000);
  return ((data ?? []) as unknown as WaitRow[]).flatMap((r) => {
    const due = followUpOf(readWaits(r.waits), r.travel_start, today);
    if (!due) return [];
    const offer = one(r.offers);
    return [
      {
        operationId: r.id,
        serial: offer?.serial ?? "",
        client: one(offer?.customers ?? null)?.arabic_name ?? null,
        travelStart: r.travel_start,
        tone: due.tone,
        steps: due.steps.map((w) => ({ step: w.step, from: w.from, until: w.until, note: w.note ?? null })),
        // «مسؤول الحالة», else the file's issuer
        responsible: r.assignee_id ?? offer?.employee_id ?? null,
      },
    ];
  });
}

const TONE_ORDER: Record<FollowUpTone, number> = { red: 0, yellow: 1, grey: 2 };

/** «لوحتي»: the signed-in employee's own follow-ups today — the cases they are answerable for — red first. */
export async function myFollowUps(supabase: SupabaseClient, employeeId: string): Promise<FollowUpItem[]> {
  try {
    const all = await followUps(supabase, riyadhDate());
    return all
      .filter((f) => f.responsible === employeeId)
      .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (a.travelStart ?? "9999").localeCompare(b.travelStart ?? "9999"));
  } catch {
    return [];
  }
}

/**
 * The morning notice (daily.ts): each case with a follow-up today, once per
 * case per day (operation_alerts: kind «wait», ref = the day), to whoever its
 * page opens for — the operations team (the managers) and the file's own
 * salesperson (ops-notify recipientsFor); «مسؤول الحالة» holds one or the other.
 * Service role: the cron has no session.
 */
export async function notifyDueWaits(service: SupabaseClient, today: string): Promise<number> {
  let sent = 0;
  try {
    for (const f of await followUps(service, today)) {
      const { error } = await service.from("operation_alerts").insert({ operation_id: f.operationId, kind: "wait", ref: today });
      if (error) continue; // the unique key: already told today
      const ar = (key: string, params?: Record<string, string>) => translate("ar", key as TranslationKey, params);
      const lines = [
        `${f.tone === "red" ? "🔴" : f.tone === "yellow" ? "🟡" : "⏳"} ${ar("wz.follow.notice")}: ${f.serial}${f.client ? ` — ${f.client}` : ""}`,
        ...f.steps.map((w) => `• ${ar(`wz.step.${w.step}`)}: ${ar("wz.wait.from", { from: ar(`wz.from.${w.from}`), until: w.until })}${w.note ? ` — ${w.note}` : ""}`),
      ];
      await notifyOps(lines.join("\n"), `/operations/${f.operationId}`);
      sent += 1;
    }
  } catch {
    /* best-effort — the morning's other work is done either way */
  }
  return sent;
}
