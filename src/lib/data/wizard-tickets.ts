"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { confirmBookingManually } from "@/lib/data/operation-bookings";
import { attachSupplierConfirmation } from "@/lib/data/supplier-work";
import { followFlight } from "@/lib/data/flight-follow";
import { gateRow } from "@/lib/operations/access";
import { currentCan } from "@/lib/roles/current";
import { decryptJson, isVaultConfigured } from "@/lib/crypto/secrets";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { uploadText, type UploadHow } from "@/lib/repackage/extract/upload-text";
import { mergeTicket, parseTicketText, sanitizeTicket, ticketGaps, ticketNumbersIn, type ParsedTicket, type TicketLeg } from "@/lib/flights/ticket-parse";
import { readHotelPaper, readTicketText, type PaperStay } from "@/lib/flights/ticket-ai";
import type { PassportView, TravelerRow } from "@/lib/operations/traveler-dto";
import { catalogHotelsFor } from "@/lib/data/hotel-match";
import { badLeg, checkNames, ownLegs, toFlightLegs, uniqueLegs, withTicketLines, type LegInput, type NameCheck, type TravelerNames } from "@/lib/operations/wizard/flights";
import { hotelDiffs, parseHotelConfirmation, sameHotel, type HotelConfirmation, type HotelDiff } from "@/lib/operations/wizard/hotels";
import { ticketTitle } from "@/lib/operations/seed-plan";

/**
 * «معالج الحجوزات» — the flight tickets (step 2) and the hotels' confirmations
 * (step 3): read the paper, show what it says against the case, save what the
 * employee confirms.
 *
 * Every action is gated on the booking (operations/access.ts gateRow — the
 * file's own rule), then writes through the SERVICE client: 0047 withholds
 * columns from sessions and an own-files holder's session is not the gate. The
 * confirmation itself goes through confirmBookingManually, the one path every
 * confirmation takes (number required, audited, the salesperson told, the
 * case's status moved). Reading a passport name to check a ticket is audited
 * first, exactly as opening the passport is. Nothing read is logged.
 */

type Fail = { ok: false; error: TranslationKey };

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

type BookingRow = {
  id: string;
  origin_ref: string | null;
  operation_id: string;
  kind: string;
  title: string;
  city_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string> | null;
};

async function bookingOf(db: SupabaseClient, id: string, kind: "flight" | "hotel"): Promise<BookingRow | null> {
  if (!id) return null;
  const { data } = await db
    .from("operation_bookings")
    .select("id, origin_ref, operation_id, kind, title, city_name, status, start_date, end_date, detail")
    .eq("id", id)
    .maybeSingle();
  const row = data as BookingRow | null;
  return row && row.kind === kind && row.status !== "cancelled" ? row : null;
}

/**
 * The case's travellers as the name check sees them: the passport's own (MRZ)
 * name, for a viewer who may read passports — each read audited before it is
 * decrypted, or not read at all — and the traveller's name on the case, in
 * whichever script it was written (compareName hears Arabic against Latin).
 * Not a planned name: before 0091's seeding stopped, that was the client's
 * WhatsApp contact name, and it says nothing about who is on the ticket.
 */
async function travelerNames(db: SupabaseClient, booking: BookingRow, purpose: string): Promise<TravelerNames[]> {
  // `*`: name_source is 0091's — naming a column a database lacks fails the whole read
  const { data } = await db
    .from("operation_travelers")
    .select("*")
    .eq("operation_id", booking.operation_id)
    .order("sort", { ascending: true });
  const rows = (data ?? []) as Pick<TravelerRow, "id" | "display_name" | "name_source" | "passport_encrypted">[];
  const mayRead = isVaultConfigured() && (await currentCan("operations.passport"));
  return Promise.all(
    rows.map(async (t, i) => {
      let full = "";
      if (mayRead && t.passport_encrypted) {
        const logged = await logAudit({
          action: "passport.viewed",
          entity: "operation_travelers",
          entity_id: t.id,
          meta: { operation_id: booking.operation_id, booking_id: booking.id, purpose, fields: ["full_name"] },
        });
        full = logged ? (decryptJson<PassportView>(t.passport_encrypted)?.full_name?.trim() ?? "") : "";
      }
      const own = t.name_source === "seed" ? "" : t.display_name.trim();
      // the label is what the browser shows — the case's name, never the decrypted one
      return { id: t.id, label: own || `مسافر ${i + 1}`, names: [full, own].filter(Boolean) };
    }),
  );
}

