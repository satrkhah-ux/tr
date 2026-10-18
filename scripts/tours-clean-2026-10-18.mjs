// The owner's order (2026-10-18): «نظف الجولات وحدث الأسعار مؤقتة 100 ريال».
//
//   node scripts/tours-clean-2026-10-18.mjs            dry run (default): prints every change
//   node scripts/tours-clean-2026-10-18.mjs --commit   backup + apply, one transaction
//
// 1. Spelling, in tours.arabic_name and tour_programs.title / description_ar:
//    the owner's list («يرج» as a whole word only, it never touches «يرجى»).
// 2. Duplicates in the price list (tours): same country, same city, the same
//    name once RLM/LRM, tatweel, diacritics, dash kinds and spacing are
//    ignored, AND the same price and currency → one row kept (the oldest),
//    the others deleted. Nothing references a tours row by id but tour_prices
//    (moved onto the kept row); drafts carry the tour's title and its
//    programme id (TourPick), never a tours id. Same name, different price →
//    not merged, listed for the owner.
// 3. Every active city programme (tour_programs, not a free day) that no priced
//    tour matches — by programme id or by name in its country, the generator's
//    own lookup (findTourPrice) — gets a tours row tied to it and a 100 SAR
//    «سيارة صغيرة» tour_prices row, both provisional (0096).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const commit = process.argv.includes("--commit");
const CAR = "سيارة صغيرة";
const PRICE = 100;
const FIXES = [
  ["صبنجةة", "صبنجة"],
  ["األسماك", "الأسماك"],
  ["مرتغعات", "مرتفعات"],
  ["يرج", "برج"],
  ["مالهى فيلاند او", "ملاهي فيلاند أو"],
  ["شالالت", "شلالات"],
  ["الكبيرالشهير", "الكبير الشهير"],
];
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// «يرج» only as a whole word (it sits inside «يرجى»); the others are misspellings
// that are never part of a correct word, so they are fixed wherever they stand —
// «صبنجةةومعشوقية» and «فيلاند اومنطقة» are two words glued
const fixText = (text) => {
  let out = text.replace(/صبنجةةو/g, "صبنجة و").replace(/مالهى فيلاند او(?=[؀-ۿ])/g, "مالهى فيلاند او ");
  for (const [from, to] of FIXES) {
    const re = from === "يرج" ? new RegExp(`(?<![\\u0600-\\u06FF])${esc(from)}(?![\\u0600-\\u06FF])`, "g") : new RegExp(esc(from), "g");
    out = out.replace(re, to);
  }
  return out;
};
const norm = (s) =>
  String(s ?? "")
    .replace(/[​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[–—‒−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

const tours = await q(`select * from public.tours order by created_at, id`);
const prices = await q(`select * from public.tour_prices`);
const programs = await q(`select * from public.tour_programs`);
const countries = new Map((await q(`select id, arabic_name from public.countries`)).map((r) => [r.id, r.arabic_name]));
const cities = new Map((await q(`select id, arabic_name from public.cities`)).map((r) => [r.id, r.arabic_name]));

// 1. spelling
const tourRenames = tours.flatMap((t) => (t.arabic_name && fixText(t.arabic_name) !== t.arabic_name ? [{ id: t.id, from: t.arabic_name, to: fixText(t.arabic_name) }] : []));
const programRenames = programs.flatMap((p) => {
  const title = p.title ? fixText(p.title) : p.title;
  const desc = p.description_ar ? fixText(p.description_ar) : p.description_ar;
  return title !== p.title || desc !== p.description_ar ? [{ id: p.id, title: p.title, newTitle: title, descChanged: desc !== p.description_ar, newDesc: desc }] : [];
});
const nameOf = (t) => tourRenames.find((r) => r.id === t.id)?.to ?? t.arabic_name;

// 2. duplicates (on the corrected names)
const groups = new Map();
for (const t of tours) {
  const k = `${t.country_id}|${t.city_id}|${norm(nameOf(t))}`;
  groups.set(k, [...(groups.get(k) ?? []), t]);
}
const merges = [];
const conflicts = [];
for (const rows of groups.values()) {
  if (rows.length < 2) continue;
  const sig = new Set(rows.map((r) => `${r.price ?? ""}|${(r.currency ?? "").toUpperCase()}`));
  if (sig.size > 1) {
    conflicts.push(rows.map((r) => ({ name: nameOf(r), price: r.price, currency: r.currency, country: countries.get(r.country_id), city: cities.get(r.city_id) })));
    continue;
  }
  const [keep, ...drop] = rows;
  merges.push({ keep, drop, name: nameOf(keep), country: countries.get(keep.country_id), city: cities.get(keep.city_id) });
}
const dropped = new Set(merges.flatMap((m) => m.drop.map((d) => d.id)));

// 3. programmes no priced tour reaches
const pricedByName = new Set(
  tours.filter((t) => !dropped.has(t.id) && t.price != null).map((t) => `${t.country_id}|${norm(nameOf(t))}`),
);
const pricedPrograms = new Set(tours.filter((t) => t.program_id && (t.price != null || prices.some((p) => p.tour_id === t.id))).map((t) => t.program_id));
const unpriced = programs.filter((p) => {
  if (p.is_free_day || String(p.status ?? "Active").toLowerCase() === "disabled" || !p.title?.trim()) return false;
  const title = programRenames.find((r) => r.id === p.id)?.newTitle ?? p.title;
  return !pricedPrograms.has(p.id) && !pricedByName.has(`${p.country_id}|${norm(title)}`);
});

console.log(`spelling: ${tourRenames.length} tours, ${programRenames.length} programmes`);
for (const r of tourRenames) console.log(`  tour: ${r.from}  →  ${r.to}`);
for (const r of programRenames) console.log(`  programme: ${r.title}${r.newTitle !== r.title ? `  →  ${r.newTitle}` : ""}${r.descChanged ? " (+ description)" : ""}`);
console.log(`duplicates merged: ${merges.length} groups, ${dropped.size} rows removed`);
for (const m of merges) console.log(`  ${m.country}/${m.city ?? "—"}: «${m.name}» ×${m.drop.length + 1} → 1`);
console.log(`same name, different price (not merged): ${conflicts.length}`);
for (const g of conflicts) console.log(`  ${g[0].country}/${g[0].city ?? "—"}: «${g[0].name}» — ${g.map((r) => `${r.price} ${r.currency}`).join(" / ")}`);
console.log(`programmes getting ${PRICE} SAR (${CAR}): ${unpriced.length}`);
const byCountry = {};
for (const p of unpriced) byCountry[countries.get(p.country_id)] = (byCountry[countries.get(p.country_id)] ?? 0) + 1;
console.log(byCountry);

const report = {
  taken_at: new Date().toISOString(),
  spelling: { tours: tourRenames, programmes: programRenames.map(({ id, title, newTitle, descChanged }) => ({ id, title, newTitle, descChanged })) },
  merged: merges.map((m) => ({ country: m.country, city: m.city, name: m.name, kept: m.keep.id, removed: m.drop.map((d) => ({ id: d.id, name: d.arabic_name })) })),
  notMerged: conflicts,
  provisional: unpriced.map((p) => ({ program_id: p.id, title: p.title, country: countries.get(p.country_id), city: cities.get(p.city_id) })),
};

if (!commit) {
  console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}
const dir = "data-import/backups/tours-clean-2026-10-18";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/before.json`, JSON.stringify({ taken_at: report.taken_at, tours, tour_prices: prices, tour_programs: programs }, null, 1));
await c.query("begin");
try {
  for (const r of tourRenames) await c.query(`update public.tours set arabic_name = $2 where id = $1`, [r.id, r.to]);
  for (const r of programRenames) await c.query(`update public.tour_programs set title = $2, description_ar = $3 where id = $1`, [r.id, r.newTitle, r.newDesc]);
  for (const m of merges) {
    const ids = m.drop.map((d) => d.id);
    // fill what the kept row lacks from the ones it absorbs, then move any per-car prices onto it
    const donor = m.drop.find((d) => d.program_id) ?? m.drop.find((d) => d.city_id) ?? null;
    if (donor) await c.query(`update public.tours set program_id = coalesce(program_id, $2), city_id = coalesce(city_id, $3), duration_hours = coalesce(duration_hours, $4) where id = $1`, [m.keep.id, donor.program_id, donor.city_id, donor.duration_hours]);
    await c.query(`update public.tour_prices set tour_id = $1 where tour_id = any($2)`, [m.keep.id, ids]);
    await c.query(`delete from public.tours where id = any($1)`, [ids]);
  }
  const created = [];
  for (const p of unpriced) {
    const title = programRenames.find((r) => r.id === p.id)?.newTitle ?? p.title;
    const [tour] = (
      await c.query(
        `insert into public.tours (arabic_name, country_id, city_id, program_id, price, currency, provisional) values ($1, $2, $3, $4, null, 'SAR', true) returning id`,
        [title.trim(), p.country_id, p.city_id, p.id],
      )
    ).rows;
    await c.query(`insert into public.tour_prices (tour_id, car_type, price, currency, provisional) values ($1, $2, $3, 'SAR', true)`, [tour.id, CAR, PRICE]);
    created.push(tour.id);
  }
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'data.updated', 'tours', null, $1)`,
    [JSON.stringify({ cleaned: true, spelling: tourRenames.length + programRenames.length, merged_groups: merges.length, removed: dropped.size, provisional_programmes: created.length, backup: dir })],
  );
  await c.query("commit");
  writeFileSync(`${dir}/report.json`, JSON.stringify({ ...report, createdTourIds: created }, null, 1));
  console.log(`done. Backup and report: ${dir}`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
