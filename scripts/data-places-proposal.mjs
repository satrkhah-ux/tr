/**
 * Orders 5 and 9.3 — airports / stations / ports, city names, «السعوديه»-style
 * spellings. READ ONLY → data-import/data-places-proposal.json.
 *
 *   node scripts/data-places-proposal.mjs
 *
 * Sections, each item with `ok` (true = the apply does it):
 *   airports   the kind the name says (guessPlaceKind) and a valid IATA code:
 *              three capitals on an airport, none on a station or port.
 *              «kul» → «KUL» is ok:true; «12go» / «AA» / «AB» get no code and
 *              ok:false — a person who knows the right code types it in `to_code`.
 *   cities     punctuation stripped (ok:true); the names the evaluation listed
 *              (Baikal, Vlašić, ابانت, جامليهمشين, يلوا, «أوبلاست كالوجا،») with a
 *              suggested spelling (ok:false); a Latin-only Arabic name (ok:false).
 *   spellings  a final «يه» that is «ية» in countries and cities: the known ones
 *              ok:true (السعوديه → السعودية), any other ok:false.
 *   states     سيلانجور، قدح، جوهر … listed only: the owner's rule (catalog-cleanup
 *              2026-10-12) is that Malaysia keeps all its real cities — no action.
 *
 * A rename that folds to another city of the same country (the unique index
 * of 0050) is marked `conflict` and never ok.
 */
import { hasColumn, propose } from "./data-model-lib.mjs";
import { guessPlaceKind, iataProblem } from "../src/lib/catalog/model.ts";
import { normAr, normEn } from "../src/lib/catalog/norm.ts";

/** The names the 2026-10-13 evaluation named, folded → the suggested Arabic spelling. */
const CITY_SUGGEST = new Map([
  ["baikal", "بايكال"],
  ["vlasic", "فلاشيتش"],
  [normAr("ابانت"), "أبانت"],
  [normAr("جامليهمشين"), "تشامليهمشين"],
  [normAr("يلوا"), "يالوفا"],
  [normAr("أوبلاست كالوجا"), "كالوغا"],
]);
/** «يه» → «ية» known to be right, folded keys. */
const KNOWN_TA_MARBUTA = new Map(
  [
    ["السعوديه", "السعودية"],
    ["المملكه العربيه السعوديه", "المملكة العربية السعودية"],
    ["المنامه", "المنامة"],
    ["المدينه المنوره", "المدينة المنورة"],
    ["مكه المكرمه", "مكة المكرمة"],
    ["جده", "جدة"],
    ["الاسكندريه", "الإسكندرية"],
    ["التشيك الجمهوريه", "جمهورية التشيك"],
  ].map(([from, to]) => [normAr(from), to]),
);
const STATES = ["سيلانجور", "قدح", "جوهر", "جوهور", "بهانج", "صباح", "ساراواك"].map(normAr);

const fold = (s) => normEn(s) || normAr(s);
const hasArabic = (s) => /[ء-ي]/.test(s ?? "");

/** «السعوديه» → «السعودية»: every word ending in «يه» takes «ية». */
const taMarbuta = (name) => name.replace(/يه(?=\s|$)/g, "ية");

await propose("places", async (q) => {
  // ---- airports ----
  const withKind = await hasColumn(q, "airports", "kind");
  const airports = await q(`select id, arabic_name, english_name, code, status${withKind ? ", kind" : ", 'airport' as kind"} from public.airports order by code nulls last`);
  const airportItems = [];
  for (const a of airports) {
    // a kind a person already set stays; the default 'airport' is what the name may correct
    const kind = a.kind !== "airport" ? a.kind : guessPlaceKind(a.arabic_name, a.english_name);
    const code = a.code ?? null;
    let toCode = code;
    let ok = true;
    const problem = iataProblem(code, kind);
    if (problem === "not_airport") toCode = null;
    else if (problem === "format") {
      const fixed = String(code).trim().toUpperCase();
      toCode = /^[A-Z]{3}$/.test(fixed) ? fixed : null;
      ok = toCode !== null;
    } else if (code === "") toCode = null;
    if (kind === a.kind && toCode === code) continue;
    airportItems.push({
      id: a.id, name: a.arabic_name, english: a.english_name, status: a.status,
      from_kind: a.kind, to_kind: kind, from_code: code, to_code: toCode, problem, ok,
    });
  }

  // ---- cities and countries ----
  const countries = await q("select id, arabic_name, english_name from public.countries");
  const countryName = new Map(countries.map((c) => [c.id, c.arabic_name]));
  const cities = await q("select id, arabic_name, english_name, country_id from public.cities");
  const taken = new Map(); // country|folded → id
  for (const c of cities) taken.set(`${c.country_id}|${normAr(c.arabic_name)}`, c.id);
  const conflictOf = (c, to) => {
    const other = taken.get(`${c.country_id}|${normAr(to)}`);
    return other && other !== c.id ? other : null;
  };

  const cityItems = [];
  const spellings = [];
  const states = [];
  for (const c of cities) {
    const name = c.arabic_name ?? "";
    if (STATES.includes(normAr(name))) states.push({ id: c.id, name, country: countryName.get(c.country_id), decision: "keep" });
    const suggested = CITY_SUGGEST.get(fold(name)) ?? CITY_SUGGEST.get(normAr(name.replace(/[،,.\s]+$/, "")));
    const trimmed = name.replace(/^[\s،,.\-–]+|[\s،,.\-–]+$/g, "");
    if (suggested) {
      const conflict = conflictOf(c, suggested);
      cityItems.push({ id: c.id, country: countryName.get(c.country_id), from: name, to: suggested, english: c.english_name, reason: "listed", conflict, ok: false });
    } else if (trimmed !== name) {
      const conflict = conflictOf(c, trimmed);
      cityItems.push({ id: c.id, country: countryName.get(c.country_id), from: name, to: trimmed, reason: "punctuation", conflict, ok: !conflict });
    } else if (!hasArabic(name)) {
      cityItems.push({ id: c.id, country: countryName.get(c.country_id), from: name, to: "", english: c.english_name, reason: "latin", ok: false });
    }
    const fixed = KNOWN_TA_MARBUTA.get(normAr(name)) ?? taMarbuta(name);
    if (fixed !== name && !suggested) {
      spellings.push({ table: "cities", id: c.id, from: name, to: fixed, known: KNOWN_TA_MARBUTA.has(normAr(name)), ok: KNOWN_TA_MARBUTA.has(normAr(name)) && !conflictOf(c, fixed) });
    }
  }
  for (const c of countries) {
    const fixed = KNOWN_TA_MARBUTA.get(normAr(c.arabic_name)) ?? taMarbuta(c.arabic_name ?? "");
    if (fixed !== c.arabic_name) spellings.push({ table: "countries", id: c.id, from: c.arabic_name, to: fixed, known: KNOWN_TA_MARBUTA.has(normAr(c.arabic_name)), ok: KNOWN_TA_MARBUTA.has(normAr(c.arabic_name)) });
  }

  const notes = withKind ? [] : ["0072 is not applied: every airport is read as kind 'airport'; the apply needs 0072"];
  console.log(
    `airports ${airportItems.length} (${airportItems.filter((a) => a.ok).length} ok, ${airportItems.filter((a) => a.problem === "format" && !a.ok).length} codes need a person), cities ${cityItems.length}, spellings ${spellings.length} (${spellings.filter((s) => s.ok).length} known), states ${states.length}`,
  );
  return { notes, airports: airportItems, cities: cityItems, spellings, states };
});
