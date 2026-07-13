/**
 * Rate normalization — pure, dependency-free. Turns raw supplier rates into a
 * comparable, base-currency form and decides which rates may be ranked against
 * each other.
 *
 * The comparable total is the ONLY number ranking uses:
 *     comparable_total_base = inclusive + SUM(Mandatory surcharges)   (in base)
 * "Excluded" surcharges are NOT in the total (the guest pays them at the hotel)
 * but are retained verbatim on the normalized rate for client display.
 *
 * Two rates are comparable ONLY if they match on hotel, exact dates, occupancy,
 * normalized room category, board type and refundability. Non-comparable rates
 * are grouped separately and never silently ranked against each other; each
 * exclusion carries a human reason.
 *
 * `rankComparable` takes rates from N suppliers by design; today N = 1. Adding a
 * supplier later requires ZERO changes here — the supplier is just a field.
 */

import { convert, type CurrencyRates } from "@/lib/offer/pricing";
import type { BoardType } from "@/lib/types";
import type { Occupancy, RoomCategory, SupplierRate, Surcharge } from "./rate-types";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Locale-INDEPENDENT string order (code-point), so ranking is deterministic
 *  across environments even when keys contain Arabic (localeCompare is not). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------- room category normalization ----------
/** Ordered so more specific labels win (junior suite before suite, etc.). */
const ROOM_CATEGORY_RULES: { category: RoomCategory; patterns: string[] }[] = [
  { category: "junior_suite", patterns: ["junior suite", "junior", "جونيور", "جناح صغير"] },
  { category: "family", patterns: ["family", "عائلي", "عائلية", "للعائلة"] },
  { category: "suite", patterns: ["suite", "جناح"] },
  { category: "deluxe", patterns: ["deluxe", "luxury", "ديلوكس", "فاخر", "فاخرة"] },
  { category: "superior", patterns: ["superior", "premium", "سوبيريور", "متميز", "متميزة"] },
  { category: "standard", patterns: ["standard", "classic", "run of house", "ستاندرد", "قياسي", "قياسية", "عادي", "عادية"] },
];

/** Collapse a raw supplier room label (AR or EN, any casing) to a RoomCategory. */
export function normalizeRoomCategory(raw: string): RoomCategory {
  const text = (raw ?? "").toLowerCase().trim();
  if (!text) return "other";
  for (const rule of ROOM_CATEGORY_RULES) {
    if (rule.patterns.some((p) => text.includes(p))) return rule.category;
  }
  return "other";
}

// ---------- normalized rate ----------
export type NormalizedRate = {
  // ----- provenance (INTERNAL) -----
  supplier_id: string;
  supplier_name: string;
  rate_key: string;
  // ----- identity / comparability -----
  hotel_id: string;
  hotel_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  occupancy: Occupancy;
  room_category: RoomCategory;
  /** lowercased raw supplier label — disambiguates the "other" catch-all so two
   *  genuinely different unrecognized rooms are never treated as comparable. */
  raw_room_label: string;
  board_type: BoardType;
  refundable: boolean;
  // ----- money in BASE currency (INTERNAL cost) -----
  base: string;
  net_inclusive_base: number;
  mandatory_base: number;
  /** inclusive + mandatory surcharges, in base — the ONLY value ranking uses. */
  comparable_total_base: number;
  /** supplier floor (ref sell) converted to base, or null. */
  ref_sell_base: number | null;
  // ----- fx provenance (stored on the rate so a snapshot never drifts) -----
  currency: string;
  fx_rate: number; // base units per 1 unit of `currency` (rates[currency])
  fx_date: string;
  // ----- client-facing carry-through -----
  cancellation_policy: string;
  /** guest pays these at the hotel — retained verbatim, never in the total. */
  excluded_surcharges: Surcharge[];
  valid_until: string | null;
};

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(Math.round((b - a) / 86_400_000), 0);
}

