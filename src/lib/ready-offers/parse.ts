/**
 * Google-Sheet → ReadyOffer parser.
 *
 * The source is a marketing spreadsheet, not a data feed: cells mix Eastern and
 * Western digits, embed newlines and stray quotes, write durations in either
 * order, and the `#` column repeats. Everything here is defensive and pure —
 * no I/O, no clock (the year is passed in) — so the whole thing is unit-tested
 * against real snapshots of both tabs in `__fixtures__/`.
 */

import type { ParsedCity, ParsedOffer } from "./types";

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
/** «"4,599"» · «4٬444٫00» → 4599 · 4444. Blank (an announced-but-unpriced row) → null. */
export function parsePrice(raw: string): number | null {
  const t = normalizeDigits(clean(raw)).replace(/٫/g, ".").replace(/[,\s٬]/g, "");
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
    .flatMap((line) => stripMarks(line).split(/\s+\+\s+|\s*؛\s*/u))
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

  const parts = text.split(/\s*[+/؛]\s*|\n/u).map(stripMarks).filter(Boolean);
  if (parts.length === cities.length) return parts;
  // «KL 2 + Genting 2 + KL 3» with two hotels: one a city, in the order the cities first come
  const order = [...new Set(cities.map((c) => c.city_name))];
  if (parts.length === order.length) return cities.map((c) => parts[order.indexOf(c.city_name)]);

  return cities.map(() => text);
}

// ---------- the owner's sheet (2026-10-18): a summary tab and a details tab ----------

/** The two tabs, by name — the sync finds them by these, wherever they sit in the sheet. */
export const TABS = { summary: "العروض السياحية", detail: "العروض التفصيلية" } as const;

/** The body of a JS string as Google writes it («\x3d», «\/») → its text; as written when it will not read. */
function jsString(body: string): string {
  try {
    return JSON.parse(`"${body.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1")}"`) as string;
  } catch {
    return body;
  }
}

/** A public sheet's tabs, name → gid, from its /htmlview page («items.push({name: "…", … gid: "…"})»). */
export function tabsFromHtml(html: string): { name: string; gid: string }[] {
  return [...html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)"[^}]*?gid: "(\d+)"/g)].map((m) => ({ name: jsString(m[1]), gid: m[2] }));
}

const SUMMARY = {
  no: "م",
  country: "الدولة",
  route: "المدن / المسار",
  days: "الأيام",
  nights: "الليالي",
  price: "السعر",
  currency: "العملة",
  basis: "أساس التسعير",
  notes: "ملاحظات",
} as const;

const DETAIL = {
  no: "#",
  destination: "الوجهة",
  booking: "إمكانية الحجز والإقامة",
  cities: "المدن / الليالي",
  hotels: "الفنادق الرئيسية",
  days: "الأيام",
  tours: "الجولات",
  domesticFlight: "الطيران الداخلي",
  price: "سعر البيع النهائي",
  includes: "يشمل",
  excludes: "لا يشمل",
  files: "الملفات",
} as const;

/** Arabic as people type it — hamza, ى/ي, ة/ه, diacritics, tatweel, case and spacing aside. */
export function fold(value: string): string {
  return clean(value)
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function columns<K extends string>(header: string[], names: Record<K, string>): Record<K, number> {
  const folded = header.map(fold);
  return Object.fromEntries(Object.entries<string>(names).map(([k, name]) => [k, folded.indexOf(fold(name))])) as Record<K, number>;
}

/** «ريال سعودي» · «5,285.40 يورو …» · «1,463 دولار …» → its currency; `fallback` when the text names none. */
export function currencyOf(raw: string, fallback = "SAR"): string {
  const t = fold(raw);
  if (/يورو|eur|€/.test(t)) return "EUR";
  if (/دولار|usd|\$/.test(t)) return "USD";
  if (/ريال|sar|ر\.س/.test(t)) return "SAR";
  return fallback;
}

/** «سعر إجمالي لشخصين بالغين» → 2 adults; «لشخصين وطفلين» → 2 + 2; «للفرد» → 1. Null when it does not say. */
export function parseParty(raw: string): { adults: number | null; children: number | null } {
  const t = fold(raw);
  const adults = /للفرد|لشخص واحد/.test(t) ? 1 : /شخصين|شخصان|بالغين/.test(t) ? 2 : null;
  const children = /طفلين/.test(t) ? 2 : /طفل/.test(t) ? 1 : adults != null ? 0 : null;
  return { adults, children };
}

const NIGHTS = "(?:ليال[ٍي]?|ليلة)";

/**
 * «هانوي 2 + سابا 3 + هانوي 2 = 7 ليالٍ» · «إسطنبول 6 ليالٍ» · «دبي – 4 ليالٍ» → each
 * city's nights, and the total the cell states. Cities null when any lacks its
 * nights («تيرانا + بريزرن + تيرانا = 7 ليالٍ», «جزيرة ياس – عدد الليالي غير محدد»).
 */
export function parseCityNights(raw: string): { cities: ParsedCity[] | null; total: number | null } {
  const bare = normalizeDigits(clean(raw)).replace(/\([^)]*\)/g, " ").trim();
  const stated = bare.match(/=\s*(\d+)/u);
  const text = bare
    .replace(new RegExp(`\\s*=\\s*\\d+\\s*${NIGHTS}?\\s*$`, "u"), "")
    .replace(new RegExp(`(\\d+)\\s*${NIGHTS}`, "gu"), "$1")
    .trim();
  const single = text.includes("+") ? null : text.match(/^(.+?)\s*[–—-]\s*(\d+)$/u);
  const cities = single ? [{ city_name: clean(single[1]), nights: Number(single[2]) }] : parseCities(text);
  const total = stated ? Number(stated[1]) : cities ? cities.reduce((s, c) => s + c.nights, 0) : null;
  return { cities, total };
}

