/**
 * Name folding for the reference catalogue — cities, hotels, room types.
 *
 * One file, imported by the app AND by the maintenance scripts (Node strips
 * the types), so «is this the same city?» has exactly one answer. It must also
 * agree with `public.catalog_norm` in the database, which backs the unique
 * indexes: same letters folded, same marks dropped, same spaces collapsed.
 *
 * Pure, no imports.
 */

/** Alef forms → ا, ta marbuta → ه, alef maqsura → ي, diacritics and tatweel dropped. */
export function normAr(value: string | null | undefined): string {
  return (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

/**
 * Latin letters and digits only, lower-cased. Empty when the field holds no
 * Latin LETTER — «4 غرف وصالتين» typed into the English box would otherwise
 * fold to «4» and match every other Arabic name with a 4 in it.
 */
export function normEn(value: string | null | undefined): string {
  const folded = (value ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return /[a-z]/.test(folded) ? folded : "";
}

/**
 * The consonant skeleton of a folded name: long vowels, hamza seats and Latin
 * vowels dropped, spaces and punctuation removed, doubled letters collapsed —
 * «ملينيوم» and «ميلينيوم» are both «ملنم». Mirrors `public.catalog_skel` (0070);
 * the search box falls back to it when the folded name finds nothing.
 */
export function catalogSkel(value: string | null | undefined): string {
  return normAr(value)
    .replace(/[اويءئؤaeiouy]/g, "")
    .replace(/[ _.,'"()&/*+:;!?#@،-]/g, "")
    .replace(/(.)\1+/gu, "$1");
}

/** Edit distance, two-row. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * 0…1, how alike two already-folded names are, ignoring spaces and
 * punctuation — «كوالالامبور» against «كوالالمبور» is 0.9.
 */
export function similarity(a: string, b: string): number {
  const x = a.replace(/[^\p{L}\p{N}]/gu, "");
  const y = b.replace(/[^\p{L}\p{N}]/gu, "");
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const HOTEL_WORDS_AR = ["فندق", "منتجع", "شقق", "شقه", "فلل", "فيلا", "فيلات", "اجنحه", "سويت", "ريزورت", "هوتيل", "ريزيدنس"];
const HOTEL_WORDS_EN = ["hotel", "resort", "apartment", "apartments", "residence", "residences", "suites", "villa", "villas", "inn", "klcc"];

/**
 * A name shaped like a hotel rather than a place: «شقق أونا الفندقية»,
 * «The Colony & Luxe Klcc». Evidence for a human, never grounds on its own.
 */
export function looksLikeHotel(value: string | null | undefined): boolean {
  const ar = normAr(value);
  const en = normEn(value);
  if (/^ذا\s/.test(ar) || /^the\s/.test(en)) return true;
  const words = new Set([...ar.split(" "), ...en.split(" ")]);
  return HOTEL_WORDS_AR.some((w) => words.has(w) || ar.includes(`${w} `) || ar.startsWith(w)) ||
    HOTEL_WORDS_EN.some((w) => words.has(w));
}

/**
 * The existing name a newly typed one most likely means, if any.
 *
 * Exact after folding wins outright; otherwise the closest name at or above
 * `min`. Used to ask «هل تقصد …؟» before a near-copy is created.
 */
export function closestName<T>(
  typed: string,
  rows: T[],
  name: (row: T) => string,
  min = 0.8,
): { row: T; exact: boolean } | null {
  const target = normAr(typed);
  if (!target) return null;
  let best: { row: T; score: number } | null = null;
  for (const row of rows) {
    const candidate = normAr(name(row));
    if (!candidate) continue;
    if (candidate === target) return { row, exact: true };
    const score = similarity(candidate, target);
    if (score >= min && (!best || score > best.score)) best = { row, score };
  }
  return best ? { row: best.row, exact: false } : null;
}