// ---------------- step 2: the flight tickets ----------------

export type TicketRead = {
  pnr: string;
  ticket_numbers: string[];
  legs: TicketLeg[];
  baggage: string;
  /** each name on the ticket against the passports — a mismatch is a refused boarding */
  names: NameCheck[];
  /** travellers no name on the ticket is */
  missing: string[];
  how: UploadHow;
  ai: boolean;
};

/** A ticket (PDF, photo or pasted text) → what it says, for the employee to confirm. Nothing is stored. */
export async function readBookingTicket(formData: FormData): Promise<{ ok: true; read: TicketRead } | Fail> {
  const bookingId = String(formData.get("booking_id") ?? "");
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const db = service();
    const booking = await bookingOf(db, bookingId, "flight");
    if (!booking) return { ok: false, error: "ops.err.notFound" };
    const given = givenTicket(formData.get("read"));
    const typed = String(formData.get("text") ?? "");
    const text = given && !typed.trim() ? { ok: true as const, text: "", how: "vision" as const } : await uploadText(formData, "flight ticket");
    if (!text.ok) return { ok: false, error: `fc.err.${text.error}` };

    let ticket = parseTicketText(text.text);
    // our own ticket, uploaded again: its leg lines are exact where its cards read back reversed
    const own = ownLegs(text.text);
    if (own.length) ticket = { ...ticket, legs: own };
    let ai = false;
    if (given) {
      // the uploader's whole-file reading (sortPaper → readPaperFile): its flights, passengers and PNR
      const legs = soundLegs(given.legs);
      ticket = { ...ticket, pnr: given.pnr || ticket.pnr, ...(legs.length ? { legs } : {}), ...(given.passengers.length ? { passengers: given.passengers } : {}) };
      ai = true;
    } else if (!own.length && isOpenAIConfigured()) {
      // an airline's or an agency's own layout (the owner's samples, 2026-10-23: «A321 JET→» read as a flight,
      // a middle name as an airport, the directions reversed, «Seats: eTicket Receipt(s)» as a passenger): the
      // model reads it whole and its flights, passengers and PNR win where it found them; the parser fills the
      // rest. Only the ticket is sent.
      try {
        const read = await readTicketText(text.text);
        const legs = soundLegs(read.legs);
        const pnr = read.pnr && text.text.toUpperCase().includes(read.pnr) ? read.pnr : ticket.pnr;
        ticket = mergeTicket({ ...ticket, pnr, ...(legs.length ? { legs } : {}), ...(read.passengers.length ? { passengers: read.passengers } : {}) }, read);
        ai = true;
      } catch {
        /* the parser's reading stands; the employee fills the rest */
      }
    } else if (isOpenAIConfigured() && ticketGaps(ticket).length > 0) {
      try {
        ticket = mergeTicket(ticket, await readTicketText(text.text));
        ai = true;
      } catch {
        /* the parser's reading stands */
      }
    }
    const ticket_numbers = [...new Set([...ticketNumbersIn(text.text), ...(given?.ticket_numbers ?? []).flatMap((n) => ticketNumbersIn(n))])];
    if (ticket.legs.length === 0 && !ticket.pnr && ticket_numbers.length === 0) return { ok: false, error: "fc.err.nothing" };

    const travelers = ticket.passengers.length > 0 ? await travelerNames(db, booking, "ticket_check") : [];
    const { names, missing } = checkNames(ticket.passengers, travelers);
    return {
      ok: true,
      read: {
        pnr: ticket.pnr,
        ticket_numbers,
        legs: ticket.legs,
        baggage: [...new Set(ticket.legs.map((l) => l.baggage).filter(Boolean))].join("، "),
        names,
        missing,
        how: text.how,
        ai,
      },
    };
  } catch {
    return { ok: false, error: "fc.err.unreadable" };
  }
}

