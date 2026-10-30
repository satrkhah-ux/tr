import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyPartnerCase } from "@/lib/data/ops-notify";
import { clientPolicy } from "@/lib/operations/refund-mode";
import { CLIENT_DOCUMENT_KINDS, DOCUMENT_LABEL, HOTEL_ID_KEY, hotelIdOf, shownDetail, type VoucherBooking, type VoucherDTO, type VoucherKind } from "@/lib/operations/voucher-dto";
import { ensureCatalogHotel, requestHotelData } from "@/lib/data/hotel-data-request";
import { voucherStay, type StayError, type StayHotel } from "@/lib/operations/room-details";
import { hotelFinal } from "@/lib/operations/client-booking-state";
import { sameDocument, snapshotKey } from "@/lib/operations/wizard/documents";
import type { FlightLeg } from "@/lib/data/operation-bookings";
import { namedLegs } from "@/lib/data/ticket-legs";
import { leadName } from "@/lib/operations/travelers";
import { catalogHotelsFor } from "@/lib/data/hotel-match";

/**
 * Freezing a document — the ONE write behind «إصدار» (issueDocument, gated)
 * and the documents the server issues by itself the moment their data is final
 * (wizard-sync.ts autoIssueDocuments, after every confirmation, from any
 * screen). NOT a server action: there is no gate here — every caller has
 * checked the case first, or is the server itself. Service role throughout.
 *
 * Idempotent: a paper identical to the latest one of its kind and booking is
 * handed back, never issued again — and two calls racing to issue the same
 * paper meet on the token's unique key (tokenFor), so only one row gets in.
 */

export type IssueInput = {
  operation_id: string;
  kind: VoucherKind;
  booking_id?: string | null;
  /** «لوحة الاستقبال» only — the name the client asked to see at the airport. */
  welcome_name?: string | null;
};

export type IssueResult =
  | { ok: true; id: string; token: string; /** an identical paper was already out — nothing new was issued */ reused: boolean }
  /** `waiting`: not the agent's to fix — the hotel's data is with the data team, and the paper follows it */
  | { ok: false; error: TranslationKey; params?: Record<string, string>; waiting?: true };

/** Why a stay's voucher was refused, told to the agent with what to fill. */
const STAY_ERROR: Record<StayError, Record<"ar" | "en", TranslationKey>> = {
  hotelUnknown: { ar: "ops.voucher.err.hotelUnknown", en: "ops.voucher.err.hotelUnknown" },
  hotelName: { ar: "ops.voucher.err.hotelNameAr", en: "ops.voucher.err.hotelNameEn" },
  roomName: { ar: "ops.voucher.err.roomNameAr", en: "ops.voucher.err.roomNameEn" },
  roomInvalid: { ar: "ops.voucher.err.roomInvalid", en: "ops.voucher.err.roomInvalid" },
};

type BookingRow = {
  id: string;
  kind: string;
  status: string;
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string> | null;
  confirmation_number: string | null;
  supplier_name: string;
  cancellation_policy: string | null;
  is_paid: boolean;
  company_ref: string | null;
  pnr: string | null;
  ticket_numbers: string[] | null;
  flight_legs: FlightLeg[] | null;
};

function toVoucherBooking(b: BookingRow): VoucherBooking {
  return {
    kind: b.kind,
    title: b.title,
    city_name: b.city_name,
    start_date: b.start_date,
    end_date: b.end_date,
    confirmation_number: b.confirmation_number,
    supplier_name: b.supplier_name,
    detail: shownDetail(b.detail ?? {}),
    cancellation_policy: clientPolicy(b.cancellation_policy, b.detail),
    is_paid: b.is_paid,
  };
}

/**
 * The token of a new document. 24 bytes either way — the token IS the access
 * control of the public link, so it must not be guessable the way a serial is.
 * Keyed by a server secret and derived from what the paper prints and the
 * version it takes: two calls racing to issue the same paper compute the same
 * token, and the unique key on operation_documents.token lets one row in.
 * Random when no secret is set (a test, a local run).
 */
function tokenFor(seed: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key ? createHmac("sha256", key).update(seed).digest().subarray(0, 24).toString("base64url") : randomBytes(24).toString("base64url");
}

/**
 * Freeze a voucher.
 *
 * The snapshot IS the document: re-rendering it later must not pick up a hotel
 * name or a date that changed after the traveller was handed the paper. Same
 * reasoning as offer_renders, which is why neither is generated on the fly.
 *
 * A voucher can only be issued against a CONFIRMED booking. Handing someone a
 * document for a room nobody booked is worse than handing them nothing — they
 * stop chasing it and find out at the desk.
 */
