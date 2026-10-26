/**
 * Travelers from the offer, and what each one still lacks before travel.
 *
 * The offer already says who travels — so many adults, children of these ages.
 * The case starts from that instead of an empty list, and `travelerReadiness`
 * is the per-traveler half of «جاهز للسفر».
 *
 * Pure: no React, no Supabase. Dates are YYYY-MM-DD strings; `today` is injected.
 */

import { nationalityCode } from "./nationality";
import { passportExpiringWithin, type NameSource, type TravelerKind, type TravelerListItem, type VisaStatus } from "./traveler-dto";

export type PlannedTraveler = {
  traveler_kind: TravelerKind;
  sort: number;
  display_name: string;
  age: number | null;
  visa_status: VisaStatus;
};

/**
 * One row per person the offer was sold for, the lead first.
 *
 * At least one adult: a case is never nobody. Everyone starts UNNAMED — the
 * screen shows «مسافر 1» — until a passport is read or a name typed. Not the
 * client's name: that is the WhatsApp contact («al 3r18y», AD-2-3599), it was
 * printed on the voucher, the sign and the supplier's list (the owner,
 * 2026-10-18), and it stays on the customer for greetings only.
 */
export function planTravelers(input: {
  adults: number;
  children: number;
  infants: number;
  children_ages: number[];
  infant_ages: number[];
  visa_required: boolean;
}): PlannedTraveler[] {
  const count = (n: number) => Math.max(Math.trunc(Number(n)) || 0, 0);
  const visa_status: VisaStatus = input.visa_required ? "required" : "not_required";
  const out: PlannedTraveler[] = [];
  const push = (traveler_kind: TravelerKind, age: number | null) => out.push({ traveler_kind, sort: out.length, display_name: "", age, visa_status });

  for (let i = 0; i < Math.max(count(input.adults), 1); i++) push("adult", null);
  for (let i = 0; i < count(input.children); i++) push("child", input.children_ages[i] ?? null);
  for (let i = 0; i < count(input.infants); i++) push("infant", input.infant_ages[i] ?? null);
  return out;
}

/** Whole years from `birth` to `on`; null when either is not a date. */
export function ageOn(birth: string | null, on: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth ?? "");
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(on);
  if (!b || !d) return null;
  const years = Number(d[1]) - Number(b[1]);
  // not yet had this year's birthday
  return `${d[2]}${d[3]}` < `${b[2]}${b[3]}` ? years - 1 : years;
}

/** A real calendar day «YYYY-MM-DD» — not 2026-02-30, which the database would refuse after the form let it by. */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** Nobody travelling was born before this — a year typed as 0199 or 1026 is a typo, not a guest. */
export const OLDEST_BIRTH = "1900-01-01";

/** A passport number as stored: upper case, the spaces a person types between groups gone. */
export const passportNumber = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export type TravelerInputError = "date" | "birthFuture" | "birthOld" | "passportNo";

/**
 * What a person typed for a passport, checked before it is saved — on the
 * server (upsertTraveler) and the same in the form (AD-2-3599: a birth date of
 * 2026-10-30 was taken, the age on the travel day came out -1 and the traveller
 * became «رضيع»; «سش» was taken as a passport number). null = fine. The number
 * is checked as passportNumber writes it: Latin letters and digits only.
 */
export function travelerInputError(
  input: { birth_date?: string | null; passport_expiry?: string | null; number?: string | null },
  today: string,
): TravelerInputError | null {
  if ([input.birth_date, input.passport_expiry].some((d) => d && !isCalendarDate(d))) return "date";
  if (input.birth_date && input.birth_date > today) return "birthFuture";
  if (input.birth_date && input.birth_date < OLDEST_BIRTH) return "birthOld";
  if (input.number != null && input.number.trim() && !/^[A-Z0-9]+$/.test(passportNumber(input.number))) return "passportNo";
  return null;
}

/** The generator's bands (AGE_BANDS): an infant is under 2, a child 2–11. */
export function kindForAge(age: number): TravelerKind {
  return age < 2 ? "infant" : age < 12 ? "child" : "adult";
}

export type PassportIssue = "passport" | "passport_expiry" | "passport_expired" | "passport_short" | "age_mismatch";
export type TravelerGap = PassportIssue | "visa" | "visa_check";
type Trip = { travel_start: string | null; travel_end: string | null };

/**
 * What is wrong with this traveler's passport — THE one decision, read by the
 * case's traveler row, «جاهز للسفر» and the client's /trip link. Empty = fine.
 *
 * Expired is judged on the travel day; otherwise it must outlive the return by
 * six months (the common entry rule), judged on `travel_end`; with no dates yet,
 * against today. The age check runs on the travel day: a child sold at 9 who
 * turns 12 before departure is an adult fare and an adult bed.
 */
export function passportIssues(
  t: Pick<TravelerListItem, "has_passport" | "passport_expiry" | "birth_date" | "age" | "traveler_kind">,
  trip: Trip,
  today: string,
): PassportIssue[] {
  const issues: PassportIssue[] = [];
  if (!t.has_passport) issues.push("passport");
  else if (!t.passport_expiry) issues.push("passport_expiry");
  if (t.passport_expiry && t.passport_expiry < (trip.travel_start ?? today)) issues.push("passport_expired");
  else if (passportExpiringWithin(t.passport_expiry, trip.travel_end ?? trip.travel_start ?? today, 6)) issues.push("passport_short");
  const age = ageOn(t.birth_date, trip.travel_start ?? today);
  if (age != null && (kindForAge(age) !== t.traveler_kind || (t.age != null && t.age !== age))) issues.push("age_mismatch");
  return issues;
}

