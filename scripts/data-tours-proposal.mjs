/**
 * Order 7 — a tour is one record priced per vehicle; the ready programmes get
 * real titles. READ ONLY → data-import/data-tours-proposal.json.
 *
 *   node scripts/data-tours-proposal.mjs
 *
 * The legacy import wrote one `tours` row per (tour × vehicle), the vehicle in
 * the name: «رحلة لشمال بالي (فان)». Here the rows of one tour (same country,
 * same name without the vehicle) become ONE group: the first row is kept and
 * renamed to the bare name, each vehicle's price becomes a tour_prices row, the
 * rest are deleted (their legacy ids point at the kept one). The kept row's own
 * price is the cheapest, so whatever still reads tours.price sees a «from» price.
 *
 * The tour's programme (tour_programs, 0052 — same legacy rows, the text as its
 * description) is found by the same text; it gives the tour its city.
 *
 * Sections:
 *   groups    ok: true unless a vehicle matches no fleet car type (then a person maps `car_type`)
 *   titles    generic programme titles («الجولة الأولى») → a descriptive one     ok: false
 *   typos     spelling fixes in programme titles and texts (a fixed list)          ok: true
 */
import { hasColumn, propose } from "./data-model-lib.mjs";
import { seatsFromName, splitTourName } from "../src/lib/catalog/model.ts";
import { normAr } from "../src/lib/catalog/norm.ts";

/** Misspellings that print on the client's document, and their fix. */
const TYPOS = [
  [/كوالالبمور/g, "كوالالمبور"],
  [/(^|[\s،.])تبدا(?=[\s،.]|$)/g, "$1تبدأ"],
  [/المراء الحامل/g, "المرأة الحامل"],
];
const GENERIC_TITLE = /^(ال)?جول[ةه]\s+(ال)?(اول[يى]?|أول[ىي]?|ثاني[ةه]?|ثالث[ةه]?|رابع[ةه]?|خامس[ةه]?|سادس[ةه]?|سابع[ةه]?|ثامن[ةه]?|تاسع[ةه]?|عاشر[ةه]?)$/;

const knownCurrency = (raw) => {
  const c = raw?.trim() === "ريال سعودي" ? "SAR" : (raw?.trim().toUpperCase() ?? "");
  return /^[A-Z]{3}$/.test(c) ? c : null;
};
/** The first clause of a programme's text — a title a client can read. */
const titleFrom = (text) => {
  const first = String(text ?? "").split(/[.\n،:]/)[0].replace(/\s+/g, " ").trim();
  return first.length > 3 ? (first.length > 60 ? `${first.slice(0, 57).trim()}…` : first) : "";
};

