import type { TranslationKey } from "@/lib/i18n";
import type { AllowedTable, DataValue } from "./types";

/**
 * Data quality (data section orders 3 and 11) — the pure half.
 *
 * Every card on /data-quality is one issue key. The database decides which rows
 * have it (migration 0071, data_quality_<table>(p_issue)) and counts them
 * (data_quality_counts()); this file only names them, says which screen fixes
 * them, and holds the checks that need no database. quality.test.ts keeps the
 * keys here and in 0071 the same.
 */

export type IssueGroup = "hotels" | "cities" | "catalog" | "transport";

export type QualityIssue = {
  key: string;
  table: AllowedTable;
  /** the data screen that lists — and fixes — the rows */
  route: string;
  group: IssueGroup;
  labelKey: TranslationKey;
};

export const QUALITY_ISSUES = [
  { key: "hotel_no_arabic", table: "hotels", route: "/hotels", group: "hotels", labelKey: "data.quality.issue.hotel_no_arabic" },
  { key: "hotel_no_stars", table: "hotels", route: "/hotels", group: "hotels", labelKey: "data.quality.issue.hotel_no_stars" },
  { key: "hotel_no_contact", table: "hotels", route: "/hotels", group: "hotels", labelKey: "data.quality.issue.hotel_no_contact" },
  { key: "hotel_no_city", table: "hotels", route: "/hotels", group: "hotels", labelKey: "data.quality.issue.hotel_no_city" },
  { key: "hotel_duplicate", table: "hotels", route: "/hotels", group: "hotels", labelKey: "data.quality.issue.hotel_duplicate" },
  { key: "hotel_unverified", table: "hotels", route: "/hotels", group: "hotels", labelKey: "data.quality.issue.hotel_unverified" },
  { key: "city_no_default_hotel", table: "cities", route: "/cities", group: "cities", labelKey: "data.quality.issue.city_no_default_hotel" },
  { key: "city_no_coords", table: "cities", route: "/cities", group: "cities", labelKey: "data.quality.issue.city_no_coords" },
  { key: "city_no_sort", table: "cities", route: "/cities", group: "cities", labelKey: "data.quality.issue.city_no_sort" },
  { key: "city_is_state", table: "cities", route: "/cities", group: "cities", labelKey: "data.quality.issue.city_is_state" },
  { key: "room_not_room", table: "room_types", route: "/rooms-types", group: "catalog", labelKey: "data.quality.issue.room_not_room" },
  { key: "airport_bad_iata", table: "airports", route: "/airports", group: "catalog", labelKey: "data.quality.issue.airport_bad_iata" },
  { key: "transfer_not_from_airport", table: "transfers", route: "/cars/transfers", group: "transport", labelKey: "data.quality.issue.transfer_not_from_airport" },
  { key: "tour_duplicate", table: "tours", route: "/cars/tours", group: "transport", labelKey: "data.quality.issue.tour_duplicate" },
] as const satisfies readonly QualityIssue[];

export type IssueKey = (typeof QUALITY_ISSUES)[number]["key"];

/** The set-returning function (0071) that lists a table's rows with an issue. */
export const ROWS_FUNCTION: Partial<Record<AllowedTable, string>> = {
  hotels: "data_quality_hotels",
  cities: "data_quality_cities",
  room_types: "data_quality_room_types",
  airports: "data_quality_airports",
  transfers: "data_quality_transfers",
  tours: "data_quality_tours",
};

export function qualityIssue(key: string | null | undefined): (typeof QUALITY_ISSUES)[number] | null {
  return QUALITY_ISSUES.find((issue) => issue.key === key) ?? null;
}

/** The function to list `table` through for `issue` — null when the pair does not belong together. */
export function issueRowsFunction(table: AllowedTable, issue: string): string | null {
  const found = qualityIssue(issue);
  return found && found.table === table ? (ROWS_FUNCTION[table] ?? null) : null;
}

/** The screen that opens on exactly the rows a card counts. */
export function issueHref(issue: (typeof QUALITY_ISSUES)[number]): string {
  return `${issue.route}?issue=${issue.key}`;
}

/** Same range as 0071's `[ء-ي]`: a name a client can read in Arabic has at least one. */
export function hasArabicLetter(value: string | null | undefined): boolean {
  return /[ء-ي]/.test(value ?? "");
}

const blank = (value: string | null | undefined) => !(value ?? "").trim();

// ---------- the issue guard (order 11.1) ----------

export type GuardProblem = "latin_name" | "no_city" | "no_stars" | "no_address" | "no_phone";

