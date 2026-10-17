/**
 * «تذاكر الطيران» — step 2 of «معالج الحجوزات».
 *
 * A flight booking is TICKETED when it is confirmed and holds its PNR, at least
 * one ticket number and the legs read off the ticket (0084). The legs are what
 * the drivers are timed from: each is stored with its airport's offset, and
 * written back into the booking's leg lines so the readers that already parse
 * those lines (flight-follow, the tracker, the voucher, the client's page) all
 * get the ticketed numbers and times.
 *
 * Also here: the passengers' names on a ticket against the passports — a ticket
 * whose name differs from the passport is a refused boarding, so a mismatch is
 * shown in red. The hotels step uses the same check for its guests.
 *
 * Pure: no React, no Supabase.
 */
import type { FlightLeg, OperationBooking } from "@/lib/data/operation-bookings";
import type { TicketLeg } from "@/lib/flights/ticket-parse";
import { toInstant } from "@/lib/offer/schedule";
import { parseLeg } from "@/lib/operations/drivers";
import { LANDS, LATER } from "@/lib/operations/seed-plan";
import type { ReadinessItem, StepState, WizardCase } from "./types";

// ---------------- the step's state ----------------

/** The flights this step works — a cancelled booking needs no ticket. */
export function flightBookings(data: Pick<WizardCase, "bookings">): OperationBooking[] {
  return data.bookings.filter((b) => b.kind === "flight" && b.status !== "cancelled");
}

export function isTicketed(b: OperationBooking): boolean {
  return b.status === "confirmed" && Boolean(b.pnr?.trim()) && (b.ticket_numbers?.length ?? 0) > 0 && (b.flight_legs?.length ?? 0) > 0;
}

export function flightsState(data: WizardCase): StepState {
  const flights = flightBookings(data);
  if (flights.length === 0) return "na";
  return flights.every(isTicketed) ? "done" : "todo";
}

/** «التذاكر»: every flight booking ticketed — mandatory before «جاهز للسفر». `key` is the i18n key. */
export function flightsReadiness(data: WizardCase): ReadinessItem[] {
  const flights = flightBookings(data);
  return flights.length === 0 ? [] : [{ step: "flights", key: "wz.flights.ready", ok: flights.every(isTicketed) }];
}

// ---------------- the legs, as stored ----------------

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * «2026-11-20» «01:00» at the airport's IANA zone → «2026-11-20T01:00:00+03:00».
 * An airport we hold no zone for keeps its wall clock alone — still what the
 * driver reads, never a guessed offset. null without a date and a time.
 */
