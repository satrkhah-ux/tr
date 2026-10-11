// Give every airport its city (airports.city_id), so the generator can turn
// «landed at LGK» into «the next city is لنكاوي».
//
// Usage: node scripts/link-airport-cities.mjs            (dry run)
//        node scripts/link-airport-cities.mjs --write    (only fills airports with no city yet)
//
// Matched inside the airport's own country, by the city's name appearing in
// the airport's name (Arabic or English). Airports named after a person or a
// district («Suvarnabhumi», «Sabiha Gokcen») are in BY_CODE.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { normAr, normEn } from "../src/lib/catalog/norm.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const env = readFileSync(join(root, ".env.local"), "utf8");
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");

/** IATA code → the city's Arabic name in our catalogue. */
const BY_CODE = {
  BKK: "بانكوك",
  DMK: "بانكوك",
  CGK: "جاكرتا",
  DPS: "بالي",
  SAW: "اسطنبول",
  IST: "اسطنبول",
  HKT: "فوكيت",
  KUL: "كوالالمبور",
  SZB: "كوالالمبور",
  SIN: "سنغافورة",
  HAN: "هانوي",
  SGN: "هو تشي منه",
  DOH: "الدوحة",
  MNL: "مانيلا",
  GYD: "باكو",
  MLE: "ماليه",
  ICN: "سيول",
};

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
const airports = (
  await db.query(`select a.id, a.code, a.arabic_name, a.english_name, a.country_id, co.arabic_name country
    from airports a left join countries co on co.id = a.country_id where a.city_id is null order by co.arabic_name, a.code`)
).rows;
const cities = (await db.query("select id, arabic_name, english_name, country_id from cities")).rows;

const misses = [];
for (const a of airports) {
  const local = cities.filter((c) => c.country_id === a.country_id);
  let city = BY_CODE[a.code] ? local.find((c) => normAr(c.arabic_name) === normAr(BY_CODE[a.code])) : null;
  if (!city) {
    const ar = normAr(a.arabic_name);
    const en = normEn(a.english_name);
    // the LONGEST matching name wins: «كوالالمبور» inside «مطار كوالالمبور الدولي»
    // must beat a two-letter city that happens to appear too
    city =
      local
        .filter((c) => (normAr(c.arabic_name) && ar.includes(normAr(c.arabic_name))) || (normEn(c.english_name) && en.includes(normEn(c.english_name))))
        .sort((x, y) => y.arabic_name.length - x.arabic_name.length)[0] ?? null;
  }
  if (!city) {
    misses.push(`${a.code} ${a.arabic_name} (${a.country ?? "?"})`);
    continue;
  }
  console.log(`${a.code}  ${a.arabic_name} → ${city.arabic_name}`);
  if (WRITE) await db.query("update public.airports set city_id = $2 where id = $1 and city_id is null", [a.id, city.id]);
}
await db.end();
console.log(`\n${airports.length - misses.length}/${airports.length} linked${WRITE ? "" : " (dry run)"}`);
if (misses.length) console.log(`no city found:\n  ${misses.join("\n  ")}`);