/**
 * Normalize one supplier rate into base currency. Returns null when a monetary
 * component (inclusive or a Mandatory surcharge) is in a currency with no fx
 * rate — such a rate cannot be given a trustworthy comparable total, so it is
 * excluded from ranking rather than compared on a guessed number.
 *
 * `fxDate` is the date the rates were fetched; it is stored so the snapshot is
 * reproducible.
 */
export function normalizeRate(
  rate: SupplierRate,
  rates: CurrencyRates,
  base: string,
  fxDate: string,
): NormalizedRate | null {
  const netInclusiveBase = convert(rate.inclusive, rate.currency, rates, base);
  if (netInclusiveBase == null) return null;

  let mandatoryBase = 0;
  const excluded: Surcharge[] = [];
  for (const s of rate.surcharges) {
    if (s.charge === "Mandatory") {
      const inBase = convert(s.amount, s.currency, rates, base);
      if (inBase == null) return null; // can't trust the comparable total
      mandatoryBase += inBase;
    } else {
      // Excluded — retained verbatim (name + amount + currency), NOT converted:
      // the guest pays it at the hotel, in that currency.
      excluded.push({ ...s });
    }
  }
  mandatoryBase = round2(mandatoryBase);

  const fxRate = rate.currency === base ? 1 : rates[rate.currency];
  const refSellBase = rate.ref_sell == null ? null : convert(rate.ref_sell, rate.currency, rates, base);

  return {
    supplier_id: rate.supplier_id,
    supplier_name: rate.supplier_name,
    rate_key: rate.rate_key,
    hotel_id: rate.hotel_id,
    hotel_name: rate.hotel_name,
    check_in: rate.check_in,
    check_out: rate.check_out,
    nights: nightsBetween(rate.check_in, rate.check_out),
    occupancy: { ...rate.occupancy },
    room_category: normalizeRoomCategory(rate.room_category_raw),
    raw_room_label: (rate.room_category_raw ?? "").toLowerCase().trim(),
    board_type: rate.board_type,
    refundable: rate.refundable,
    base,
    net_inclusive_base: netInclusiveBase,
    mandatory_base: mandatoryBase,
    comparable_total_base: round2(netInclusiveBase + mandatoryBase),
    ref_sell_base: refSellBase,
    currency: rate.currency,
    fx_rate: Number.isFinite(fxRate) ? fxRate : 1,
    fx_date: fxDate,
    cancellation_policy: rate.cancellation_policy,
    excluded_surcharges: excluded,
    valid_until: rate.valid_until,
  };
}

// ---------- comparability ----------
/** The dimensions that must match for two rates to be comparable. */
export type ComparabilityFacet = "hotel" | "dates" | "occupancy" | "room_category" | "board" | "refundability";

const OCCUPANCY_KEY = (o: Occupancy): string => `${o.adults}-${o.children}-${o.rooms}`;

/**
 * A stable key that is identical for two rates IFF they are comparable. Rates
 * with different keys live in different groups and are never ranked together.
 * Supplier is deliberately NOT part of the key — the whole point is to compare
 * the SAME room across suppliers.
 */
/**
 * The room-category token used for comparability. Recognized categories compare
 * by category (a "Deluxe Room" and a "Deluxe King" are the same class); an
 * UNRECOGNIZED room ("other") compares only to the same raw label — so
 * "Overwater Villa" and "Garden View Room" (both "other") are NOT lumped together.
 */
function categoryToken(r: NormalizedRate): string {
  return r.room_category === "other" ? `other:${r.raw_room_label}` : r.room_category;
}

export function comparabilityKey(r: NormalizedRate): string {
  return [
    r.hotel_id,
    r.check_in,
    r.check_out,
    OCCUPANCY_KEY(r.occupancy),
    categoryToken(r),
    r.board_type,
    r.refundable ? "R" : "NR",
  ].join("|");
}

