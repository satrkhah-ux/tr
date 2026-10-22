/**
 * A tour as the picker shows it (the owner, 2026-10-22: «دون فقط المميزات» —
 * read «دون فقد المميزات»: simpler, nothing lost). Many tours are a whole
 * itinerary in their name: the list shows a short title and up to three of
 * its places, the name itself stays what is picked and printed.
 *
 * Pure.
 */
import { normalizeName } from "./pricing-suggest";

const LONG = 48;
/** where a paragraph's places meet: a comma, a dash, «ثم», «زيارة», «التوقف عند» — not a colon, a time has one. */
const PARTS = /\s*(?:[،,;]|[-–—]|\s(?:ثم|بعدها|بعد ذلك|و?زيارة|و?التوقف عند|مرورا ب)\s)\s*/u;
/** a part that says how, not where: «جولة يوم كامل بسيارة مرسيدس Vito», «الانطلاق من الفندق», «العودة» */
const GENERIC = /يوم كامل|نصف يوم|بسيار|الانطلاق|الإنطلاق|العود|التوصيل|الرجوع|vito|فيتو|^جولة$/iu;
const lead = /^(?:و|الى|إلى|زيارة|جولة في|جولة)\s+/u;

/** `label`: a short title; `sub`: up to three of its places. A short name is itself, with nothing under it. */
export function tourGist(name: string): { label?: string; sub?: string } {
  const text = name.replace(/[\s‏‎]+/g, " ").trim();
  if (text.length <= LONG) return {};
  const parts = text
    .split(PARTS)
    // a car in brackets is the price list's business, not a place
    .map((p, i) => (i === 0 ? p : p.replace(lead, "")).replace(/\s*\((?:سيارة|سياره|فان|باص)[^)]*\)/gu, "").trim())
    .filter((p) => p.length >= 3);
  // the title is the first part that names a place; the way the tour goes is no title
  const places = parts.filter((p) => !GENERIC.test(p));
  const head = places[0] ?? parts[0] ?? text;
  const label = head.length > LONG ? `${head.slice(0, LONG).replace(/\s+\S*$/, "")}…` : head;
  const sub = places
    .slice(1)
    .filter((p) => p.length <= 40)
    .slice(0, 3)
    .join(" · ");
  return { label, ...(sub ? { sub } : {}) };
}

/**
 * The same tour written twice — with or without «ثم التوصيل الى طرابزون» at
 * its end, its car in brackets, its dashes — is one key.
 */
export function tourKey(name: string): string {
  return normalizeName(name)
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*ثم\s+(?:التوصيل|العوده|الرجوع)\s+(?:الى|للفندق|الي)?.*$/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