/**
 * The ticket, confirmed by the employee: the PNR, a ticket number per
 * passenger, the legs (with their airports' offsets) and the allowance. The
 * booking's leg lines are rewritten from the legs, which re-times the drives
 * tied to them (flight-follow), and the booking is confirmed under its PNR.
 */
export async function saveBookingTicket(input: {
  booking_id: string;
  pnr: string;
  ticket_numbers: string[];
  legs: LegInput[];
  baggage: string;
}): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", input.booking_id);
  if (denied) return { ok: false, error: denied };

  const clean = sanitizeTicket({ pnr: input.pnr, legs: input.legs });
  if (!clean.pnr) return { ok: false, error: "wz.flights.err.pnr" };
  const typed = input.ticket_numbers.map((t) => t.trim()).filter(Boolean);
  const tickets = [...new Set(typed.flatMap((t) => ticketNumbersIn(t)))];
  if (typed.some((t) => ticketNumbersIn(t).length === 0)) return { ok: false, error: "wz.flights.err.ticketNo" };
  if (clean.legs.length === 0) return { ok: false, error: "wz.flights.err.legs" };

  try {
    const db = service();
    const booking = await bookingOf(db, input.booking_id, "flight");
    if (!booking) return { ok: false, error: "ops.err.notFound" };

    const codes = [...new Set(clean.legs.flatMap((l) => [l.from_iata, l.to_iata]).filter(Boolean))];
    const { data: airports } = codes.length ? await db.from("airports").select("code, iana_timezone").in("code", codes) : { data: [] };
    const zone = new Map(((airports ?? []) as { code: string; iana_timezone: string | null }[]).map((a) => [a.code.toUpperCase(), a.iana_timezone]));
    const legs = uniqueLegs(toFlightLegs(clean.legs, (code) => zone.get(code) ?? null));
    // the drivers' messages print these numbers and times: a leg they cannot be timed from is not saved
    if (legs.some(badLeg)) return { ok: false, error: "wz.flights.err.legs" };

    const baggage = input.baggage.replace(/\s+/g, " ").trim().slice(0, 80);
    const detail = withTicketLines(booking.detail ?? {}, legs, baggage);
    // the route the ticket flies — the planned one stayed on the card and the client's page
    const title = ticketTitle(booking.origin_ref, legs);
    const { error } = await db
      .from("operation_bookings")
      .update({
        title,
        pnr: clean.pnr,
        ticket_numbers: tickets,
        flight_legs: legs,
        baggage: baggage || null,
        detail,
        start_date: legs[0].departs_at?.slice(0, 10) ?? booking.start_date,
        end_date: legs[legs.length - 1].departs_at?.slice(0, 10) ?? booking.end_date,
      })
      .eq("id", booking.id);
    if (error) return { ok: false, error: "err.updateFailed" };
    await followFlight(db, { id: booking.id, operation_id: booking.operation_id, title, detail }, booking.detail);
    await logAudit({
      action: "booking.ticketed",
      entity: "operation_bookings",
      entity_id: booking.id,
      meta: { pnr: clean.pnr, tickets: tickets.length, legs: legs.map((l) => `${l.flight_no} ${l.from}-${l.to}`) },
    });
    return await confirmBookingManually({ booking_id: booking.id, confirmation_number: clean.pnr });
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------------- step 3: the hotels ----------------

type HotelRow = { id: string; address: string | null; contact_number: string | null };

/**
 * The /hotels row the booking is — its catalogue id, else its name in its city
 * (hotel-match.ts); none when unsure: this row's empty address is FILLED from the
 * paper, and a namesake in another city must never be the one written.
 */
async function hotelOf(db: SupabaseClient, booking: BookingRow): Promise<(HotelRow & { arabic_name: string; english_name: string | null }) | null> {
  if (!booking.title.trim()) return null;
  const { pick } = await catalogHotelsFor<HotelRow & { arabic_name: string; english_name: string | null; city_id: string | null }>(db, [booking], "address, contact_number, english_name");
  const hit = pick(booking);
  return hit ? { id: hit.id, address: hit.address, contact_number: hit.contact_number, arabic_name: hit.arabic_name, english_name: hit.english_name } : null;
}

/** A model's flights, only those that are flights: a number (never «A321»), two airports, a day — each once. */
function soundLegs<T extends { flight_no: string; from_iata: string; to_iata: string; dep_date: string }>(legs: T[]): T[] {
  const seen = new Set<string>();
  return legs.filter((l) => {
    const sound = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(l.flight_no) && /^[A-Z]{3}$/.test(l.from_iata) && /^[A-Z]{3}$/.test(l.to_iata) && l.from_iata !== l.to_iata && /^\d{4}-\d{2}-\d{2}$/.test(l.dep_date);
    const key = `${l.flight_no}|${l.dep_date}`;
    if (!sound || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A ticket the uploader read off the file (JSON), cut to its shape like any typed one. */
function givenTicket(raw: FormDataEntryValue | null): (ParsedTicket & { ticket_numbers: string[] }) | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    const numbers = Array.isArray(r.ticket_numbers) ? r.ticket_numbers.filter((n): n is string => typeof n === "string").slice(0, 40) : [];
    return { ...sanitizeTicket(r), ticket_numbers: numbers };
  } catch {
    return null;
  }
}

/** A stay the uploader read (JSON), cut to its shape — the browser's word is checked like any other. */
function givenStay(raw: FormDataEntryValue | null): PaperStay | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown, n = 120) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    return {
      hotel_name: str(r.hotel_name),
      city: str(r.city, 60),
      check_in: day(r.check_in),
      check_out: day(r.check_out),
      confirmation: str(r.confirmation, 40),
      room: str(r.room),
      guests: (Array.isArray(r.guests) ? r.guests : []).map((g) => str(g, 80)).filter(Boolean).slice(0, 20),
    };
  } catch {
    return null;
  }
}

