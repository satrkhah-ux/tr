import type { TravelerKind, TravelerListItem } from "@/lib/operations/traveler-dto";
import { ageOn, kindForAge, passportIssues, travelerReadiness } from "@/lib/operations/travelers";
import { compareName } from "./flights";
import type { ReadinessCase, ReadinessItem, SoldTravelers, StepState, WizardCase } from "./types";

/**
 * Step 1 — «الجوازات»: who actually travels, read off the passports. The
 * per-traveller decision (missing, expired, under six months, age not as
 * sold, the visa) stays travelers.ts's — the case row, «جاهز للسفر», the daily
 * alerts and /trip already share it; this step only counts it against the offer.
 */

type Trip = { travel_start: string | null; travel_end: string | null };

/** The kind on the TRAVEL day: a child sold at 11 who turns 12 before departure is an adult fare. */
export function kindOnTrip(t: Pick<TravelerListItem, "birth_date" | "traveler_kind">, trip: Trip, today: string): TravelerKind {
  const age = ageOn(t.birth_date, trip.travel_start ?? today);
  return age == null ? t.traveler_kind : kindForAge(age);
}

export type KindCount = Record<TravelerKind, number>;

export type PassportSummary = {
  sold: KindCount | null;
  /** the travellers by their kind on the travel day */
  actual: KindCount;
  withPassport: number;
  /** the offer was priced for other people than these — said in one line */
  mismatch: boolean;
  /** passports that expire before the trip, or within six months of the return */
  short: number;
  /** visas still to get, or nationalities nobody checked yet */
  visas: number;
};

const count = (kinds: TravelerKind[]): KindCount => ({
  adult: kinds.filter((k) => k === "adult").length,
  child: kinds.filter((k) => k === "child").length,
  infant: kinds.filter((k) => k === "infant").length,
});

export function soldCount(sold: SoldTravelers | null): KindCount | null {
  if (!sold) return null;
  const n = (v: number) => Math.max(Math.trunc(Number(v)) || 0, 0);
  // a case is never nobody — planTravelers seeds one adult at least, so the offer is read the same way
  return { adult: Math.max(n(sold.adults), 1), child: n(sold.children), infant: n(sold.infants) };
}

export function passportSummary(data: Pick<ReadinessCase, "travelers" | "operation" | "sold" | "today">): PassportSummary {
  const trip = data.operation;
  const sold = soldCount(data.sold);
  const actual = count(data.travelers.map((t) => kindOnTrip(t, trip, data.today)));
  const issues = data.travelers.map((t) => passportIssues(t, trip, data.today));
  return {
    sold,
    actual,
    withPassport: data.travelers.filter((t) => t.has_passport).length,
    mismatch: sold != null && (sold.adult !== actual.adult || sold.child !== actual.child || sold.infant !== actual.infant),
    short: issues.filter((i) => i.includes("passport_expired") || i.includes("passport_short")).length,
    visas: data.travelers.filter((t) => t.visa_status === "required" || t.visa_status === "submitted" || t.visa_status === "check").length,
  };
}

/** Done once every traveller is ready by the shared rule — the passport AND its visa. */
export function passportsState(data: WizardCase): StepState {
  if (data.travelers.length === 0) return "todo";
  return data.travelers.every((t) => travelerReadiness(t, data.operation, data.today).length === 0) ? "done" : "todo";
}

export function passportsReadiness(data: ReadinessCase): ReadinessItem[] {
  const trip = data.operation;
  return [
    // a valid passport for every traveller: on file, not expiring within six months of the return, the age as sold
    { step: "passports", key: "passports", ok: data.travelers.length > 0 && data.travelers.every((t) => passportIssues(t, trip, data.today).length === 0) },
    { step: "passports", key: "visas", ok: data.travelers.every((t) => !["required", "submitted", "check"].includes(t.visa_status)) },
    // a different party than the one priced is a conversation with the client, not a reason to stop the trip
    { step: "passports", key: "count", ok: !passportSummary(data).mismatch, optional: true },
  ];
}

// ---------- which traveller a passport just read belongs to ----------

/** What a read gave, trusted fields only (mrz.ts trustedFields) — "" where it gave nothing. */
export type ReadPassport = { full_name: string; birth_date: string; nationality: string };

export type MatchRow = Pick<TravelerListItem, "id" | "display_name" | "name_source" | "traveler_kind" | "age" | "birth_date" | "nationality" | "has_passport">;

/**
 * The row a passport belongs to, or null for a traveller the case does not
 * have yet. In order: the same person read before (birth date + nationality —
 * a passport uploaded twice must not add a second traveller); the name already
 * written, in either script — compareName, the tickets' check: «SARA ALI» and
 * «سارة الأحمد» against the MRZ's Latin, the surest first; then a row still
 * without a passport — the same kind and sold age, the same kind, any. A
 * planned name says nothing about whose passport this is, so it is not matched
 * on. A child's passport on an adult's row is what the age check is for: it
 * says so instead of hiding it.
 */
export function matchPassport(rows: MatchRow[], read: ReadPassport, trip: Trip, today: string, taken: ReadonlySet<string>): MatchRow | null {
  const open = rows.filter((r) => !taken.has(r.id));
  if (read.birth_date) {
    const same = open.find((r) => r.birth_date === read.birth_date && (!r.nationality || !read.nationality || r.nationality === read.nationality));
    if (same) return same;
  }
  if (read.full_name.trim()) {
    const by = (status: "ok" | "likely") =>
      open.find((r) => r.name_source !== "seed" && r.display_name.trim() && compareName(r.display_name, read.full_name) === status);
    const named = by("ok") ?? by("likely");
    if (named) return named;
  }
  const free = open.filter((r) => !r.has_passport);
  const age = ageOn(read.birth_date || null, trip.travel_start ?? today);
  if (age != null) {
    const kind = kindForAge(age);
    const hit = free.find((r) => r.traveler_kind === kind && r.age === age) ?? free.find((r) => r.traveler_kind === kind);
    if (hit) return hit;
  }
  return free[0] ?? null;
}