const toCount = (raw: string): number | null => {
  const n = Number.parseInt(normalizeDigits(clean(raw)), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** «22,999 ريال» — a price the way the sheet's reader says it. */
const said = (price: number, currency: string): string => `${price.toLocaleString("en-US")} ${currency === "SAR" ? "ريال" : currency}`;

/** djb2 → base36. Deterministic, short, and stable across row reordering. */
function fingerprint(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, "0");
}

export type ParseWorkbookResult = {
  offers: ParsedOffer[];
  errors: { row: number; tab: string; reason: string }[];
};

type DetailRow = { row: number; no: string; destination: string; cells: string[]; extra: string[]; used: boolean };

/**
 * The owner's sheet: «العروض السياحية» (one line an offer: its days, nights,
 * price, who the price is for, whether it is published) and «العروض التفصيلية»
 * (its cities and nights, hotels, tours, domestic flight, inclusions, design).
 * A summary row is joined to its details by its number, else (the rows with
 * none) by its country. Where the two disagree nothing is guessed: the offer
 * is imported with the reasons (`problems`) and starts no file until the sheet
 * is corrected — the next sync clears them on its own.
 */
export function parseWorkbook(summaryCsv: string, detailCsv: string, year: number): ParseWorkbookResult {
  const errors: ParseWorkbookResult["errors"] = [];
  const sRows = parseCsv(summaryCsv);
  if (!sRows.length) return { offers: [], errors: [{ row: 0, tab: TABS.summary, reason: "empty sheet" }] };
  const sc = columns(sRows[0], SUMMARY);
  if (sc.country < 0) return { offers: [], errors: [{ row: 1, tab: TABS.summary, reason: `missing ${SUMMARY.country} column` }] };
  const dRows = parseCsv(detailCsv);
  const dc = columns(dRows[0] ?? [], DETAIL);
  if (dRows.length && dc.destination < 0) errors.push({ row: 1, tab: TABS.detail, reason: `missing ${DETAIL.destination} column` });

  // each detail row, with any line under it that carries no number or destination of its own
  const details: DetailRow[] = [];
  for (let r = 1; dc.destination >= 0 && r < dRows.length; r += 1) {
    const cells = dRows[r];
    const no = normalizeDigits(dc.no >= 0 ? clean(cells[dc.no]) : "");
    const destination = clean(cells[dc.destination]);
    if (!no && !destination) {
      const rest = cells.map(clean).filter(Boolean).join(" · ");
      if (rest && details.length) details[details.length - 1].extra.push(rest);
      continue;
    }
    details.push({ row: r + 1, no, destination, cells, extra: [], used: false });
  }
  const cell = (d: DetailRow | undefined, k: keyof typeof DETAIL): string => (d && dc[k] >= 0 ? clean(d.cells[dc[k]]) : "");

  const summaries = sRows
    .slice(1)
    .map((cells, i) => ({ row: i + 2, cells, at: (k: keyof typeof SUMMARY) => (sc[k] >= 0 ? clean(cells[sc[k]]) : "") }))
    .filter((s) => s.at("country"));
  // by number first, then the rows without one by their country among the details left
  const link = new Map<number, DetailRow>();
  for (const s of summaries) {
    const no = normalizeDigits(s.at("no"));
    const d = no ? details.find((x) => !x.used && x.no === no) : undefined;
    if (d) {
      d.used = true;
      link.set(s.row, d);
    }
  }
  for (const s of summaries) {
    if (link.has(s.row)) continue;
    const head = fold(s.at("country")).split(" ")[0];
    const d = details.find((x) => !x.used && fold(x.destination).includes(head));
    if (d) {
      d.used = true;
      link.set(s.row, d);
    }
  }
  for (const d of details) if (!d.used) errors.push({ row: d.row, tab: TABS.detail, reason: `«${d.destination}» بلا صف في «${TABS.summary}»` });

  const offers: ParsedOffer[] = [];
  const seen = new Set<string>();
  for (const s of summaries) {
    const d = link.get(s.row);
    const country = s.at("country");
    const route = s.at("route");
    const basis = s.at("basis");
    const notes = s.at("notes");
    const duration = parseDuration(cell(d, "days"));
    const days = toCount(s.at("days")) ?? duration.days;
    const nights = toCount(s.at("nights")) ?? duration.nights;
    const price = parsePrice(s.at("price"));
    const currency = currencyOf(s.at("currency"));
    const citiesRaw = cell(d, "cities");
    const { cities: split, total } = parseCityNights(citiesRaw);
    const validityRaw = cell(d, "booking");
    const window = parseValidity(validityRaw, year);

    const problems: string[] = [];
    const warnings: string[] = [];
    if (!d) warnings.push(`لا صف له في «${TABS.detail}» — تُعرض بيانات الملخّص وحدها`);
    else {
      const head = fold(country).split(" ")[0];
      if (!fold(d.destination).includes(head)) problems.push(`الدولة في الملخّص «${country}» وفي التفصيلي «${d.destination}»`);
      // the places, when the detail names them after its country («تايلند – فوكيت»): most of the summary's must be there
      if (route && /[–—-]/u.test(d.destination)) {
        const hay = fold([d.destination, citiesRaw, cell(d, "hotels")].join(" "));
        const places = route.split(/\s*[–—-]\s*/u).map(fold).filter(Boolean);
        const found = places.filter((p) => p.split(" ").some((w) => w.length >= 3 && hay.includes(w))).length;
        if (found * 2 < places.length) problems.push(`المسار في الملخّص «${route}» وفي التفصيلي «${d.destination}»`);
      }
      const detailPrice = cell(d, "price");
      if (detailPrice && price != null) {
        const dp = parsePrice(detailPrice);
        const perPerson = (t: string) => fold(t).includes("للفرد");
        if (dp == null || currencyOf(detailPrice, currency) !== currency || Math.abs(dp - price) >= 0.01 || perPerson(detailPrice) !== perPerson(basis)) {
          problems.push(`السعر في الملخّص ${said(price, currency)} وفي التفصيلي «${detailPrice}»`);
        }
      }
      const sum = split?.reduce((n, c) => n + c.nights, 0) ?? null;
      if (nights != null && total != null && total !== nights) problems.push(`الليالي في الملخّص ${nights} وفي التفصيلي ${total}`);
      else if (nights != null && sum != null && sum !== nights) problems.push(`الليالي في الملخّص ${nights} ومجموع ليالي المدن في التفصيلي ${sum}`);
      else if (nights != null && !split) problems.push(`الليالي في الملخّص ${nights}، وفي التفصيلي لا تُحدَّد ليالي كل مدينة: «${citiesRaw || "—"}»`);
      if (d.extra.length) warnings.push(`سطر بلا رقم تحت هذا العرض لم يُقرأ: «${d.extra.join(" ")}»`);
    }
    if (!price) warnings.push("بلا سعر — تظهر كـ«قيد الإعداد»");
    // the nights the file is seeded with are only ever ones the two tabs agree on
    const cities = split && !problems.some((p) => p.startsWith("الليالي")) ? split : null;

    let code = `ro-${fingerprint([fold(country), fold(route), nights ?? ""].join("|"))}`;
    if (seen.has(code)) {
      let n = 2;
      while (seen.has(`${code}-${n}`)) n += 1;
      code = `${code}-${n}`;
    }
    seen.add(code);

    const source_row: Record<string, string> = {};
    sRows[0].forEach((h, i) => {
      if (clean(h)) source_row[clean(h)] = clean(s.cells[i]);
    });
    if (d) {
      (dRows[0] ?? []).forEach((h, i) => {
        if (clean(h)) source_row[`${TABS.detail}: ${clean(h)}`] = clean(d.cells[i]);
      });
    }

    offers.push({
      code,
      tier: null,
      title: d && /[–—-]/u.test(d.destination) ? d.destination : route ? `${country} — ${route}` : country,
      country,
      variant: null,
      cities_summary: citiesRaw || route,
      main_hotels: cell(d, "hotels"),
      tours_text: cell(d, "tours"),
      domestic_flight: cell(d, "domesticFlight"),
      days,
      nights,
      price,
      currency,
      includes: parseList(cell(d, "includes")),
      excludes: parseList(cell(d, "excludes")),
      includes_text: cell(d, "includes"),
      excludes_text: cell(d, "excludes"),
      validity_raw: validityRaw,
      valid_from: window?.from ?? null,
      valid_to: window?.to ?? null,
      design_url: cell(d, "files") || null,
      status: price ? "ready" : "coming_soon",
      cities,
      hotels_by_city: cities ? matchHotelsToCities(cell(d, "hotels"), cities) : [],
      warnings,
      problems,
      published: !fold(notes).includes("لم يتم النشر"),
      price_basis: basis,
      ...parseParty(basis),
      notes,
      source_row,
    });
  }
  return { offers, errors };
}
