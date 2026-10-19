// The owner's order (2026-10-19): Murad answers visa requests from the
// company's visa list — «/visas» of the old system. public.visas (0072) is
// empty on the live database; the old system's 14 rows are in the dump
// (data-import/extracted/visas.json, scripts/legacy-extract-reference.mjs).
// This puts them in, matched to our countries by name (the aliases of
// legacy-build-reference-sql.mjs). A price of 0 is «no price yet» (null).
//
// Only into an EMPTY table — it never touches a row someone already wrote.
//
//   node scripts/import-legacy-visas-2026-10-19.mjs            dry run
//   node scripts/import-legacy-visas-2026-10-19.mjs --commit   write
import { readFileSync } from "node:fs";
import pg from "pg";

const commit = process.argv.includes("--commit");
const read = (f) => JSON.parse(readFileSync(`data-import/extracted/${f}.json`, "utf8"));
const visas = read("visas");
const countries = new Map(read("countries").map((c) => [c.id, c.arabic_name]));
const currencies = new Map(read("currencies").map((c) => [c.id, c.iso_code]));
const types = new Map(read("visas_types").map((t) => [t.id, t.arabic_name]));
// our spelling of a legacy country (legacy-build-reference-sql.mjs COUNTRY_ALIAS)
const ALIAS = { 11: "البوسنة والهرسك", 17: "الولايات المتحدة", 23: "الإمارات العربية المتحدة", 30: "المملكة المتحدة" };

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const ours = (await c.query("select id, arabic_name from countries")).rows;
const norm = (s) => (s ?? "").normalize("NFKC").trim().replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const rows = visas.map((v) => {
  const name = ALIAS[v.country_id] ?? countries.get(v.country_id);
  const hit = ours.find((o) => norm(o.arabic_name) === norm(name));
  const price = (n) => (Number(n) > 0 ? Number(n) : null);
  return {
    country: hit?.arabic_name ?? name,
    country_id: hit?.id ?? null,
    visa_type: types.get(v.visa_type_id) ?? "تأشيرة سياحية",
    buy_price: price(v.buy_price),
    buy_currency: currencies.get(v.buy_currency_id) ?? "SAR",
    sell_price: price(v.sell_price),
    sell_currency: currencies.get(v.sell_currency_id) ?? "SAR",
    arabic_requirements: v.arabic_requirements?.trim() || null,
    english_requirements: v.english_requirements?.trim() || null,
    status: v.status === 1 ? "Active" : "Inactive",
  };
});
for (const r of rows) console.log(`${r.country_id ? "✓" : "✗ no country"} ${r.country} — ${r.visa_type} — ${r.sell_price ?? "بلا سعر"} ${r.sell_currency} — ${r.arabic_requirements ? "متطلبات" : "بلا متطلبات"}`);
const { n } = (await c.query("select count(*)::int n from visas")).rows[0];
if (!commit || n > 0) {
  console.log(n > 0 ? `visas already holds ${n} rows — nothing written.` : "dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}
await c.query("begin");
try {
  for (const r of rows) {
    await c.query(
      "insert into visas (country, country_id, visa_type, buy_price, buy_currency, sell_price, sell_currency, arabic_requirements, english_requirements, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [r.country, r.country_id, r.visa_type, r.buy_price, r.buy_currency, r.sell_price, r.sell_currency, r.arabic_requirements, r.english_requirements, r.status],
    );
  }
  await c.query(
    "insert into audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'data.created', 'visas', null, $1)",
    [JSON.stringify({ imported_visas: rows.length, source: "legacy app.traveliun.com /visas (dump 2026-07-20)" })],
  );
  await c.query("commit");
  console.log(`imported ${rows.length} visas. Undo: delete from visas (the table was empty before).`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