export function isoAt(date: string, time: string, tz: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const local = `${date}T${time}`;
  const instant = toInstant(local, tz);
  if (!instant) return `${local}:00`;
  const offset = Math.round((Date.parse(`${local}:00Z`) - instant.getTime()) / 60_000);
  const a = Math.abs(offset);
  return `${local}:00${offset < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export type LegInput = Pick<TicketLeg, "flight_no" | "from_iata" | "to_iata" | "dep_date" | "dep_time" | "arr_date" | "arr_time">;

/** The form's legs → the booking's flight_legs. An arrival with no date of its own lands the day it left. */
export function toFlightLegs(legs: LegInput[], zoneOf: (code: string) => string | null): FlightLeg[] {
  return legs.map((l) => ({
    flight_no: l.flight_no.toUpperCase().replace(/[\s-]+/g, ""),
    from: l.from_iata.toUpperCase(),
    to: l.to_iata.toUpperCase(),
    departs_at: isoAt(l.dep_date, l.dep_time, zoneOf(l.from_iata.toUpperCase())),
    arrives_at: isoAt(l.arr_date || l.dep_date, l.arr_time, zoneOf(l.to_iata.toUpperCase())),
  }));
}

/** Not a leg the drivers can be timed from: no number, no times, or a landing before (or a day after) the take-off. */
export function badLeg(l: FlightLeg): boolean {
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(l.flight_no) || !l.departs_at || !l.arrives_at) return true;
  // both offsets known: the real duration; else the two wall clocks can't be compared
  const zoned = /[+-]\d{2}:\d{2}$/;
  if (!zoned.test(l.departs_at) || !zoned.test(l.arrives_at)) return false;
  const minutes = (Date.parse(l.arrives_at) - Date.parse(l.departs_at)) / 60_000;
  return !(minutes > 0 && minutes <= 22 * 60);
}

const wall = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : LATER);

/** «TK2810 · IST → TZX · 2026-10-20 08:15 · الوصول 2026-10-20 10:05» — the line drivers.ts parseLeg reads back. */
export function legLine(l: FlightLeg): string {
  return `${l.flight_no || "—"} · ${l.from} → ${l.to} · ${wall(l.departs_at)}${l.arrives_at ? ` · ${LANDS} ${wall(l.arrives_at)}` : ""}`;
}

/** The one-leg form a flight typed by hand used before leg lines — replaced by the ticket's lines. */
const OLD_LEG_KEYS = ["رقم الرحلة", "من", "إلى", "الإقلاع", "الوصول"];

/**
 * The booking's detail with its leg lines rewritten from the ticket. The plan's
 * keys («الذهاب», «رحلة 1») are kept when the ticket has as many legs, else
 * «رحلة n» — a key whose line changed is what flight-follow re-times the
 * drives from. Every other line (the class, the passengers) stays; the
 * allowance printed on the ticket replaces the planned one.
 */
export function withTicketLines(detail: Record<string, string>, legs: FlightLeg[], baggage = ""): Record<string, string> {
  const lines = Object.keys(detail).filter((k) => parseLeg(detail[k]) !== null);
  const keys = lines.length === legs.length ? lines : legs.map((_, i) => `رحلة ${i + 1}`);
  const out = Object.fromEntries(Object.entries(detail).filter(([k]) => !lines.includes(k) && !OLD_LEG_KEYS.includes(k)));
  legs.forEach((l, i) => (out[keys[i]] = legLine(l)));
  if (baggage.trim()) out["الأمتعة"] = baggage.trim();
  return out;
}

// ---------------- the names on the ticket against the passports ----------------

const TITLES = new Set("MR MRS MS MISS MSTR DR CHD INF السيد السيدة الانسة الطفل الطفلة الرضيع".split(" "));
const ARABIC = /[؀-ۿ]/;

/** A name's words: letters only, titles and Arabic marks gone — «SURNAME/GIVEN MR» and «Given Surname» alike. */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟـ]/g, "")
    .toUpperCase()
    .split(/[^\p{L}]+/u)
    .filter((t) => t && !TITLES.has(t));
}

const AR: Record<string, string> = {
  ب: "B", ت: "T", ث: "T", ج: "J", ح: "H", خ: "K", د: "D", ذ: "D", ر: "R", ز: "D", س: "S", ش: "S", ص: "S", ض: "D",
  ط: "T", ظ: "D", غ: "J", ف: "F", ق: "K", ك: "K", ل: "L", م: "M", ن: "N", ه: "H", پ: "F", گ: "J", چ: "J",
};

/**
 * A name as its consonants sound — «محمد» and «MOHAMMED» are both MHMD,
 * «القحطاني» and «ALQAHTANI» both LKHTN. Only ever «likely»: an Arabic spelling
 * cannot prove a Latin one.
 */
export function skeleton(token: string): string {
  let s: string;
  if (ARABIC.test(token)) {
    s = [...(token.length > 2 ? token.replace(/[هة]$/, "") : token)].map((c) => AR[c] ?? "").join("");
  } else {
    s = token.replace(/[^A-Z]/g, "");
    if (s.length > 2) s = s.replace(/H$/, ""); // FATIMAH / FATIMA, ABDULLAH / ABDULLA
    s = s
      .replace(/KH/g, "K").replace(/GH/g, "J").replace(/SH/g, "S").replace(/TH/g, "T").replace(/DH/g, "D").replace(/PH/g, "F")
      .replace(/[QC]/g, "K").replace(/Z/g, "D").replace(/G/g, "J").replace(/[PV]/g, "F")
      .replace(/[AEIOUYW]/g, "");
  }
  return s.replace(/(.)\1+/g, "$1");
}

const exact = (t: string) => t.replace(/ة/g, "ه").replace(/ى/g, "ي");
/** «FAHADMR» — a title some tickets print glued to the given name. */
const GLUED = /(?:MRS|MSTR|MISS|MR|MS)$/;

/**
 * Is every word of `want` among `have`'s? A word may be several of `have`'s run
 * together («ALQAHTANI» = «AL QAHTANI»), and two of `want`'s may make one of
 * `have`'s. `used`: how many of `have`'s words were met.
 */
function covers(want: string[], have: string[], key: (t: string) => string): { all: boolean; used: number } {
  const h = have.map(key);
  const used = new Set<number>();
  const runOf = (target: string): number[] | null => {
    if (target.length < 2) return null;
    for (let i = 0; i < h.length; i += 1) {
      let joined = "";
      for (let j = i; j < Math.min(h.length, i + 4) && joined.length < target.length; j += 1) {
        joined += h[j];
        if (h[j] && joined === target) return Array.from({ length: j - i + 1 }, (_, k) => i + k);
      }
    }
    return null;
  };
  // a word too short to tell apart («ALI» sounds «L») can be checked neither way
  const w = want.filter((t) => key(t).length >= 2);
  for (let k = 0; k < w.length; k += 1) {
    const one = (t: string) => runOf(key(t)) ?? (GLUED.test(t) ? runOf(key(t.replace(GLUED, ""))) : null);
    let hit = one(w[k]);
    if (!hit && k + 1 < w.length) {
      hit = runOf(key(w[k]) + key(w[k + 1]));
      if (hit) k += 1;
    }
    if (!hit) return { all: false, used: used.size };
    hit.forEach((i) => used.add(i));
  }
  return { all: w.length > 0, used: used.size };
}

export type NameStatus = "ok" | "likely" | "mismatch";

/**
 * One ticket name against one passport name.
 *   ok       — same script, every word of the ticket is the passport's, and at least two of them;
 *   likely   — the ticket holds every passport word and more (we hold a shorter name than the
 *              passport's), or an Arabic name sounds like the Latin ticket;
 *   mismatch — anything else: a letter off is a different name to the airline.
 */
export function compareName(ticket: string, passport: string): NameStatus {
  const t = nameTokens(ticket);
  const p = nameTokens(passport);
  if (t.length === 0 || p.length === 0) return "mismatch";
  const need = Math.min(2, p.length);
  if (t.some((x) => ARABIC.test(x)) !== p.some((x) => ARABIC.test(x))) {
    const heard = Math.min(2, p.filter((x) => skeleton(x).length >= 2).length);
    const s = covers(t, p, skeleton);
    return heard > 0 && s.all && s.used >= heard ? "likely" : "mismatch";
  }
  const e = covers(t, p, exact);
  if (e.all && e.used >= need) return "ok";
  return p.length >= 2 && covers(p, t, exact).all ? "likely" : "mismatch";
}

/** A traveller as the check sees them: their case name and, where it could be read, the passport's. */
export type TravelerNames = { id: string; label: string; names: string[] };
export type NameCheck = { name: string; traveler_id: string | null; traveler: string | null; status: NameStatus };

const RANK: Record<NameStatus, number> = { ok: 2, likely: 1, mismatch: 0 };

/** Each ticket name to the traveller it is — the surest pairs first, one traveller per name — and the travellers no name is. */
export function checkNames(passengers: string[], travelers: TravelerNames[]): { names: NameCheck[]; missing: string[] } {
  const pairs = passengers
    .flatMap((name, i) =>
      travelers.map((t) => {
        const status = t.names.map((n) => compareName(name, n)).sort((a, b) => RANK[b] - RANK[a])[0] ?? "mismatch";
        return { i, t, status };
      }),
    )
    .filter((p) => p.status !== "mismatch")
    .sort((a, b) => RANK[b.status] - RANK[a.status]);
  const names: NameCheck[] = passengers.map((name) => ({ name, traveler_id: null, traveler: null, status: "mismatch" }));
  const taken = new Set<string>();
  for (const p of pairs) {
    if (names[p.i].traveler_id || taken.has(p.t.id)) continue;
    names[p.i] = { name: names[p.i].name, traveler_id: p.t.id, traveler: p.t.label, status: p.status };
    taken.add(p.t.id);
  }
  return { names, missing: travelers.filter((t) => !taken.has(t.id)).map((t) => t.label) };
}
