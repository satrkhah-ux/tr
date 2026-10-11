// READ-ONLY report of duplicated / nonsensical catalogue rows.
//
// Usage: node scripts/catalog-dedupe-report.mjs
//   → data-import/catalog-candidates.json  (machine-readable, gitignored)
//   → stdout summary
//
// Nothing is changed here. The decisions — which row survives, what is not a
// city — are written by a human into scripts/catalog-dedupe-decisions.json and
// carried out by scripts/catalog-dedupe-apply.mjs. A heuristic proposes; it
// never deletes: two DoubleTree hotels in one city can be two real hotels.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { normAr, normEn, similarity, looksLikeHotel } from "../src/lib/catalog/norm.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env.local"), "utf8");
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("SUPABASE_DB_URL missing from .env.local");

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("set default_transaction_read_only = on");
const q = async (sql) => (await db.query(sql)).rows;

const countries = await q("select id, arabic_name, english_name, iso2 from countries");
const cities = await q(`
  select c.id, c.country_id, c.arabic_name, c.english_name,
    (select count(*)::int from hotels h where h.city_id = c.id) hotels,
    (select count(*)::int from airports a where a.city_id = c.id) airports
  from cities c`);
const hotels = await q(`
  select h.id, h.city_id, h.arabic_name, h.english_name, h.stars, h.created_at,
    (select count(*)::int from offer_hotels o where o.hotel_id = h.id) offers,
    (select count(*)::int from hotel_rate_memory m where m.hotel_id = h.id) rates,
    (select count(*)::int from room_types r where r.hotel_id = h.id) rooms,
    (select count(*)::int from hotel_content_cache x where x.internal_hotel_id = h.id) content
  from hotels h`);
const roomTypes = await q(`
  select r.id, r.hotel_id, r.arabic_name, r.english_name, r.created_at,
    (select count(*)::int from offer_hotels o where o.room_type_id = r.id) offers
  from room_types r`);
const drafts = await q("select id, data::text as data from offer_drafts");
await db.end();

/** How many drafts mention an id anywhere in their JSON. */
const draftRefs = (id) => drafts.filter((d) => d.data.includes(id)).length;
const countryOf = new Map(countries.map((c) => [c.id, c]));
const cityOf = new Map(cities.map((c) => [c.id, c]));

/** Group rows by a key, keep only groups of 2+. */
function groups(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.values()].filter((g) => g.length > 1);
}

/** Pairs inside a bucket whose normalized names are close but not equal. */
function nearPairs(rows, bucket, name, min = 0.86) {
  const out = [];
  const byBucket = new Map();
  for (const r of rows) byBucket.set(bucket(r), [...(byBucket.get(bucket(r)) ?? []), r]);
  for (const list of byBucket.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = name(list[i]);
        const b = name(list[j]);
        if (!a || !b || a === b) continue;
        const s = similarity(a, b);
        if (s >= min) out.push({ similarity: Number(s.toFixed(2)), rows: [list[i], list[j]] });
      }
  }
  return out;
}

// ---------------------------------------------------------------- cities
const cityExact = [
  ...groups(cities, (c) => `${c.country_id}|${normAr(c.arabic_name)}`),
  ...groups(cities, (c) => (normEn(c.english_name) ? `${c.country_id}|${normEn(c.english_name)}` : null)),
];
const cityNear = nearPairs(cities, (c) => c.country_id, (c) => normAr(c.arabic_name), 0.8);

