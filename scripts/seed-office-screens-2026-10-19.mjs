// «الشاشات» — the owner's eleven ads (2026-10-19, 3840×2160 JPGs, one per destination,
// kept at C:\Users\al3r1\dev\traveliun-office-ads\4k; the 8K masters are not for screens).
// Each goes to the private bucket office-screens as the original and a 1920×1080 copy
// (what the TVs get, through pkg), and the settings are written once — a run after the
// page has been used changes nothing.
//   node scripts/seed-office-screens-2026-10-19.mjs [folder]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const DIR = process.argv[2] ?? "C:/Users/al3r1/dev/traveliun-office-ads/4k";
const BUCKET = "office-screens";
const KEY = "office_screens";
// the file names' spelling → the catalogue's (resolvePlace reads the destination from it)
const NAMES = { اذربيجان: "أذربيجان", البانيا: "ألبانيا", اوروبا: "أوروبا" };

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: had } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
if (had) {
  console.log("office_screens is already set — nothing to do");
  process.exit(0);
}
if ((await db.storage.getBucket(BUCKET)).error) {
  const { error } = await db.storage.createBucket(BUCKET, { public: false });
  if (error) throw error;
}
const ads = [];
for (const [i, file] of readdirSync(DIR).filter((f) => /\.jpe?g$/i.test(f)).sort((a, b) => a.localeCompare(b, "ar")).entries()) {
  const raw = file.split(" ")[0];
  const name = NAMES[raw] ?? raw;
  const original = readFileSync(join(DIR, file));
  const copy = await sharp(original).rotate().resize(1920, 1080, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const id = `${(Date.now() + i).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  for (const [path, body] of [[`${id}/original.jpg`, original], [`${id}/1080.jpg`, copy]]) {
    const { error } = await db.storage.from(BUCKET).upload(path, body, { contentType: "image/jpeg" });
    if (error) throw error;
  }
  ads.push({ id, name, active: true });
  console.log(`${name}: ${Math.round(original.length / 1024)} KB → ${Math.round(copy.length / 1024)} KB`);
}
const cfg = { screens: 4, order: [1, 2, 3, 4], slotSec: 12, kinds: ["بكج"], tickerSpeed: 110, ads };
const { error } = await db.from("app_settings").insert({ key: KEY, value: JSON.stringify(cfg) });
if (error) throw error;
console.log(`${ads.length} ads, settings written`);