await propose("tours", async (q) => {
  const ready = await hasColumn(q, "tours", "program_id");
  const tours = await q(
    `select t.id, t.arabic_name, t.english_name, t.country_id, t.price, t.currency, t.created_at, m.legacy_id
       ${ready ? ", t.program_id, t.city_id" : ", null as program_id, null as city_id"}
     from public.tours t
     left join public.legacy_id_map m on m.entity = 'tour' and m.source = 'app' and m.new_id = t.id
     order by m.legacy_id nulls last, t.created_at`,
  );
  const fleet = await q("select arabic_name, pax_capacity from public.transportation_types where category = 'fleet' and status <> 'Disabled'");
  const programs = await q("select id, title, description_ar, city_id, country_id from public.tour_programs");

  /** The fleet's name for a legacy vehicle name: the same name, else the one car with as many seats. */
  const fleetName = (car) => {
    const same = fleet.find((f) => normAr(f.arabic_name) === normAr(car));
    if (same) return same.arabic_name;
    const seats = seatsFromName(car);
    const bySeats = seats ? fleet.filter((f) => (f.pax_capacity ?? seatsFromName(f.arabic_name)) === seats) : [];
    return bySeats.length === 1 ? bySeats[0].arabic_name : null;
  };

  // ---- group the per-vehicle rows ----
  const groups = new Map();
  for (const t of tours) {
    const split = splitTourName(t.arabic_name);
    const base = (split?.base ?? t.arabic_name ?? "").replace(/\s+/g, " ").trim();
    if (!base) continue;
    const key = `${t.country_id}|${normAr(base)}`;
    const g = groups.get(key) ?? { base, country_id: t.country_id, rows: [] };
    g.rows.push({ ...t, car: split?.car ?? null });
    groups.set(key, g);
  }

  const out = [];
  for (const g of groups.values()) {
    const perCar = g.rows.filter((r) => r.car);
    if (perCar.length === 0 && g.rows.length === 1 && g.rows[0].program_id) continue; // already one record
    const keep = g.rows[0];
    // one price per vehicle: the old system's last row wins, like every other list
    const prices = new Map();
    const problems = [];
    for (const r of perCar) {
      const car = fleetName(r.car);
      const currency = knownCurrency(r.currency);
      if (r.price == null || !currency) {
        problems.push(`no price/currency for «${r.car}»`);
        continue;
      }
      if (!car) problems.push(`«${r.car}» is no fleet car type — set car_type`);
      const key = normAr(car ?? r.car);
      const was = prices.get(key);
      if (!was || Number(r.legacy_id ?? -1) > Number(was.legacy_id ?? -1)) {
        prices.set(key, { car_type: car ?? r.car, legacy_car: r.car, price: Number(r.price), currency, legacy_id: r.legacy_id, fleet: Boolean(car) });
      }
    }
    const list = [...prices.values()];
    const cheapest = list.reduce((a, b) => (!a || (b.currency === a.currency && b.price < a.price) ? b : a), null);
    const matches = programs.filter(
      (p) => p.country_id === g.country_id && (normAr(p.description_ar) === normAr(g.base) || normAr(p.title) === normAr(g.base)),
    );
    const program = matches.length === 1 ? matches[0] : null;
    out.push({
      base: g.base,
      country_id: g.country_id,
      keep_id: keep.id,
      drop_ids: g.rows.slice(1).map((r) => r.id),
      prices: list.map((p) => ({ car_type: p.car_type, legacy_car: p.legacy_car, price: p.price, currency: p.currency, fleet: p.fleet })),
      base_price: cheapest?.price ?? keep.price ?? null,
      base_currency: cheapest?.currency ?? knownCurrency(keep.currency),
      program_id: keep.program_id ?? program?.id ?? null,
      city_id: keep.city_id ?? program?.city_id ?? null,
      program_matches: matches.length,
      problems,
      ok: list.every((p) => p.fleet) && (list.length > 0 || g.rows.length > 1 || Boolean(program)),
    });
  }

  // ---- the programmes: titles and spelling ----
  const titles = [];
  const typos = [];
  const byProgram = new Map(out.filter((g) => g.program_id).map((g) => [g.program_id, g.base]));
  for (const p of programs) {
    if (GENERIC_TITLE.test(normAr(p.title))) {
      const fromTour = byProgram.get(p.id);
      const suggestion = fromTour && fromTour.length <= 60 ? fromTour : titleFrom(p.description_ar);
      if (suggestion) titles.push({ id: p.id, from: p.title, to: suggestion, ok: false });
    }
    let title = p.title;
    let text = p.description_ar;
    for (const [re, to] of TYPOS) {
      title = title.replace(re, to);
      text = text.replace(re, to);
    }
    if (title !== p.title || text !== p.description_ar) typos.push({ id: p.id, title_from: p.title, title_to: title, text_from: p.description_ar, text_to: text, ok: true });
  }

  const notes = ready ? [] : ["0072 is not applied: the apply needs tour_prices and tours.program_id / city_id"];
  console.log(
    `groups ${out.length} (${out.filter((g) => g.ok).length} ok; ${out.reduce((n, g) => n + g.drop_ids.length, 0)} rows to fold in, ${out.reduce((n, g) => n + g.prices.length, 0)} car prices), titles ${titles.length}, typo fixes ${typos.length}`,
  );
  return { notes, groups: out, titles, typos };
});