// Not-a-city candidates: hotel-shaped names, or nothing a geocoder can find in
// that country. Evidence only — a state like «قدح» is a real place and stays.
async function geocode(name, iso2) {
  if (!name) return null;
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=3&language=en&format=json${iso2 ? `&countryCode=${iso2}` : ""}`;
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    const hit = json.results?.[0];
    return hit ? `${hit.name} (${hit.feature_code ?? "?"}, ${hit.admin1 ?? ""})` : "";
  } catch {
    return null;
  }
}
const notCity = [];
for (const c of cities) {
  const iso2 = countryOf.get(c.country_id)?.iso2 ?? null;
  const hotelish = looksLikeHotel(c.arabic_name) || looksLikeHotel(c.english_name);
  if (!hotelish && c.hotels > 0) continue;
  const geo = await geocode(c.english_name, iso2);
  if (hotelish || geo === "") {
    notCity.push({ ...c, country: countryOf.get(c.country_id)?.arabic_name, hotelish, geocode: geo, drafts: draftRefs(c.id) });
  }
}

// ---------------------------------------------------------------- hotels
const hotelKey = (h) => h.city_id ?? "none";
const hotelGroups = [
  ...groups(hotels, (h) => (normAr(h.arabic_name) ? `${hotelKey(h)}|ar|${normAr(h.arabic_name)}` : null)),
  ...groups(hotels, (h) => (normEn(h.english_name) ? `${hotelKey(h)}|en|${normEn(h.english_name)}` : null)),
];
const hotelNear = nearPairs(hotels, hotelKey, (h) => normAr(h.arabic_name), 0.9);

// ---------------------------------------------------------------- room types
const roomKey = (r) => r.hotel_id ?? "global";
const roomGroups = [
  ...groups(roomTypes, (r) => (normAr(r.arabic_name) ? `${roomKey(r)}|ar|${normAr(r.arabic_name)}` : null)),
  ...groups(roomTypes, (r) => (normEn(r.english_name) ? `${roomKey(r)}|en|${normEn(r.english_name)}` : null)),
];
const roomNear = nearPairs(roomTypes, roomKey, (r) => normAr(r.arabic_name), 0.9);

// ---------------------------------------------------------------- suppliers (legacy, not yet imported)
const load = (t) => {
  const x = JSON.parse(readFileSync(join(root, "data-import/extracted", `${t}.json`), "utf8"));
  return Array.isArray(x) ? x : (x.rows ?? Object.values(x)[0]);
};
const suppliers = load("suppliers").map(({ id, arabic_name, english_name, status }) => ({ id, arabic_name, english_name, status }));
const supplierGroups = [
  ...groups(suppliers, (s) => normEn(s.english_name).replace(/\s+/g, "") || null),
  ...groups(suppliers, (s) => normAr(s.arabic_name)),
];

const label = (rows, f) => rows.map(f);
const out = {
  generated_at: new Date().toISOString(),
  totals: { countries: countries.length, cities: cities.length, hotels: hotels.length, room_types: roomTypes.length },
  cities: {
    exact: cityExact.map((g) => label(g, (c) => ({ ...c, country: countryOf.get(c.country_id)?.arabic_name }))),
    near: cityNear.map((p) => ({ ...p, rows: p.rows.map((c) => ({ ...c, country: countryOf.get(c.country_id)?.arabic_name })) })),
    not_city: notCity,
  },
  hotels: {
    groups: hotelGroups.map((g) => label(g, (h) => ({ ...h, city: cityOf.get(h.city_id)?.arabic_name, drafts: draftRefs(h.id) }))),
    near: hotelNear.map((p) => ({ ...p, rows: p.rows.map((h) => ({ ...h, city: cityOf.get(h.city_id)?.arabic_name, drafts: draftRefs(h.id) })) })),
  },
  room_types: {
    groups: roomGroups.map((g) => label(g, (r) => ({ ...r, drafts: draftRefs(r.id) }))),
    near: roomNear.map((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, drafts: draftRefs(r.id) })) })),
  },
  suppliers: { all: suppliers, groups: supplierGroups },
};

writeFileSync(join(root, "data-import/catalog-candidates.json"), JSON.stringify(out, null, 1));
console.log(
  `cities: ${cityExact.length} exact, ${cityNear.length} near, ${notCity.length} not-a-city candidates\n` +
    `hotels: ${hotelGroups.length} groups, ${hotelNear.length} near pairs\n` +
    `room types: ${roomGroups.length} groups, ${roomNear.length} near pairs\n` +
    `suppliers: ${suppliers.length} legacy, ${supplierGroups.length} duplicate groups\n` +
    "→ data-import/catalog-candidates.json",
);
