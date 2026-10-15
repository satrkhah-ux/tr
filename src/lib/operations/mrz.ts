/**
 * The passport's machine-readable zone (ICAO 9303, TD3): the two 44-character
 * lines at the bottom of the photo page.
 *
 * Whoever transcribed the lines — a vision model, an OCR library, a person — can
 * misread a character, and a wrong passport number is a refused boarding. The
 * MRZ carries its own check digits for exactly that, so every field that has one
 * is verified and the ones that fail are NAMED for the employee to compare with
 * the passport. Nothing here is saved; the employee reviews and saves.
 *
 * Pure: no I/O. `today` is injected (it decides the century of a birth year).
 */

export type MrzCheckedField = "number" | "birth_date" | "expiry" | "personal" | "composite";

export type MrzPassport = {
  surname: string;
  given_names: string;
  /** given names then surname — how the name prints on a ticket. */
  full_name: string;
  number: string;
  /** ICAO code: ISO 3166 alpha-3 («SAU»), or a special one («D» for Germany). */
  nationality: string;
  issuing_state: string;
  /** YYYY-MM-DD, null when the digits are not a real date. */
  birth_date: string | null;
  sex: "M" | "F" | null;
  expiry: string | null;
  /** fields whose check digit did not match — empty means every check passed. */
  failed: MrzCheckedField[];
};

export type MrzParse = { ok: true; passport: MrzPassport } | { ok: false; error: "format" };

const LINE = 44;

/** ICAO 7-3-1 check digit: digits as themselves, A–Z as 10–35, «<» as 0. */
export function mrzCheckDigit(value: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 90 ? c - 55 : 0;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function checks(field: string, digit: string): boolean {
  // an empty optional field may carry «<» as its digit
  return (digit === "<" ? 0 : Number(digit)) === mrzCheckDigit(field);
}

/** YYMMDD → YYYY-MM-DD, or null when it is not a calendar date. */
function mrzDate(yymmdd: string, century: (yy: number) => number): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  const year = century(yy);
  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return d.toISOString().slice(0, 10);
}

const words = (s: string) => s.replace(/</g, " ").replace(/\s+/g, " ").trim();

/** Keep only lines that look like MRZ: transcriptions add spaces and drop trailing «<». */
function mrzLines(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[«‹]/g, "<")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ""))
    .filter((l) => l.length >= 9 && /^[A-Z0-9<]+$/.test(l));
}

export function parseTd3(text: string, today: string): MrzParse {
  const lines = mrzLines(text);
  // line 1 is «P», a type letter or «<», the state, then names joined by «<»
  const start = lines.findIndex((l) => l.startsWith("P") && l.includes("<"));
  if (start < 0 || start + 1 >= lines.length) return { ok: false, error: "format" };
  const [l1, l2] = [lines[start], lines[start + 1]].map((l) => l.padEnd(LINE, "<"));
  if (l1.length !== LINE || l2.length !== LINE) return { ok: false, error: "format" };

  const nameField = l1.slice(5);
  const split = nameField.indexOf("<<");
  const surname = words(split < 0 ? nameField : nameField.slice(0, split));
  const given = split < 0 ? "" : words(nameField.slice(split + 2));

  const thisYear = Number(today.slice(2, 4));
  // a birth year can't be in the future; an expiry is always this century
  const birth = mrzDate(l2.slice(13, 19), (yy) => (Number.isNaN(thisYear) || yy <= thisYear ? 2000 : 1900) + yy);
  const expiry = mrzDate(l2.slice(21, 27), (yy) => 2000 + yy);

  const failed: MrzCheckedField[] = [];
  if (!checks(l2.slice(0, 9), l2[9])) failed.push("number");
  if (!checks(l2.slice(13, 19), l2[19])) failed.push("birth_date");
  if (!checks(l2.slice(21, 27), l2[27])) failed.push("expiry");
  if (!checks(l2.slice(28, 42), l2[42])) failed.push("personal");
  if (!checks(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), l2[43])) failed.push("composite");

  const sex = l2[20] === "M" || l2[20] === "F" ? l2[20] : null;
  return {
    ok: true,
    passport: {
      surname,
      given_names: given,
      full_name: [given, surname].filter(Boolean).join(" "),
      number: l2.slice(0, 9).replace(/</g, ""),
      nationality: l2.slice(10, 13).replace(/</g, ""),
      issuing_state: l1.slice(2, 5).replace(/</g, ""),
      birth_date: birth,
      sex,
      expiry,
      failed,
    },
  };
}

/** The traveller-form fields a read can fill. */
export type MrzFormField = "full_name" | "number" | "nationality" | "birth_date" | "expiry";
export type MrzPrefill = Record<MrzFormField, string>;

/**
 * What a read may PUT in the form — never an invented value (owner order 10).
 *
 * A field that was not read, or failed its own check digit, stays empty and is
 * named in `missing` («أكمل يدوياً»). A birth date of today or later, or 1 January
 * of this very year, is a reader's filler rather than a birthday — it stays
 * empty too. The employee types what is missing from the passport itself.
 */
export function trustedFields(p: MrzPassport, today: string): { values: MrzPrefill; missing: MrzFormField[] } {
  const failed = (f: MrzCheckedField) => p.failed.includes(f);
  const filler = (d: string) => d >= today || d === `${today.slice(0, 4)}-01-01`;
  const values: MrzPrefill = {
    full_name: p.full_name.trim(),
    number: failed("number") ? "" : p.number,
    nationality: /^[A-Z]{1,3}$/.test(p.nationality) ? p.nationality : "",
    birth_date: p.birth_date && !failed("birth_date") && !filler(p.birth_date) ? p.birth_date : "",
    expiry: p.expiry && !failed("expiry") ? p.expiry : "",
  };
  return { values, missing: (Object.keys(values) as MrzFormField[]).filter((k) => !values[k]) };
}
