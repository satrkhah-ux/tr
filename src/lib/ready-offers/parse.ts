/**
 * Google-Sheet → ReadyOffer parser.
 *
 * The source is a marketing spreadsheet, not a data feed: cells mix Eastern and
 * Western digits, embed newlines and stray quotes, write durations in either
 * order, and the `#` column repeats. Everything here is defensive and pure —
 * no I/O, no clock (the year is passed in) — so the whole thing is unit-tested
 * against real snapshots of both tabs in `__fixtures__/`.
 */

import type { ParsedCity, ParsedOffer, Tier } from "./types";

// ---------- CSV ----------
/**
 * Minimal RFC4180 reader. Required rather than `split(",")`: cells legitimately
 * contain commas ("4,599"), newlines (the multi-line يشمل lists) and quotes.
 * Tolerates the unbalanced quotes the sheet actually has.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- text helpers ----------
const EASTERN = "٠١٢٣٤٥٦٧٨٩";

/** ٠١٢٣ → 0123. The sheet mixes both scripts, sometimes within one cell. */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String(EASTERN.indexOf(d)));
}

const clean = (v: string | undefined): string => (v ?? "").replace(/ /g, " ").trim();

/** Strip the decorative marks marketing sprinkles through the list cells. */
const stripMarks = (v: string): string =>
  v.replace(/[✔✅✖❌☑️•]/gu, " ").replace(/^["'\s\-–—]+|["'\s\-–—]+$/g, "").replace(/\s{2,}/g, " ").trim();

// ---------- duration ----------
/** «7 ليالي 8 أيام» · «10 أيام / 9 ليالي» · «١١ يوم ١٠ ليالي» — either order. */
export function parseDuration(raw: string): { days: number | null; nights: number | null } {
  const t = normalizeDigits(clean(raw));
  if (!t) return { days: null, nights: null };
  const nights = t.match(/(\d+)\s*(?:ليالي|ليلة|ليال|ليلا)/u);
  const days = t.match(/(\d+)\s*(?:أيام|ايام|أيّام|يوم|ايّام)/u);
  const n = nights ? Number(nights[1]) : null;
  const d = days ? Number(days[1]) : null;
  if (n !== null && d !== null) return { days: d, nights: n };
  if (n !== null) return { days: n + 1, nights: n };
  if (d !== null) return { days: d, nights: Math.max(d - 1, 0) };
  return { days: null, nights: null };
}

// ---------- price ----------
/** «"4,599"» → 4599. Blank (an announced-but-unpriced row) → null. */
export function parsePrice(raw: string): number | null {
  const t = normalizeDigits(clean(raw)).replace(/[,\s٬]/g, "");
  const m = t.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const value = Number(m[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ---------- validity window ----------
const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7,
  اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, julay: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_RE = new RegExp(
  `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})`,
  "giu",
);

const lastDayOf = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * «مايو - اغسطس» · «ابريل ومايو» · «June-Aug» · «Julay» → a from/to window in
 * `year`. Unrecognised text yields null and the raw string is kept for display.
 */
export function parseValidity(raw: string, year: number): { from: string; to: string } | null {
  const t = clean(raw).toLowerCase();
  if (!t) return null;
  const found = [...t.matchAll(MONTH_RE)].map((m) => MONTHS[m[1].toLowerCase()]).filter((m): m is number => !!m);
  if (!found.length) return null;
  const first = found[0];
  const last = found[found.length - 1];
  return { from: iso(year, first, 1), to: iso(year, last, lastDayOf(year, last)) };
}

// ---------- includes / excludes ----------
/**
 * Premium writes one item per line with ✔/✖; economy writes a single «a + b + c»
 * line. Split on both so the catalog renders uniform chips either way.
 */
export function parseList(raw: string): string[] {
  const text = clean(raw);
  if (!text) return [];
  return text
    .split("\n")
    .flatMap((line) => stripMarks(line).split(/\s+\+\s+/u))
    .map(stripMarks)
    .filter((v) => v.length > 1);
}

// ---------- destination ----------
/** «فيتنام  "الباقة المتوسطة"» → { country: "فيتنام", variant: "الباقة المتوسطة" } */
export function parseDestination(raw: string): { country: string; variant: string | null } {
  const t = clean(raw).replace(/\s{2,}/g, " ");
  const m = t.match(/^(.*?)\s*[«"'(]\s*(.+?)\s*[»"')]\s*$/u);
  if (m && clean(m[1])) return { country: clean(m[1]), variant: clean(m[2]) };
  return { country: t, variant: null };
}

// ---------- cities ----------
const CITY_SPLIT = /\s*[+–—،]\s*|\s+-\s+|\s*-\s+|\s+-\s*/u;

/**
 * «كوالالمبور 7» · «2 هانوي + 3 دانانغ + 2 هانوي» · «1 جاكرتا – 7 بالي – 1 جاكرتا».
 *
 * Returns null when ANY segment lacks a night count — cells like
 * «سيول- بوسان- جيجو- سيول» (no nights) or «طرابزون - زيارة حيدر نبي- ...»
 * (a tour list wearing a cities cell) must not be guessed at, because a wrong
 * split becomes a blocking nights mismatch inside the generator.
 */
export function parseCities(raw: string): ParsedCity[] | null {
  const t = normalizeDigits(clean(raw));
  if (!t) return null;
  const parts = t.split(CITY_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  const out: ParsedCity[] = [];
  for (const part of parts) {
    const lead = part.match(/^(\d+)\s+(.+)$/u);
    const trail = part.match(/^(.+?)\s+(\d+)$/u);
    const name = lead ? lead[2] : trail ? trail[1] : null;
    const nights = lead ? Number(lead[1]) : trail ? Number(trail[2]) : null;
    if (name === null || nights === null || !Number.isFinite(nights) || nights <= 0) return null;
    out.push({ city_name: clean(name), nights });
  }
  return out;
}

/**
 * Align the «الفنادق الرئيسية» cell to the city list.
 *   1. «هانوي: Oriental Suites» lines → matched by city name.
 *   2. an `+` / `/` split that happens to match the city count → in order.
 *   3. otherwise every city carries the full text — never lose information, the
 *      salesperson edits it in the hotels stage anyway.
 */
export function matchHotelsToCities(raw: string, cities: ParsedCity[]): string[] {
  const text = clean(raw);
  if (!cities.length) return [];
  if (!text) return cities.map(() => "");

  const lines = text.split("\n").map(stripMarks).filter(Boolean);
  const labelled = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^([^:：]{2,20})[:：]\s*(.+)$/u);
    if (m) labelled.set(clean(m[1]), clean(m[2]));
  }
  if (labelled.size) {
    const byCity = cities.map((c) => {
      for (const [label, hotels] of labelled) {
        if (label.includes(c.city_name) || c.city_name.includes(label)) return hotels;
      }
      return "";
    });
    if (byCity.some(Boolean)) return byCity.map((v) => v || text);
  }

  const parts = text.split(/\s*[+/]\s*|\n/u).map(stripMarks).filter(Boolean);
  if (parts.length === cities.length) return parts;

  return cities.map(() => text);
}

// ---------- row → offer ----------
const HEADERS = {
  destination: "الوجهة",
  validity: "امكانية الحجز والاقامة",
  cities: "المدن / الليالي",
  hotels: "الفنادق الرئيسية",
  duration: "الأيام",
  tours: "الجولات",
  domesticFlight: "الطيران الداخلي",
  price: "سعر البيع النهائي",
  includes: "يشمل",
  excludes: "لا يشمل",
  files: "الملفات",
} as const;

/** djb2 → base36. Deterministic, short, and stable across row reordering. */
function fingerprint(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, "0");
}

/**
 * The sheet's `#` column repeats (two rows numbered 4, two numbered 5, many
 * blank), so the sync key is a fingerprint of the row's identity instead.
 * The duration is part of it because جنوب افريقيا ships the same destination
 * and the same cities cell at two different lengths.
 */
export function codeFor(tier: Tier, country: string, variant: string | null, citiesRaw: string, durationRaw: string): string {
  const key = [country, variant ?? "", citiesRaw, normalizeDigits(durationRaw)]
    .map((p) => clean(p).replace(/\s+/g, " "))
    .join("|");
  return `${tier === "economy" ? "eco" : "prm"}-${fingerprint(key)}`;
}

function indexHeaders(header: string[]): Record<keyof typeof HEADERS, number> {
  const norm = header.map((h) => clean(h).replace(/\s+/g, " "));
  const find = (needle: string): number => {
    const exact = norm.findIndex((h) => h === needle);
    return exact >= 0 ? exact : norm.findIndex((h) => h.startsWith(needle) || needle.startsWith(h.slice(0, 8)));
  };
  return Object.fromEntries(
    (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map((k) => [k, find(HEADERS[k])]),
  ) as Record<keyof typeof HEADERS, number>;
}

export type ParseSheetResult = {
  offers: ParsedOffer[];
  errors: { row: number; tier: Tier; reason: string }[];
};

/** Parse one tab. `year` is injected so the module stays clock-free (testable). */
export function parseSheet(csv: string, tier: Tier, year: number): ParseSheetResult {
  const rows = parseCsv(csv);
  const errors: ParseSheetResult["errors"] = [];
  if (!rows.length) return { offers: [], errors: [{ row: 0, tier, reason: "empty sheet" }] };

  const idx = indexHeaders(rows[0]);
  if (idx.destination < 0) return { offers: [], errors: [{ row: 1, tier, reason: "missing الوجهة column" }] };

  const offers: ParsedOffer[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const at = (k: keyof typeof HEADERS): string => (idx[k] >= 0 ? clean(row[idx[k]]) : "");
    const destinationRaw = at("destination");

    // skip blanks and the trailing «ملاحظات : ...» footer row
    if (!destinationRaw) continue;
    if (/^ملاحظ/u.test(destinationRaw)) continue;

    const { country, variant } = parseDestination(destinationRaw);
    const citiesRaw = at("cities");
    const durationRaw = at("duration");
    const { days, nights } = parseDuration(durationRaw);
    const price = parsePrice(at("price"));
    const validityRaw = at("validity");
    const window = parseValidity(validityRaw, year);

    let code = codeFor(tier, country, variant, citiesRaw, durationRaw);
    if (seen.has(code)) {
      let n = 2;
      while (seen.has(`${code}-${n}`)) n += 1;
      code = `${code}-${n}`;
    }
    seen.add(code);

    const warnings: string[] = [];
    let cities = parseCities(citiesRaw);
    if (cities && nights !== null && cities.reduce((s, c) => s + c.nights, 0) !== nights) {
      warnings.push("مجموع ليالي المدن لا يطابق ليالي الرحلة — لن تُبذر المدن تلقائياً");
      cities = null;
    }
    if (!cities && citiesRaw) warnings.push("تعذّر استخراج ليالي كل مدينة — يحدّدها الموظف يدوياً");
    if (!price) warnings.push("بلا سعر — تظهر كـ«قيد الإعداد»");
    if (!window && validityRaw) warnings.push(`تعذّر تحليل فترة الصلاحية «${validityRaw}»`);

    const source_row: Record<string, string> = {};
    rows[0].forEach((h, i) => {
      const key = clean(h);
      if (key) source_row[key] = clean(row[i]);
    });

    offers.push({
      code,
      tier,
      title: variant ? `${country} — ${variant}` : citiesRaw ? `${country} — ${citiesRaw}` : country,
      country,
      variant,
      cities_summary: citiesRaw,
      main_hotels: at("hotels"),
      tours_text: at("tours"),
      domestic_flight: at("domesticFlight"),
      days,
      nights,
      price,
      currency: "SAR",
      includes: parseList(at("includes")),
      excludes: parseList(at("excludes")),
      includes_text: at("includes"),
      excludes_text: at("excludes"),
      validity_raw: validityRaw,
      valid_from: window?.from ?? null,
      valid_to: window?.to ?? null,
      design_url: at("files") || null,
      status: price ? "ready" : "coming_soon",
      cities,
      hotels_by_city: cities ? matchHotelsToCities(at("hotels"), cities) : [],
      warnings,
      source_row,
    });
  }

  return { offers, errors };
}