/** What operations flagged on a passport ON FILE — the client is asked for a valid one instead of «تم الاستلام». */
export function passportNeedsUpdate(issues: PassportIssue[]): boolean {
  return issues.some((i) => i === "passport_expired" || i === "passport_short" || i === "age_mismatch");
}

/** What this traveler still lacks for travel: the passport's issues, then the visa. Empty = ready. */
export function travelerReadiness(
  t: Pick<TravelerListItem, "has_passport" | "passport_expiry" | "visa_status" | "birth_date" | "age" | "traveler_kind">,
  trip: Trip,
  today: string,
): TravelerGap[] {
  const gaps: TravelerGap[] = passportIssues(t, trip, today);
  if (t.visa_status === "required" || t.visa_status === "submitted") gaps.push("visa");
  if (t.visa_status === "check") gaps.push("visa_check");
  return gaps;
}

/** The destination's own visa setting (countries.visa_required, 0011; saudi_entry since 20261023), or null when the trip's country is not in /countries. */
export type DestinationVisa = { iso2: string | null; visa_required: boolean | null; saudi_entry?: string | null } | null;

/**
 * ponytail: a STARTING list, not a visa database — the pairs we are sure of:
 * GCC citizens cross GCC borders on their ID. Nationality is the passport's
 * ICAO alpha-3, the destination its ISO alpha-2. Add pairs as the owner
 * confirms them; anything not here is «يحتاج تحقق» for a non-Saudi.
 */
const GCC_NATIONALS = ["SAU", "ARE", "KWT", "BHR", "QAT", "OMN"];
const GCC_COUNTRIES = ["SA", "AE", "KW", "BH", "QA", "OM"];
export const VISA_EXEMPT: Record<string, string[]> = Object.fromEntries(GCC_NATIONALS.map((n) => [n, GCC_COUNTRIES]));

/**
 * A traveler's visa status from WHO travels and WHERE (owner order 8).
 *
 * The destination's `visa_required` was written for Saudi passports, so it
 * decides only for a Saudi — or for a case whose passports are not read yet,
 * as it always did. Any other nationality is «يحتاج تحقق» until an employee
 * looks, unless the exemption list says otherwise. A visa the offer SOLD is
 * required whoever travels. A nationality typed «سعودي» or «SA» is SAU
 * (nationalityCode) — it was «يحتاج تحقق» for a Saudi (the owner, 2026-10-22).
 */
export function visaFor(nationality: string | null, destination: DestinationVisa, sold: boolean): VisaStatus {
  const nat = nationalityCode(nationality);
  const iso2 = (destination?.iso2 ?? "").trim().toUpperCase();
  if (nat && iso2 && VISA_EXEMPT[nat]?.includes(iso2)) return "not_required";
  if (sold) return "required";
  if (nat && nat !== "SAU") return "check";
  // the catalogue's own answer for a Saudi passport (countries.saudi_entry, the visa
  // list's data): free or on-arrival needs nothing from us; e-visa or embassy does
  const entry = destination?.saudi_entry ?? null;
  if (entry === "free" || entry === "arrival") return "not_required";
  if (entry === "evisa" || entry === "embassy") return "required";
  return destination?.visa_required ? "required" : "not_required";
}

/** A name a passport could carry as written — the only kind worth pre-filling. */
export function isLatinName(name: string): boolean {
  return /^[A-Za-z][A-Za-z .'-]*$/.test(name.trim());
}

// ---------- the traveller's name: as in the passport (the owner, 2026-10-18) ----------

type Named = { display_name: string; name_source?: NameSource | null };

const nameKey = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();

/** The same name, case and spacing aside. */
export function sameName(a: string, b: string): boolean {
  return nameKey(a) !== "" && nameKey(a) === nameKey(b);
}

/**
 * May a passport read replace this name without asking? Yes when there is none,
 * or it was planned from the offer, or read off an earlier passport. A name a
 * person typed is asked about («استبدال بالاسم من الجواز») — and so is one of
 * unknown source (a database before 0091): asking is the safe side.
 */
export function takesPassportName(t: Named | null): boolean {
  return !t || !t.display_name.trim() || t.name_source === "seed" || t.name_source === "passport";
}

/**
 * The traveller's name after a save — THE rule, applied by upsertTraveler so
 * every path (the wizard's bulk read, a row's photo, the client's upload
 * accepted, the form) gets it.
 *
 * `typed` is the name the save carries; `prev` the row before it (null = new).
 * A name changed in this save is the person's own choice — `passport` when it
 * is the passport's name, else `manual`. An unchanged name gives way to the
 * passport's when takesPassportName allows; a typed one stays.
 */
export function savedName(prev: Named | null, typed: string, passportName: string): { display_name: string; name_source: NameSource } {
  const name = typed.trim();
  const read = passportName.trim();
  const before = prev?.display_name.trim() ?? "";
  const fromPassport = { display_name: read, name_source: "passport" as const };
  if (name !== before) {
    if (!name) return read ? fromPassport : { display_name: "", name_source: "seed" };
    return { display_name: name, name_source: sameName(name, read) ? "passport" : "manual" };
  }
  if (read && takesPassportName(prev)) return fromPassport;
  return { display_name: before, name_source: prev?.name_source ?? (before ? "manual" : "seed") };
}

/**
 * THE name on the arrival sign, the driver's «Guest» line and the documents'
 * lead guest: the first named traveller's, as in the passport. "" while nobody
 * is named — never the client's contact name instead.
 */
export function leadName(travelers: Named[]): string {
  return travelers.find((t) => t.display_name.trim())?.display_name.trim() ?? "";
}
