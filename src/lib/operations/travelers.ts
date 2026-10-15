/**
 * Travelers from the offer, and what each one still lacks before travel.
 *
 * The offer already says who travels — so many adults, children of these ages,
 * the client's name. The case starts from that instead of an empty list, and
 * `travelerReadiness` is the per-traveler half of «جاهز للسفر».
 *
 * Pure: no React, no Supabase. Dates are YYYY-MM-DD strings; `today` is injected.
 */

import { passportExpiringWithin, type TravelerKind, type TravelerListItem, type VisaStatus } from "./traveler-dto";

export type PlannedTraveler = {
  traveler_kind: TravelerKind;
  sort: number;
  display_name: string;
  age: number | null;
  visa_status: VisaStatus;
};

/**
 * One row per person the offer was sold for, the client first.
 *
 * At least one adult: a case is never nobody, and the lead is the client. The
 * others start unnamed — a made-up «بالغ 2» would print on a voucher.
 */
export function planTravelers(input: {
  adults: number;
  children: number;
  infants: number;
  children_ages: number[];
  infant_ages: number[];
  lead_name: string;
  visa_required: boolean;
}): PlannedTraveler[] {
  const count = (n: number) => Math.max(Math.trunc(Number(n)) || 0, 0);
  const visa_status: VisaStatus = input.visa_required ? "required" : "not_required";
  const out: PlannedTraveler[] = [];
  const push = (traveler_kind: TravelerKind, age: number | null) =>
    out.push({ traveler_kind, sort: out.length, display_name: out.length === 0 ? input.lead_name.trim() : "", age, visa_status });

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

/** The destination's own visa setting (countries.visa_required, 0011), or null when the trip's country is not in /countries. */
export type DestinationVisa = { iso2: string | null; visa_required: boolean | null } | null;

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
 * required whoever travels.
 */
export function visaFor(nationality: string | null, destination: DestinationVisa, sold: boolean): VisaStatus {
  const nat = (nationality ?? "").trim().toUpperCase();
  const iso2 = (destination?.iso2 ?? "").trim().toUpperCase();
  if (nat && iso2 && VISA_EXEMPT[nat]?.includes(iso2)) return "not_required";
  if (sold) return "required";
  if (nat && nat !== "SAU") return "check";
  return destination?.visa_required ? "required" : "not_required";
}

/** A name a passport could carry as written — the only kind worth pre-filling. */
export function isLatinName(name: string): boolean {
  return /^[A-Za-z][A-Za-z .'-]*$/.test(name.trim());
}
