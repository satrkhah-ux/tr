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

export type TravelerGap = "passport" | "passport_expiry" | "passport_short" | "visa" | "age_mismatch";

/**
 * What this traveler still lacks for travel. Empty = ready.
 *
 * The passport must outlive the return by six months (the common entry rule),
 * judged on `travel_end`; with no dates yet, against today. The age check runs
 * on the travel day: a child sold at 9 who turns 12 before departure is an
 * adult fare and an adult bed.
 */
export function travelerReadiness(
  t: Pick<TravelerListItem, "has_passport" | "passport_expiry" | "visa_status" | "birth_date" | "age" | "traveler_kind">,
  trip: { travel_start: string | null; travel_end: string | null },
  today: string,
): TravelerGap[] {
  const gaps: TravelerGap[] = [];
  if (!t.has_passport) gaps.push("passport");
  else if (!t.passport_expiry) gaps.push("passport_expiry");
  if (passportExpiringWithin(t.passport_expiry, trip.travel_end ?? trip.travel_start ?? today, 6)) gaps.push("passport_short");
  if (t.visa_status === "required" || t.visa_status === "submitted") gaps.push("visa");
  const age = ageOn(t.birth_date, trip.travel_start ?? today);
  if (age != null && (kindForAge(age) !== t.traveler_kind || (t.age != null && t.age !== age))) gaps.push("age_mismatch");
  return gaps;
}

/** A name a passport could carry as written — the only kind worth pre-filling. */
export function isLatinName(name: string): boolean {
  return /^[A-Za-z][A-Za-z .'-]*$/.test(name.trim());
}
