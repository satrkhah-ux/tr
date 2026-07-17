/**
 * Arabic-aware numeral, money and date parsing for supplier-PDF extraction.
 * Pure module (no I/O). Handles Arabic-Indic (٠-٩) + Eastern-Arabic (۰-۹) +
 * Latin digits, common currency tokens, and DD/MM vs MM/DD ambiguity.
 *
 * Everything returns a confidence so the caller never has to guess whether a
 * value was read cleanly — low confidence flows straight into the review gate.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC = "۰۱۲۳۴۵۶۷۸۹";

/** Convert Arabic-Indic / Eastern-Arabic digits to Latin 0-9 and repair common
 *  PDF text-layer artifacts (lam-alef ToUnicode swaps). */
export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const ea = EASTERN_ARABIC.indexOf(ch);
    if (ea >= 0) { out += String(ea); continue; }
    out += ch;
  }
  return (
    out
      // Arabic thousands (٬) and decimal (٫) separators.
      .replace(/٬/g, ",")
      .replace(/٫/g, ".")
      // PDF lam-alef ligature ToUnicode swap: many fonts map the لا/لأ/لإ/لآ
      // ligature glyph back as "ا+ل" REVERSED, yielding trigrams that are
      // orthographically impossible in Arabic (اال/األ/اإل/اآل) — e.g.
      // "الإجمالي" extracts as "اإلجمالي". Swapping them back is safe exactly
      // because the source trigrams never occur in real words.
      .replace(/اال/g, "الا")
      .replace(/األ/g, "الأ")
      .replace(/اإل/g, "الإ")
      .replace(/اآل/g, "الآ")
      // Same swap on the STANDALONE word "لا" (e.g. the "لا يشمل" header →
      // "ال يشمل"). A free-standing "ال" is equally impossible — the definite
      // article never stands alone — so restoring it to "لا" is safe.
      .replace(/(^|\s)ال(?=\s|$)/g, "$1لا")
  );
}

/** First integer in a string (digits normalized first). null if none. */
export function parseInteger(input: string): number | null {
  const m = normalizeDigits(input).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * pdf.js emits LTR digit runs inside RTL lines in VISUAL (reversed) order:
 * "7,500" extracts as "005,7". Detectable deterministically — the reversed form
 * has a leading zero or an invalid thousands grouping while its reverse is
 * well-formed. Only integer tokens are repaired (decimals like "0.5" are legit).
 */
function repairReversedNumeric(token: string): string {
  if (token.includes(".") || token.startsWith("-")) return token;
  const validGrouping = (s: string) => (s.includes(",") ? /^\d{1,3}(?:,\d{3})+$/.test(s) : !/^0\d/.test(s));
  if (validGrouping(token)) return token;
  const reversed = [...token].reverse().join("");
  return validGrouping(reversed) ? reversed : token;
}

/** First number (int or decimal, tolerating thousands separators). null if none. */
export function parseNumber(input: string): number | null {
  const norm = normalizeDigits(input);
  const m = norm.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(repairReversedNumeric(m[0]).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const CURRENCY_TOKENS: { code: string; patterns: RegExp[] }[] = [
  { code: "SAR", patterns: [/ر\.?\s?س/i, /ريال/i, /\bSAR\b/i, /\bSR\b/i] },
  { code: "USD", patterns: [/\$/, /دولار/i, /\bUSD\b/i] },
  { code: "EUR", patterns: [/€/, /يورو/i, /\bEUR\b/i] },
  { code: "AED", patterns: [/درهم/i, /\bAED\b/i, /د\.?\s?إ/i] },
  { code: "TRY", patterns: [/ليرة/i, /\bTRY\b/i, /₺/] },
  { code: "GBP", patterns: [/£/, /جنيه/i, /\bGBP\b/i] },
];

/** Detect a currency code from surrounding text. */
export function detectCurrency(input: string): string | null {
  for (const { code, patterns } of CURRENCY_TOKENS) {
    if (patterns.some((p) => p.test(input))) return code;
  }
  return null;
}

export type Money = { amount: number; currency: string | null; confidence: number };

/** Parse a money value + its currency from a line. confidence reflects both. */
export function parseMoney(input: string, defaultCurrency = "SAR"): Money | null {
  const amount = parseNumber(input);
  if (amount == null) return null;
  const currency = detectCurrency(input);
  // amount clean; currency explicit → high, inferred default → medium.
  const confidence = currency ? 0.9 : 0.6;
  return { amount, currency: currency ?? defaultCurrency, confidence };
}

const ARABIC_MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6,
  يوليو: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // real-calendar check (rejects e.g. Feb 30): Date.UTC must round-trip exactly.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type ParsedDate = { iso: string; confidence: number };

/**
 * Parse a date to ISO (YYYY-MM-DD) with a confidence.
 *  - "15 مارس 2026" / "15 Mar 2026" → high (unambiguous month name).
 *  - "2026-03-15" / "2026/3/15"      → high (ISO order).
 *  - "15/03/2026"                    → DD/MM assumed (Arabic convention); if the
 *    first component ≤ 12 it's ambiguous → lower confidence.
 */
export function parseDate(input: string, retryReversed = true): ParsedDate | null {
  const s = normalizeDigits(input).trim();

  // ISO-ish: YYYY-MM-DD or YYYY/MM/DD (digit boundaries — never match inside a longer run)
  const isoM = s.match(/(?<!\d)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/);
  if (isoM) {
    const r = iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));
    if (r) return { iso: r, confidence: 0.95 };
  }

  // Month-name form: "15 مارس 2026" or "March 15, 2026"
  const lower = s.toLowerCase();
  for (const [name, m] of [...Object.entries(ARABIC_MONTHS), ...Object.entries(EN_MONTHS)]) {
    if (!lower.includes(name)) continue;
    const nums = (s.match(/\d{1,4}/g) ?? []).map(Number);
    const day = nums.find((n) => n >= 1 && n <= 31);
    const year = nums.find((n) => n >= 1900 && n <= 2100);
    if (day && year) {
      const r = iso(year, m, day);
      if (r) return { iso: r, confidence: 0.9 };
    }
  }

  // Numeric DD/MM/YYYY (or MM/DD/YYYY). Assume DD/MM (Arabic convention).
  const dmy = s.match(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/);
  if (dmy) {
    let d = Number(dmy[1]);
    let m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    // If day-slot ≤ 12 AND month-slot ≤ 12 the order is genuinely ambiguous.
    const ambiguous = d <= 12 && m <= 12;
    // If the "day" is > 12 it can't be a month → order is certain (DD/MM).
    if (d > 12 && m <= 12) {
      // definitely DD/MM
    } else if (m > 12 && d <= 12) {
      // it was MM/DD → swap
      [d, m] = [m, d];
    }
    const r = iso(y, m, d);
    if (r) return { iso: r, confidence: ambiguous ? 0.5 : 0.85 };
  }

  // pdf.js can emit the whole LTR date run reversed inside an RTL line
  // ("10/03/2026" → "6202/30/01"): retry once on the char-reversed string,
  // capped confidence — it is a repaired read.
  if (retryReversed) {
    const parsed = parseDate([...s].reverse().join(""), false);
    if (parsed) return { iso: parsed.iso, confidence: Math.min(parsed.confidence, 0.75) };
  }

  return null;
}

/** Extract a nights count from text like "3 ليالٍ" / "3 nights" / "٣ ليالي". */
export function parseNights(input: string): number | null {
  const norm = normalizeDigits(input);
  const m = norm.match(/(\d+)\s*(?:ليال|ليلة|ليالي|nights?|nts?)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}