export const PROBLEM_LABEL: Record<GuardProblem, TranslationKey> = {
  latin_name: "data.quality.problem.latin_name",
  no_city: "data.quality.problem.no_city",
  no_stars: "data.quality.problem.no_stars",
  no_address: "data.quality.problem.no_address",
  no_phone: "data.quality.problem.no_phone",
};

/** The catalogue fields a client document and a voucher print. */
export type GuardRecord = {
  id: string;
  arabic_name: string | null;
  city_id: string | null;
  stars?: number | null;
  address: string | null;
  contact_number: string | null;
};

export type GuardIssue = { hotelId: string; name: string; problem: GuardProblem; blocking: boolean };

/**
 * What stands between a draft's catalogue hotels and an offer.
 *
 * Blocking: the name the client reads has no Arabic letter (the LINE's name is
 * what prints — a record fixed after the hotel was picked still needs picking
 * again), or the record has no city. Warning: no address or no phone, which the
 * voucher needs. Lines without a catalogue hotel (typed by hand, or a supplier's
 * rate) are not the catalogue's to fix and are left alone.
 */
export function guardHotels(
  lines: readonly { hotel_id: string | null; hotel_name: string | null }[],
  records: readonly GuardRecord[],
): GuardIssue[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: GuardIssue[] = [];
  for (const line of lines) {
    const record = line.hotel_id ? byId.get(line.hotel_id) : undefined;
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    const name = (line.hotel_name ?? "").trim() || (record.arabic_name ?? "");
    const add = (problem: GuardProblem, blocking: boolean) => out.push({ hotelId: record.id, name, problem, blocking });
    // nothing about a hotel's record stops an issue (the owner, 2026-10-18: «جعلنا بالإجبار نغيّر
    // الفندق، وهذا الإجراء مرفوض») — a Latin name prints as it is, and the address and phone
    // come with the hotel's confirmation in operations. Warnings only.
    if (!hasArabicLetter(name)) add("latin_name", false);
    if (!record.city_id) add("no_city", false);
    if (blank(record.address)) add("no_address", false);
    if (blank(record.contact_number)) add("no_phone", false);
  }
  return out;
}

/** What a hotel still lacks before it can be marked «معتمد» (order 11.5). */
export function verifyBlockers(record: GuardRecord): GuardProblem[] {
  const out: GuardProblem[] = [];
  if (!hasArabicLetter(record.arabic_name)) out.push("latin_name");
  if (!record.city_id) out.push("no_city");
  if (!record.stars || record.stars < 1) out.push("no_stars");
  if (blank(record.address)) out.push("no_address");
  if (blank(record.contact_number)) out.push("no_phone");
  return out;
}

// ---------- the change log (order 11.3) ----------

const AUDIT_TEXT_MAX = 120;

/**
 * The columns an update actually changed, as [before, after]. A masked column
 * (a cost, a client's personal data) is recorded by name only — audit_logs is
 * read back on screens that must not show it.
 */
export function diffRecord(
  before: Record<string, DataValue | undefined>,
  after: Record<string, DataValue>,
  masked: (column: string) => boolean = () => false,
): Record<string, [DataValue, DataValue]> {
  const out: Record<string, [DataValue, DataValue]> = {};
  const clip = (value: DataValue | undefined): DataValue =>
    value === undefined ? null : typeof value === "string" && value.length > AUDIT_TEXT_MAX ? `${value.slice(0, AUDIT_TEXT_MAX)}…` : value;
  for (const [column, next] of Object.entries(after)) {
    const was = before[column] ?? null;
    // "4" from a text box against 4 in the row is the same value
    if (String(was ?? "") === String(next ?? "")) continue;
    out[column] = masked(column) ? ["•", "•"] : [clip(was), clip(next)];
  }
  return out;
}

// ---------- the weekly summary (order 11.4) ----------

export type IssueCounts = Record<string, number>;

/** One line per issue: «• label: 279 (−12)». A first week has nothing to compare with. */
export function weeklyLines(now: IssueCounts, prev: IssueCounts | null, label: (key: TranslationKey) => string): string[] {
  return QUALITY_ISSUES.filter((issue) => now[issue.key] !== undefined).map((issue) => {
    const n = now[issue.key];
    const before = prev?.[issue.key];
    const delta = before === undefined ? "" : n === before ? " (=)" : ` (${n > before ? "+" : "−"}${Math.abs(n - before)})`;
    return `• ${label(issue.labelKey)}: ${n}${delta}`;
  });
}