/** Of a paper's stays, this booking's: its check-in day, else the first. */
const pickStay = (stays: PaperStay[], booking: BookingRow): PaperStay | null => stays.find((s) => s.check_in && s.check_in === booking.start_date) ?? stays[0] ?? null;

const empty = (v: string | null) => !v?.trim();

export type HotelRead = {
  read: HotelConfirmation;
  names: NameCheck[];
  /** shown in yellow — what the paper says that the booking does not */
  diffs: HotelDiff[];
  /** which of the hotel's own fields are empty in /hotels and may be filled from this paper */
  fill: { address: boolean; phone: boolean };
  how: UploadHow;
};

/** A hotel's confirmation (PDF, photo or pasted text) → what it says against the booking. Nothing is stored. */
export async function readHotelConfirmation(formData: FormData): Promise<{ ok: true; result: HotelRead } | Fail> {
  const bookingId = String(formData.get("booking_id") ?? "");
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const db = service();
    const booking = await bookingOf(db, bookingId, "hotel");
    if (!booking) return { ok: false, error: "ops.err.notFound" };
    const given = givenStay(formData.get("stay"));
    const typed = String(formData.get("text") ?? "");
    const text = given && !typed.trim() ? { ok: true as const, text: "", how: "vision" as const } : await uploadText(formData, "hotel booking confirmation");
    if (!text.ok) return { ok: false, error: `wz.hotels.err.${text.error}` };

    let read = parseHotelConfirmation(text.text);
    // the stay the uploader already read off the paper (hotelsOnPaper); else an outside paper, read whole by the
    // model — chain websites and suppliers print shapes no label list holds (the owner's samples, 2026-10-23)
    const stay = given ?? (isOpenAIConfigured() && !/HOTEL CONFIRMATION NO:/.test(text.text) ? pickStay((await readHotelPaper(text.text).catch(() => null))?.hotels ?? [], booking) : null);
    if (stay) {
      read = {
        ...read,
        confirmation: stay.confirmation || read.confirmation,
        check_in: stay.check_in || read.check_in,
        check_out: stay.check_out || read.check_out,
        room: stay.room || read.room,
        guests: stay.guests.length ? stay.guests : read.guests,
      };
    }
    if (!read.confirmation && !read.check_in && read.guests.length === 0) return { ok: false, error: "wz.hotels.err.nothing" };
    const travelers = read.guests.length > 0 ? await travelerNames(db, booking, "hotel_check") : [];
    const { names } = checkNames(read.guests, travelers);
    const hotel = await hotelOf(db, booking);
    // the hotel the paper names, when it is not this booking's — said first, in yellow
    const other = stay?.hotel_name && !sameHotel(stay.hotel_name, [booking.title, hotel?.arabic_name, hotel?.english_name]);
    return {
      ok: true,
      result: {
        read,
        names,
        diffs: [...(other ? [{ key: "hotel" as const, ours: booking.title, theirs: stay!.hotel_name }] : []), ...hotelDiffs(read, booking, names)],
        fill: { address: Boolean(hotel && empty(hotel.address)), phone: Boolean(hotel && empty(hotel.contact_number)) },
        how: text.how,
      },
    };
  } catch {
    return { ok: false, error: "wz.hotels.err.unreadable" };
  }
}

