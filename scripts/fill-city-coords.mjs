// Fill cities.lat/lng once, from the English name + the country's ISO code.
//
// Usage: node scripts/fill-city-coords.mjs            (dry run: prints what it found)
//        node scripts/fill-city-coords.mjs --write    (writes rows that have no coords yet)
//
// The ranking (src/lib/providers/geo-rank.ts) refuses near-miss names, so a city
// the geocoder cannot name is reported, not guessed. Those few are in KNOWN.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { bestGeoHit } from "../src/lib/providers/geo-rank.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const env = readFileSync(join(root, ".env.local"), "utf8");
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");

/** States and spellings no geocoder resolves: their capital / main town. */
const KNOWN = {
  Kedah: [6.1184, 100.3685], // Alor Setar
  Trengganu: [5.3302, 103.1408], // Kuala Terengganu
  Johor: [1.4927, 103.7414], // Johor Bahru
  "Cameron Highlands": [4.4721, 101.3801], // Tanah Rata
  Makkah: [21.4225, 39.8262],
  Madinah: [24.4672, 39.6024],
  Hail: [27.5114, 41.7208],
  AlUla: [26.6085, 37.9232],
  AlJouf: [29.9697, 40.2064], // Sakaka
  Qassim: [26.3260, 43.9750], // Buraydah
  "Saint Petersburg": [59.9311, 30.3609],
  "Ha Long Bay": [20.9101, 107.1839],
  Cappadocia: [38.6431, 34.8289], // Göreme
  ankarah: [39.9334, 32.8597],
  nevshehir: [38.6244, 34.7144],
  Sabanja: [40.6914, 30.2674], // Sapanca
  Kutatisi: [42.2679, 42.6946], // Kutaisi
  "North Coast": [30.8333, 28.95], // El Alamein
  "Gili Islands": [-8.3500, 116.0400],
  "Islands in Thailand": [7.7407, 98.7784], // Phi Phi
  "Lop Buri": [14.7995, 100.6534],
  "Kaluga Oblast": [54.5293, 36.2754], // Kaluga
};

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
const rows = (
  await db.query(`select c.id, c.arabic_name, c.english_name, co.iso2
    from cities c left join countries co on co.id = c.country_id
    where c.lat is null order by co.iso2, c.arabic_name`)
).rows;

const misses = [];
for (const c of rows) {
  let at = KNOWN[c.english_name?.trim()] ?? null;
  let label = at ? "known" : "";
  if (!at && c.english_name) {
    const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c.english_name)}&count=10&language=en&format=json${c.iso2 ? `&countryCode=${c.iso2}` : ""}`;
    const res = await fetch(u, { signal: AbortSignal.timeout(9000) }).then((r) => r.json()).catch(() => null);
    const hit = bestGeoHit(c.english_name, res?.results ?? []);
    if (hit) {
      at = [hit.latitude, hit.longitude];
      label = `${hit.name} [${hit.feature_code ?? "?"}]`;
    }
  }
  if (!at) {
    misses.push(`${c.arabic_name} | ${c.english_name ?? "—"} (${c.iso2 ?? "?"})`);
    continue;
  }
  console.log(`${c.iso2 ?? "??"}  ${c.arabic_name} → ${label} ${at[0]},${at[1]}`);
  if (WRITE) await db.query("update public.cities set lat = $2, lng = $3 where id = $1 and lat is null", [c.id, at[0], at[1]]);
}
await db.end();
console.log(`\n${rows.length - misses.length}/${rows.length} resolved${WRITE ? " and written" : " (dry run)"}`);
if (misses.length) console.log(`unresolved:\n  ${misses.join("\n  ")}`);
