/**
 * Keep word boundaries: removing spaces turns «التفاصيل والبرنامج» into a
 * false «يلوا». Permit common Arabic prepositions attached to a place.
 */
const normalize = (s: string) => s.normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[\u064b-\u065f\u0670ـ]/g, "").toLowerCase();
export function mentionsPlace(text: string, name: string): boolean {
  const parts = normalize(name).trim().split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.join("")) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:[وبلفك]|لل)?${parts.join("\\s*")}(?=$|[^\\p{L}\\p{N}])`, "u").test(normalize(text));
}
