/**
 * What a hotel row must hold to be usable on a client document, and which
 * existing rows a newly typed hotel probably is. Pure — the /hotels form checks
 * as the agent types, and the server action checks again before it writes.
 */
import { normAr, normEn, similarity } from "./norm";

const ARABIC_LETTER = /[ء-ي]/;

export function hasArabicLetter(value: string | null | undefined): boolean {
  return ARABIC_LETTER.test(value ?? "");
}

export type HotelRuleError =
  | "data.tools.err.arabicRequired"
  | "data.tools.err.arabicLetters"
  | "data.tools.err.cityRequired"
  | "data.tools.err.stars";

/**
 * The first rule the values break, or null. A create carries every field; an
 * update is checked on the fields it carries, so a bulk import that changes a
 * phone number is not refused over a legacy Latin name it did not touch.
 */
export function hotelRuleError(values: Record<string, unknown>, creating: boolean): HotelRuleError | null {
  if (creating || "arabic_name" in values) {
    const name = String(values.arabic_name ?? "").trim();
    if (!name) return "data.tools.err.arabicRequired";
    if (!hasArabicLetter(name)) return "data.tools.err.arabicLetters";
  }
  if ((creating || "city_id" in values) && !values.city_id) return "data.tools.err.cityRequired";
  const stars = values.stars;
  if (stars !== undefined && stars !== null && stars !== "") {
    const n = Number(stars);
    if (!Number.isInteger(n) || n < 1 || n > 5) return "data.tools.err.stars";
  }
  return null;
}

export type HotelLite = { id: string; arabic_name: string; english_name: string | null; city_id: string | null };
export type SimilarHotel = HotelLite & { exact: boolean; sameCity: boolean };

const NEAR = 0.85;

/** How alike, 0…1, skipping the edit distance when the lengths alone rule it out. */
function near(a: string, b: string): number {
  if (!a || !b) return 0;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * (1 - NEAR)) return 0;
  return similarity(a, b);
}

/**
 * «يوجد فندق مشابه»: rows whose folded Arabic or English name equals the typed
 * one, or is within one or two letters of it — in this city first, then
 * elsewhere. A warning for a person, never a refusal.
 */
export function similarHotels(
  input: { arabic: string; english: string; cityId: string | null; excludeId?: string | null },
  rows: HotelLite[],
  limit = 5,
): SimilarHotel[] {
  const ar = normAr(input.arabic);
  const en = normEn(input.english);
  if (ar.length < 3 && en.length < 4) return [];
  const hits: { hit: SimilarHotel; score: number }[] = [];
  for (const row of rows) {
    if (row.id === input.excludeId) continue;
    const rowAr = normAr(row.arabic_name);
    // 279 legacy rows carry a Latin name in the Arabic field: compare it as English too
    const rowEns = [normEn(row.english_name), normEn(row.arabic_name)].filter(Boolean);
    const exact = (ar.length >= 3 && rowAr === ar) || (en !== "" && rowEns.includes(en));
    const score = exact ? 1 : Math.max(ar.length >= 3 ? near(rowAr, ar) : 0, ...rowEns.map((e) => (en ? near(e, en) : 0)));
    if (score < NEAR) continue;
    hits.push({ hit: { ...row, exact, sameCity: Boolean(input.cityId) && row.city_id === input.cityId }, score });
  }
  hits.sort(
    (a, b) => Number(b.hit.exact) - Number(a.hit.exact) || Number(b.hit.sameCity) - Number(a.hit.sameCity) || b.score - a.score,
  );
  return hits.slice(0, limit).map((h) => h.hit);
}
