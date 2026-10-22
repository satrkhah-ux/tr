/**
 * Keep word boundaries: removing spaces turns «التفاصيل والبرنامج» into a
 * false «يلوا». Permit common Arabic prepositions attached to a place.
 */
const normalize = (s: string) => s.normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[\u064b-\u065f\u0670ـ]/g, "").toLowerCase();
export function placeMention(text: string, name: string): { index: number; length: number; directed: boolean } | null {
  const parts = normalize(name).trim().split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.join("")) return null;
  const full = parts.join("\\s*");
  const contracted = full.startsWith("ال") ? `|لل${full.slice(2)}` : "";
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])((?:[وبلفك]|لل)?${full}${contracted})(?=$|[^\\p{L}\\p{N}])`, "u").exec(normalize(text));
  if (!match) return null;
  return { index: match.index + match[1].length, length: match[2].length, directed: match[2].startsWith("ل") && !normalize(name).startsWith("ل") };
}

export function mentionsPlace(text: string, name: string): boolean {
  return placeMention(text, name) !== null;
}
