// Read-only catalogue research. No availability searches, bookings, or DB writes.
// Credentials stay in memory; output contains public hotel content only.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createHash } from "node:crypto";
import { decryptJson } from "../src/lib/crypto/secrets.ts";

process.loadEnvFile(".env.local");
const root = process.argv[2];
if (!root) throw new Error("Pass a catalogue audit directory containing baseline.json");
const tables = JSON.parse(fs.readFileSync(path.join(root, "baseline.json"))).tables;
const out = path.join(root, "supplier");
fs.mkdirSync(out, { recursive: true });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: [supplier] } = await db.query("select base_url, credentials_encrypted from hotel_suppliers where code = 'tbo' and enabled and environment = 'live'");
await db.end();
if (!supplier) throw new Error("Live supplier unavailable");
const credentials = decryptJson(supplier.credentials_encrypted);
if (!credentials?.username || !credentials?.password) throw new Error("Supplier vault unavailable");
const base = (supplier.base_url || "https://api.tbotechnology.in/TBOHolidays_HotelAPI").replace(/\/+$/, "");
if (!/(^|\.)tbotechnology\.in$/.test(new URL(base).hostname)) throw new Error("Unexpected supplier host");
async function content(method, body, key) {
  const file = path.join(out, `${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  const response = await fetch(`${base}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Supplier HTTP ${response.status}`);
  const data = await response.json();
  if (data.Status?.Code !== 200) throw new Error(`Supplier status ${data.Status?.Code}`);
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}
const fold = (s) => (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases = {
  kutatisi: ["Kutaisi"], qabala: ["Gabala"], quba: ["Quba", "Guba"], ankarah: ["Ankara"], nevshehir: ["Nevsehir"],
  kosamui: ["Koh Samui"], koyaoyai: ["Koh Yao Yai"], halongbay: ["Halong Bay", "Ha Long"],
  sentosaisland: ["Singapore", "Sentosa Island"], selangor: ["Petaling Jaya", "Subang Jaya", "Shah Alam", "Sepang"],
  toscana: ["Khao Yai", "Pak Chong"], banbangflaya: ["Bang Phli", "Samut Prakan"],
  trengganu: ["Kuala Terengganu"], islandsinthailand: ["Koh Phi Phi", "Phi Phi Island", "Ko Phi Phi"],
  makkah: ["Mecca"], napareuli: ["Telavi"],
};
const matchedCities = [], failures = [];
for (const country of tables.countries.filter(c => tables.hotels.some(h => h.country_id === c.id || tables.cities.some(v => v.id === h.city_id && v.country_id === c.id)))) {
  if (!country.iso2) continue;
  try {
    const list = await content("CityList", { CountryCode: country.iso2 }, `cities-${country.iso2}`);
    const cities = tables.cities.filter(c => c.country_id === country.id && tables.hotels.some(h => h.city_id === c.id));
    const codes = new Map();
    for (const city of cities) {
      let names = [city.english_name, ...(aliases[fold(city.english_name)] || [])];
      if (city.arabic_name === "يلوا") names.push("Yalova");
      if (city.arabic_name === "ابانت") names.push("Abant");
      if (city.arabic_name === "جامليهمشين") names.push("Camlihemsin");
      if (city.arabic_name === "Vlašić") names.push("Vlasic");
      const wanted = new Set(names.map(fold).filter(Boolean));
      const hits = (list.CityList || []).filter(c => wanted.has(fold(c.Name)) || wanted.has(fold(c.Name.split(",")[0])));
      matchedCities.push({ id: city.id, name: city.english_name, country: country.iso2, hits });
      for (const hit of hits) codes.set(String(hit.Code), hit);
    }
    for (const [code, city] of codes) {
      try { await content("TBOHotelCodeList", { CityCode: code, IsDetailedResponse: "true" }, `hotels-${country.iso2}-${code}`); }
      catch (e) { failures.push({ country: country.iso2, city: city.Name, error: e.message }); }
    }
    console.log(JSON.stringify({ country: country.iso2, cities: codes.size, failures: failures.length }));
  } catch (e) { failures.push({ country: country.iso2, error: e.message }); }
  fs.writeFileSync(path.join(out, "research.json"), JSON.stringify({ matchedCities, failures }, null, 2));
}
console.log(JSON.stringify({ complete: true, cities: matchedCities.length, failures: failures.length }));

// Identity requires the same country and an unambiguous full hotel name.
// Similar names are kept for manual review; they never write a catalogue row.
const hotelKey = s => fold((s || "").replace(/&/g, "and"));
const byName = new Map();
for (const file of fs.readdirSync(out).filter(f => f.startsWith("hotels-"))) {
  const country = file.split("-")[1];
  for (const hotel of JSON.parse(fs.readFileSync(path.join(out, file))).Hotels || []) {
    const key = `${country}|${hotelKey(hotel.HotelName)}`;
    if (!byName.has(key)) byName.set(key, new Map());
    byName.get(key).set(String(hotel.HotelCode), { ...hotel, _country: country, _file: file });
  }
}
const matches = [];
for (const hotel of tables.hotels) {
  const city = tables.cities.find(c => c.id === hotel.city_id);
  const country = tables.countries.find(c => c.id === (hotel.country_id || city?.country_id))?.iso2;
  const candidates = new Map();
  for (const name of [hotel.english_name, hotel.arabic_name]) {
    if (!hotelKey(name)) continue;
    for (const [code, found] of byName.get(`${country}|${hotelKey(name)}`) || []) candidates.set(code, found);
  }
  if (candidates.size === 1) matches.push({ id: hotel.id, source: [...candidates.values()][0] });
}
const reviewedFile = path.join(root, "reviewed-supplier-matches.json");
if (fs.existsSync(reviewedFile)) {
  for (const match of JSON.parse(fs.readFileSync(reviewedFile))) {
    if (!matches.some(m => m.id === match.id)) matches.push(match);
  }
}
fs.writeFileSync(path.join(root, "supplier-matches.json"), JSON.stringify(matches, null, 2));
console.log(JSON.stringify({ matchedHotels: matches.length }));
for (const language of ["EN"]) {
  const codes = [...new Set(matches.filter(m => language === "EN" || !/[ء-ي]/.test(tables.hotels.find(h => h.id === m.id)?.arabic_name || "")).map(m => String(m.source.HotelCode)))];
  for (let i = 0; i < codes.length; i += 50) {
    const batch = codes.slice(i, i + 50);
    try {
      const key = createHash("sha256").update(batch.join(",")).digest("hex").slice(0,16);
      const result = await content("Hoteldetails", { Hotelcodes: batch.join(","), Language: language }, `details-${language}-${key}`);
      console.log(JSON.stringify({ language, batch: i / 50 + 1, hotels: result.HotelDetails?.length || 0 }));
    } catch (e) { failures.push({ language, batch: i / 50 + 1, error: e.message }); }
  }
}
fs.writeFileSync(path.join(out, "research.json"), JSON.stringify({ matchedCities, failures }, null, 2));
