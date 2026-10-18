// The owner's order (2026-10-18): a 100 SAR «سيارة صغيرة» airport transfer for
// every city that has no price for that car — reception line «مطار X» → «المدينة»
// (the generator reads the farewell from it), marked provisional (0095).
// Existing prices are never changed.
//
//   node scripts/transfers-provisional-2026-10-18.mjs            dry run (default)
//   node scripts/transfers-provisional-2026-10-18.mjs --commit   backup + insert, one transaction
//
// Candidates: every airport → city pair already priced for another car, plus
// every active airport linked to a city (airports.city_id) — the pair the
// generator matches (pricing-suggest-core: from_city holds «مطار», to_city the
// city's name, same country). A pair that already has a small-car line is skipped.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const CAR = "سيارة صغيرة";
const PRICE = 100;
const commit = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
// the generator's comparison ignores hamza forms, tatweel, diacritics and spacing
const norm = (s) =>
  String(s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

const existing = await q(`select country_id, from_city, to_city, car_type from public.transfers where from_city like '%مطار%'`);
const key = (country, from, to) => `${country}|${norm(from)}|${norm(to)}`;
const hasSmall = new Set(existing.filter((r) => norm(r.car_type) === norm(CAR)).map((r) => key(r.country_id, r.from_city, r.to_city)));

// «المطار → الفندق» is a generic legacy line, not a city — the generator never matches it
const generic = (to) => norm(to) === "الفندق";
const pairs = new Map();
for (const r of existing) if (r.country_id && !generic(r.to_city)) pairs.set(key(r.country_id, r.from_city, r.to_city), { country_id: r.country_id, from_city: r.from_city.trim(), to_city: r.to_city.trim(), source: "route" });
// a city already reached by some airport route is covered by that route's pair above
const routed = new Set(existing.filter((r) => r.country_id).map((r) => `${r.country_id}|${norm(r.to_city)}`));
const airports = await q(
  `select a.arabic_name as airport, ci.arabic_name as city, coalesce(ci.country_id, a.country_id) as country_id
     from public.airports a join public.cities ci on ci.id = a.city_id
    where lower(coalesce(a.status, 'active')) <> 'disabled' and a.arabic_name is not null and ci.arabic_name is not null`,
);
for (const a of airports) {
  if (!a.country_id || !a.airport.includes("مطار") || routed.has(`${a.country_id}|${norm(a.city)}`)) continue;
  const k = key(a.country_id, a.airport, a.city);
  if (!pairs.has(k)) pairs.set(k, { country_id: a.country_id, from_city: a.airport.trim(), to_city: a.city.trim(), source: "airport" });
}
const todo = [...pairs.entries()].filter(([k]) => !hasSmall.has(k)).map(([, v]) => v);
const countries = new Map((await q(`select id, arabic_name from public.countries`)).map((r) => [r.id, r.arabic_name]));
const byCountry = {};
for (const t of todo) byCountry[countries.get(t.country_id) ?? t.country_id] = (byCountry[countries.get(t.country_id) ?? t.country_id] ?? 0) + 1;
console.log(`pairs: ${pairs.size}; already with ${CAR}: ${pairs.size - todo.length}; to add: ${todo.length} (from routes ${todo.filter((t) => t.source === "route").length}, from airports ${todo.filter((t) => t.source === "airport").length})`);
console.log(byCountry);
for (const t of todo.slice(0, 12)) console.log(`  ${countries.get(t.country_id)}: ${t.from_city} → ${t.to_city}`);

if (!commit) {
  console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}
const dir = "data-import/backups/transfers-provisional-2026-10-18";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/to-insert.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: todo }, null, 1));
await c.query("begin");
try {
  const ids = [];
  for (const t of todo) {
    const [row] = (
      await c.query(
        `insert into public.transfers (from_city, to_city, car_type, price, currency, country_id, provisional) values ($1, $2, $3, $4, 'SAR', $5, true) returning id`,
        [t.from_city, t.to_city, CAR, PRICE, t.country_id],
      )
    ).rows;
    ids.push(row.id);
  }
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'data.created', 'transfers', null, $1)`,
    [JSON.stringify({ provisional: true, car: CAR, price: PRICE, currency: "SAR", inserted: ids.length, backup: dir })],
  );
  await c.query("commit");
  writeFileSync(`${dir}/inserted-ids.json`, JSON.stringify(ids, null, 1));
  console.log(`inserted ${ids.length} provisional lines. Undo: delete from transfers where provisional and id in (${dir}/inserted-ids.json)`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
