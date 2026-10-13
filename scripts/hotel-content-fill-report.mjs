// READ-ONLY report: address / phone / position for hotels that lack them,
// proposed from the supplier content already cached in hotel_content_cache
// (data section order 11.2).
//
// Usage: node scripts/hotel-content-fill-report.mjs
//   → data-import/hotel-content-fill-<date>.json  (gitignored)
//   → stdout summary
//
// Nothing is written to the database (the session is read-only). A proposal is
// evidence for a human: the cache row is matched to our hotel by
// internal_hotel_id, and `name_similarity` says how alike the supplier's name
// and ours are — a low one usually means the link itself is wrong.
//
// What the cache holds: address, lat/lng (0015). It has NO phone column; a phone
// is proposed only if a later migration adds one (phone / phone_number /
// contact_number). Hotels have no lat/lng columns, so a position is proposed as
// a google_maps link (the column the hotel form already has), with the numbers.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { normEn, similarity } from "../src/lib/catalog/norm.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env.local"), "utf8");
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("SUPABASE_DB_URL missing from .env.local");

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("set default_transaction_read_only = on");

const blank = "nullif(btrim(%s), '') is null";
const missing = ["h.address", "h.contact_number", "h.google_maps"].map((c) => blank.replace("%s", c)).join(" or ");

const { rows: hotels } = await db.query(`
  select h.id, h.arabic_name, h.english_name, h.address, h.contact_number, h.google_maps,
    c.arabic_name as city
  from hotels h
  left join cities c on c.id = h.city_id
  where ${missing}`);
const { rows: content } = await db.query(`
  select x.internal_hotel_id, x.supplier, x.supplier_hotel_id, x.name_en, x.name_ar,
    nullif(btrim(x.address), '') as address, x.lat, x.lng, x.content_synced_at,
    nullif(btrim(coalesce(to_jsonb(x)->>'phone', to_jsonb(x)->>'phone_number', to_jsonb(x)->>'contact_number')), '') as phone
  from hotel_content_cache x
  where x.internal_hotel_id is not null
  order by x.content_synced_at desc`);
await db.end();

const bySupplier = new Map();
for (const row of content) bySupplier.set(row.internal_hotel_id, [...(bySupplier.get(row.internal_hotel_id) ?? []), row]);

const empty = (v) => !(v ?? "").toString().trim();
const out = [];
let noContent = 0;
for (const h of hotels) {
  const cached = bySupplier.get(h.id);
  if (!cached) {
    noContent += 1;
    continue;
  }
  // newest first: the first cache row that has the field wins
  const proposed = {};
  const sources = {};
  const take = (field, row, value) => {
    proposed[field] = value;
    sources[field] = row.supplier;
  };
  if (empty(h.address)) {
    const r = cached.find((x) => x.address);
    if (r) take("address", r, r.address);
  }
  if (empty(h.contact_number)) {
    const r = cached.find((x) => x.phone);
    if (r) take("contact_number", r, r.phone);
  }
  if (empty(h.google_maps)) {
    const r = cached.find((x) => x.lat != null && x.lng != null && !(Number(x.lat) === 0 && Number(x.lng) === 0));
    if (r) {
      take("google_maps", r, `https://www.google.com/maps?q=${Number(r.lat)},${Number(r.lng)}`);
      proposed.lat = Number(r.lat);
      proposed.lng = Number(r.lng);
    }
  }
  if (Object.keys(proposed).length === 0) continue;
  const supplierName = cached[0].name_en;
  out.push({
    hotel_id: h.id,
    arabic_name: h.arabic_name,
    english_name: h.english_name,
    city: h.city,
    supplier_name: supplierName,
    name_similarity: Number(similarity(normEn(h.english_name), normEn(supplierName)).toFixed(2)),
    current: { address: h.address, contact_number: h.contact_number, google_maps: h.google_maps },
    proposed,
    sources,
    synced_at: cached[0].content_synced_at,
  });
}
// the doubtful links first, so the human reads those carefully
out.sort((a, b) => a.name_similarity - b.name_similarity);

const count = (field) => out.filter((r) => r.proposed[field] !== undefined).length;
const summary = {
  hotels_missing_something: hotels.length,
  without_cached_content: noContent,
  with_proposals: out.length,
  proposals: { address: count("address"), contact_number: count("contact_number"), google_maps: count("google_maps") },
  doubtful_links: out.filter((r) => r.name_similarity < 0.6).length,
};

const day = new Date().toISOString().slice(0, 10);
mkdirSync(join(root, "data-import"), { recursive: true });
const file = join(root, "data-import", `hotel-content-fill-${day}.json`);
writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), summary, rows: out }, null, 2));

console.log(JSON.stringify(summary, null, 2));
console.log(`→ ${file}`);