/**
 * The hotel's final number: confirmed under it, its paper filed on the booking
 * (supplier-work.ts), and the hotel's address and phone written into /hotels
 * where — and only where — /hotels has none (the drivers' message reads them).
 */
export async function saveHotelConfirmation(formData: FormData): Promise<{ ok: true } | Fail> {
  const bookingId = String(formData.get("booking_id") ?? "");
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  const number = String(formData.get("confirmation_number") ?? "").trim().slice(0, 40);
  if (!number) return { ok: false, error: "ops.err.confirmationRequired" };
  try {
    const db = service();
    const booking = await bookingOf(db, bookingId, "hotel");
    if (!booking) return { ok: false, error: "ops.err.notFound" };

    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      const paper = new FormData();
      paper.set("booking_ids", booking.id);
      paper.set("file", file);
      const filed = await attachSupplierConfirmation(paper);
      if (!filed.ok) return filed;
    }

    const typed = {
      address: String(formData.get("address") ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      contact_number: String(formData.get("phone") ?? "").replace(/[^\d+()\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 30),
    };
    if (typed.address || typed.contact_number) {
      const hotel = await hotelOf(db, booking);
      for (const column of ["address", "contact_number"] as const) {
        if (!hotel || !typed[column] || !empty(hotel[column])) continue;
        // never over a value /hotels already holds — only while the field is still what was read empty
        const was = hotel[column];
        const update = db.from("hotels").update({ [column]: typed[column] }).eq("id", hotel.id);
        const { data: written } = await (was === null ? update.is(column, null) : update.eq(column, was)).select("id");
        if ((written ?? []).length > 0) {
          await logAudit({
            action: "data.updated",
            entity: "hotels",
            entity_id: hotel.id,
            meta: { changes: { [column]: [hotel[column], typed[column]] }, source: "hotel_confirmation", booking_id: booking.id },
          });
        }
      }
    }

    return await confirmBookingManually({ booking_id: booking.id, confirmation_number: number });
  } catch {
    return { ok: false, error: "err.db" };
  }
}