/** Which facets differ between a reference rate and a candidate (empty = comparable). */
export function comparabilityDiff(ref: NormalizedRate, candidate: NormalizedRate): ComparabilityFacet[] {
  const diffs: ComparabilityFacet[] = [];
  if (ref.hotel_id !== candidate.hotel_id) diffs.push("hotel");
  if (ref.check_in !== candidate.check_in || ref.check_out !== candidate.check_out) diffs.push("dates");
  if (OCCUPANCY_KEY(ref.occupancy) !== OCCUPANCY_KEY(candidate.occupancy)) diffs.push("occupancy");
  if (categoryToken(ref) !== categoryToken(candidate)) diffs.push("room_category");
  if (ref.board_type !== candidate.board_type) diffs.push("board");
  if (ref.refundable !== candidate.refundable) diffs.push("refundability");
  return diffs;
}

/** True when two rates may be ranked against each other. */
export function areComparable(a: NormalizedRate, b: NormalizedRate): boolean {
  return comparabilityKey(a) === comparabilityKey(b);
}

const FACET_REASON_AR: Record<ComparabilityFacet, string> = {
  hotel: "فندق مختلف",
  dates: "تواريخ مختلفة",
  occupancy: "إشغال مختلف",
  room_category: "فئة غرفة مختلفة",
  board: "نظام وجبات مختلف",
  refundability: "غير قابل للاسترداد",
};

/** Human (Arabic) reason for each facet that excludes a rate from a group. */
export function exclusionReasonsAr(facets: ComparabilityFacet[]): string[] {
  return facets.map((f) => FACET_REASON_AR[f]);
}

// ---------- grouping + ranking ----------
export type RateGroup = {
  key: string;
  /** the facet values shared by every rate in the group. */
  facets: {
    hotel_id: string;
    hotel_name: string;
    room_category: RoomCategory;
    board_type: BoardType;
    refundable: boolean;
    occupancy: Occupancy;
    check_in: string;
    check_out: string;
  };
  /** ascending by comparable_total_base (cheapest first). */
  rates: NormalizedRate[];
};

/**
 * Partition rates into comparable groups, each ranked cheapest-first. Rates in
 * different groups are NEVER ranked against each other. Group order is stable
 * (by cheapest rate, then key) so output is deterministic.
 */
export function groupComparable(rates: NormalizedRate[]): RateGroup[] {
  const byKey = new Map<string, NormalizedRate[]>();
  for (const r of rates) {
    const key = comparabilityKey(r);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(r);
    else byKey.set(key, [r]);
  }

  const groups: RateGroup[] = [];
  for (const [key, list] of byKey) {
    const ranked = rankComparable(list);
    const head = ranked[0];
    groups.push({
      key,
      facets: {
        hotel_id: head.hotel_id,
        hotel_name: head.hotel_name,
        room_category: head.room_category,
        board_type: head.board_type,
        refundable: head.refundable,
        occupancy: head.occupancy,
        check_in: head.check_in,
        check_out: head.check_out,
      },
      rates: ranked,
    });
  }

  groups.sort((a, b) => {
    const byPrice = a.rates[0].comparable_total_base - b.rates[0].comparable_total_base;
    return byPrice !== 0 ? byPrice : cmpStr(a.key, b.key);
  });
  return groups;
}

/**
 * Rank an ALREADY-comparable set of rates cheapest-first by comparable total.
 * The caller is responsible for only passing comparable rates (use
 * groupComparable to partition first). Ties break by supplier_id then rate_key
 * for determinism. Multi-supplier by construction — supplier is just a field.
 */
export function rankComparable(rates: NormalizedRate[]): NormalizedRate[] {
  return [...rates].sort((a, b) => {
    const byPrice = a.comparable_total_base - b.comparable_total_base;
    if (byPrice !== 0) return byPrice;
    const bySupplier = cmpStr(a.supplier_id, b.supplier_id);
    return bySupplier !== 0 ? bySupplier : cmpStr(a.rate_key, b.rate_key);
  });
}