/** `issuedBy`: the employee whose action this is, if any; `auto`: issued by the server, not by a press of «إصدار». */
export async function issueDocumentNow(input: IssueInput, issuedBy: string | null, auto = false, retried = false): Promise<IssueResult> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;

    // the client's phone only — their name is the WhatsApp contact, for greetings,
    // never printed: a paper carries the travellers' names as in the passport (2026-10-18)
    const opRes = await supabase
      .from("operations")
      .select("id, offer_id, offers(serial, destination, customers(mobile))")
      .eq("id", input.operation_id)
      .maybeSingle();
    if (!opRes.data) return { ok: false, error: "ops.err.notFound" };
    const op = opRes.data as unknown as {
      offer_id: string;
      offers:
        | { serial: string; destination: string | null; customers: { mobile: string | null } | { mobile: string | null }[] | null }
        | { serial: string; destination: string | null; customers: unknown }[]
        | null;
    };
    const offer = Array.isArray(op.offers) ? op.offers[0] : op.offers;
    const cust = Array.isArray(offer?.customers) ? offer?.customers[0] : offer?.customers;
    const customer = (cust ?? null) as { mobile: string | null } | null;

    const [bookingsRes, travelersRes, daysRes] = await Promise.all([
      supabase
        .from("operation_bookings")
        .select("id, kind, status, title, city_name, start_date, end_date, detail, confirmation_number, supplier_name, cancellation_policy, is_paid, company_ref, pnr, ticket_numbers, flight_legs")
        .eq("operation_id", input.operation_id)
        .order("start_date", { ascending: true, nullsFirst: false }),
      // names and nationalities only — never the passport blob
      supabase.from("operation_travelers").select("display_name, nationality").eq("operation_id", input.operation_id).order("sort", { ascending: true }),
      supabase
        .from("offer_days")
        // the column is day_date, not date — selecting a name that does not
        // exist makes PostgREST return NOTHING rather than error loudly, which
        // reads as "this trip has no program" instead of "the query is wrong"
        .select("day_number, day_date, city_name, title, activities")
        .eq("offer_id", op.offer_id)
        .order("day_number", { ascending: true }),
    ]);
    const allBookings = (bookingsRes.data ?? []) as BookingRow[];
    const travelers = (travelersRes.data ?? []) as { display_name: string; nationality: string | null }[];
    // the lead guest, the sign's name — the passport's (travelers.ts leadName)
    const lead = leadName(travelers);

    // Only confirmed bookings belong on a document handed to a traveller.
    const confirmed = allBookings.filter((b) => b.status === "confirmed");
    // A booking_id means "this hotel alone gets its own document"; without one
    // every confirmed hotel goes on ONE voucher, which is what a client wants to
    // carry and what a desk wants to be handed.
    const picked = input.booking_id
      ? confirmed.filter((b) => b.id === input.booking_id)
      : input.kind === "hotel_voucher"
        ? confirmed.filter((b) => b.kind === "hotel")
        : input.kind === "flight_ticket"
          ? confirmed.filter((b) => b.kind === "flight")
          : input.kind === "booking_summary"
            ? confirmed
            : [];
    // The hotel voucher is the paper shown at the desk: never before the hotel's
    // OWN confirmation (the owner, 2026-10-17). A hotel still holding only our
    // number — or "confirmed" with no number at all — stays off it.
    const scoped = input.kind === "hotel_voucher" ? picked.filter((b) => b.kind === "hotel" && hotelFinal(b)) : picked;
    if (scoped.length === 0 && picked.length > 0) return { ok: false, error: "trip.status.voucherNeedsFinal" };

    const days = ((daysRes.data ?? []) as {
      day_number: number;
      day_date: string | null;
      city_name: string | null;
      title: string | null;
      activities: string[] | null;
    }[]).map((d) => ({
      day_number: d.day_number,
      date: d.day_date,
      city_name: d.city_name ?? "",
      title: d.title ?? "",
      activities: d.activities ?? [],
    }));

    // A welcome board needs nothing confirmed: it is a name on a sheet, and the
    // whole point is that it can be printed the moment the trip is sold — often
    // before a single hotel has come back. Every other kind still requires
    // something real to put on it.
    if (input.kind === "itinerary" ? days.length === 0 : input.kind !== "welcome_board" && scoped.length === 0) {
      return { ok: false, error: "ops.err.nothingToIssue" };
    }

    // the hotel desk reads the hotel's name, address and phone — from /hotels: the booking's own
    // hotel (its catalogue id, else its name in its city — hotel-match.ts); its city and country
    // decide the language a hotel voucher prints the stay in
    type HotelRow = { id: string; arabic_name: string; english_name: string | null; address: string | null; contact_number: string | null; google_maps: string | null; city_id: string | null; country_id: string | null };
    type CityRow = { id: string; arabic_name: string; english_name: string | null; country_id: string | null };
    const catalog = await catalogHotelsFor<HotelRow>(
      supabase,
      scoped.filter((b) => b.kind === "hotel"),
      "english_name, address, contact_number, google_maps, country_id",
    );
    const hotelRows = catalog.rows;
    const cityIds = [...new Set(hotelRows.map((h) => h.city_id).filter((c): c is string => Boolean(c)))];
    const cityRows = cityIds.length ? (((await supabase.from("cities").select("id, arabic_name, english_name, country_id").in("id", cityIds)).data ?? []) as CityRow[]) : [];
    const countryIds = [...new Set([...hotelRows.map((h) => h.country_id), ...cityRows.map((c) => c.country_id)].filter((c): c is string => Boolean(c)))];
    const iso2 = new Map(
      countryIds.length
        ? (((await supabase.from("countries").select("id, iso2").in("id", countryIds)).data ?? []) as { id: string; iso2: string | null }[]).map((c) => [c.id, c.iso2])
        : [],
    );
    const cityOf = new Map(cityRows.map((c) => [c.id, c]));
    // two hotels may share a name: the booking's own (read from the raw row — its id is not printed)
    const hotelFor = (raw: BookingRow) => {
      const row = catalog.pick(raw);
      return row ? { row, city: row.city_id ? cityOf.get(row.city_id) : undefined } : null;
    };
    const withHotel = (raw: BookingRow): VoucherBooking => {
      const b = toVoucherBooking(raw);
      const h = b.kind === "hotel" ? hotelFor(raw)?.row : undefined;
      return h ? { ...b, name_en: h.english_name, address: h.address, phone: h.contact_number } : b;
    };

    // A hotel voucher prints each stay in its destination's language (room catalogue,
    // 2026-10-15) — or is not issued, saying which name is missing.
    const stays: VoucherBooking[] = [];
    const waiting: string[] = [];
    let relinked = false;
    const asked = { serial: offer?.serial ?? null, by: issuedBy };
    if (input.kind === "hotel_voucher") {
      for (const raw of scoped) {
        const b = toVoucherBooking(raw);
        const found = hotelFor(raw);
        const city = found?.city;
        const hotel: StayHotel | null = found
          ? { ar: found.row.arabic_name, en: found.row.english_name, country: iso2.get(found.row.country_id ?? city?.country_id ?? "") ?? null }
          : null;
        const cityEn = city?.english_name?.trim();
        const glossary = cityEn && /[A-Za-z]/.test(cityEn) ? { [city!.arabic_name.trim()]: cityEn, [b.city_name.trim()]: cityEn } : {};
        // the raw detail: toVoucherBooking has already set the room details aside
        const stay = voucherStay({ title: raw.title, city_name: raw.city_name, detail: raw.detail ?? {} }, hotel, glossary);
        if (!stay.ok && (stay.error === "hotelUnknown" || stay.error === "hotelName")) {
          // the hotel's name is the administration's, never the agent's (the owner, 2026-10-23): a
          // hotel typed by hand joins the catalogue, they are asked, and this voucher waits for them —
          // issued by the server the moment the name is in (issueVouchersForHotel). Every hotel of
          // the paper is seen to in this one pass.
          const id = found ? found.row.id : await ensureCatalogHotel(supabase, { name: raw.title, city: raw.city_name || raw.detail?.["المدينة"] || null, ...asked });
          if (found) await requestHotelData(supabase, { id: found.row.id, name: found.row.arabic_name, city: city?.arabic_name ?? null }, "no_english", asked);
          // by its id from now on: the administration's rename or merge reaches this booking
          if (id && hotelIdOf(raw.detail) !== id) {
            const { error: pinError } = await supabase.from("operation_bookings").update({ detail: { ...(raw.detail ?? {}), [HOTEL_ID_KEY]: id } }).eq("id", raw.id);
            // a hotel found only now may already print — read the paper again, once
            if (!found && !pinError) relinked = true;
          }
          waiting.push(b.title);
          continue;
        }
        if (!stay.ok) return { ok: false, error: STAY_ERROR[stay.error][stay.locale], params: { hotel: b.title } };
        // a desk wants the address and the phone — asked of the data team, the voucher goes out without them
        if (found && (!found.row.address?.trim() || !found.row.contact_number?.trim())) {
          await requestHotelData(supabase, { id: found.row.id, name: found.row.arabic_name, city: city?.arabic_name ?? null }, "no_contact", asked);
        }
        stays.push({
          ...b,
          title: stay.title,
          city_name: stay.city_name,
          detail: stay.detail,
          locale: stay.locale,
          alt_name: stay.alt_name,
          notes: stay.notes,
          address: found?.row.address ?? null,
          phone: found?.row.contact_number ?? null,
          map: found?.row.google_maps?.trim() || null,
        });
      }
      if (waiting.length > 0) {
        if (relinked && !retried) return issueDocumentNow(input, issuedBy, auto, true);
        return { ok: false, error: "ops.voucher.wait.hotelData", params: { hotel: waiting.join("، ") }, waiting: true };
      }
    }

    // The ticket prints each flight once, as a boarding-pass card: the carrier and
    // the places by name from our own tables (2026-10-22, «تذكرة الطيران تحتاج
    // اعادة تصميم لهوية الشركة»)
    const flights: VoucherBooking[] = [];
    if (input.kind === "flight_ticket") {
      for (const raw of scoped) {
        flights.push({ ...withHotel(raw), legs: await namedLegs(supabase, raw.flight_legs ?? []), pnr: raw.pnr || raw.confirmation_number, tickets: raw.ticket_numbers ?? [] });
      }
    }

    // each day of the itinerary says when its drives and tours start
    const timedOn = (date: string | null) =>
      allBookings
        .filter((b) => b.status !== "cancelled" && (b.kind === "transport" || b.kind === "service") && b.start_date && b.start_date === date)
        .map((b) => {
          const at = b.detail?.["الوقت"] || b.detail?.["وقت الانطلاق"] || "";
          return `${at && at !== "يُحدَّد لاحقاً" ? `${at} — ` : ""}${b.title}`;
        });

    const snapshot: VoucherDTO = {
      kind: input.kind,
      serial: offer?.serial ?? "",
      // the company's day, not the server's UTC one
      issued_at: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
      destination: offer?.destination ?? null,
      customer: { name: lead, phone: customer?.mobile ?? null },
      travelers: travelers.map((t) => ({ name: t.display_name, nationality: t.nationality })),
      bookings: input.kind === "hotel_voucher" ? stays : input.kind === "flight_ticket" ? flights : scoped.map(withHotel),
      days: input.kind === "itinerary" ? days.map((d) => ({ ...d, activities: [...timedOn(d.date), ...d.activities] })) : [],
      notes: [],
      // a booking that chose Arabic keeps the bilingual voucher
      ...(input.kind === "hotel_voucher" && stays.every((s) => s.locale === "en") ? { lang: "en" as const } : {}),
      // Falls back to the lead traveller as in the passport — never the client's
      // contact name: «al 3r18y» held up in arrivals helps nobody (AD-2-3599).
      welcome_name: input.kind === "welcome_board" ? (input.welcome_name ?? "").trim() || lead || null : null,
    };

    // the case's papers of this kind: the next version, and whether this one is already out
    const { data: prevData, error: prevError } = await supabase
      .from("operation_documents")
      .select("id, token, version, booking_id, revoked_at, created_at, snapshot_json")
      .eq("operation_id", input.operation_id)
      .eq("kind", input.kind);
    if (prevError) return { ok: false, error: "err.loadFailed" };
    const prev = (prevData ?? []) as { id: string; token: string; version: number; booking_id: string | null; revoked_at: string | null; created_at: string; snapshot_json: unknown }[];
    const bookingId = input.booking_id ?? null;
    const same = sameDocument(prev, bookingId, snapshot);
    if (same) return { ok: true, id: same.id, token: same.token, reused: true };
    const version = prev.reduce((max, d) => Math.max(max, d.version), 0) + 1;

    const token = tokenFor([input.operation_id, input.kind, bookingId ?? "", version, snapshotKey(snapshot)].join("|"));
    const { data, error } = await supabase
      .from("operation_documents")
      .insert({
        operation_id: input.operation_id,
        booking_id: bookingId,
        kind: input.kind,
        version,
        snapshot_json: snapshot,
        token,
        issued_by: issuedBy,
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      // another call issued this very paper a moment ago — the same token, so the same paper
      const { data: twin } = await supabase.from("operation_documents").select("id").eq("token", token).maybeSingle();
      return twin ? { ok: true, id: (twin as { id: string }).id, token, reused: true } : { ok: false, error: "err.createFailed" };
    }
    if (error || !data) return { ok: false, error: "err.createFailed" };

    const id = (data as { id: string }).id;
    await logAudit({
      action: "voucher.issued",
      entity: "operation_documents",
      entity_id: id,
      meta: { operation_id: input.operation_id, kind: input.kind, version, ...(auto ? { auto: true } : {}) },
    });
    // a partner's client gets this document from the partner — tell them it is out
    if (CLIENT_DOCUMENT_KINDS.includes(input.kind)) await notifyPartnerCase({ offerId: op.offer_id, what: `صدر مستند: ${DOCUMENT_LABEL[input.kind]}` });
    return { ok: true, id, token, reused: false };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
