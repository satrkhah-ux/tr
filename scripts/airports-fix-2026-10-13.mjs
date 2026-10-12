/**
 * The airports list, put right (2026-10-13, asked by the owner):
 *  - every Saudi airport, each with its city where the city exists — the
 *    company flies its groups out of the Kingdom, Madinah first;
 *  - an airport for the destination cities that had none;
 *  - the missing IANA zones (a flight's duration needs both ends' zones);
 *  - the two false Kuala Lumpur rows (AKU is Aksu in China; KLIA2 is a terminal
 *    of KUL) disabled, and the drafts that named them pointed at KUL.
 *
 * Dry run by default; `--apply` writes. A backup of every airport row and of
 * each draft it touches is written first.
 *
 *   node scripts/airports-fix-2026-10-13.mjs [--apply]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const airports = must(await db.from("airports").select("*"));
const countries = must(await db.from("countries").select("id, arabic_name"));
const cities = must(await db.from("cities").select("id, arabic_name, country_id"));
const countryId = (name) => countries.find((c) => c.arabic_name === name)?.id ?? (() => { throw new Error(`no country ${name}`); })();
const cityId = (country, name) =>
  cities.find((c) => c.country_id === countryId(country) && c.arabic_name === name)?.id ?? (() => { throw new Error(`no city ${country}/${name}`); })();
const byCode = (code) => airports.find((a) => a.code === code);

const SA = "السعوديه";
// ---- 1. airports that serve a city the catalogue already has ----
const links = [
  ["RUH", SA, "الرياض"],
  ["JED", SA, "جدة"],
  ["DMM", SA, "الدمام"],
  ["MED", SA, "المدينة المنورة"],
  ["GIZ", SA, "جيزان"],
  ["BAH", "البحرين", "المنامه"],
  ["NRT", "اليابان", "طوكيو"],
  ["HND", "اليابان", "طوكيو"],
  ["CMB", "سريلانكا", "كولومبو"],
  ["PUS", "كوريا الجنوبية", "بوسان"],
  ["JNB", "جنوب أفريقيا", "جوهانسبرغ"],
  ["CPT", "جنوب أفريقيا", "كيب تاون"],
];
// ---- 2. the missing zones ----
const zones = {
  AJF: "Asia/Riyadh", EAM: "Asia/Riyadh", RAE: "Asia/Riyadh", ULH: "Asia/Riyadh",
  HLP: "Asia/Jakarta", KJT: "Asia/Jakarta", SUB: "Asia/Jakarta", LOP: "Asia/Makassar",
  KBV: "Asia/Bangkok", USM: "Asia/Bangkok", UTP: "Asia/Bangkok",
  NAV: "Europe/Istanbul", RZV: "Europe/Istanbul", KUT: "Asia/Tbilisi",
  DME: "Europe/Moscow", LED: "Europe/Moscow", ZIA: "Europe/Moscow",
  PQC: "Asia/Ho_Chi_Minh", SZB: "Asia/Kuala_Lumpur", IPH: "Asia/Kuala_Lumpur",
};
const renames = { IPH: "مطار السلطان عزلان شاه" };
// ---- 3. the false rows ----
const disable = ["AKU", "KLIA2"];
// ---- 4. new airports: [code, arabic, english, country, city|null, zone] ----
const added = [
  ["BHH", "مطار بيشة", "Bisha Domestic Airport", SA, null, "Asia/Riyadh"],
  ["ABT", "مطار الملك سعود بن عبدالعزيز (الباحة)", "Al-Baha Domestic Airport", SA, null, "Asia/Riyadh"],
  ["HOF", "مطار الأحساء الدولي", "Al-Ahsa International Airport", SA, null, "Asia/Riyadh"],
  ["AQI", "مطار القيصومة (حفر الباطن)", "Al Qaisumah/Hafr Al Batin Airport", SA, null, "Asia/Riyadh"],
  ["TUI", "مطار طريف", "Turaif Domestic Airport", SA, null, "Asia/Riyadh"],
  ["URY", "مطار القريات", "Gurayat Domestic Airport", SA, null, "Asia/Riyadh"],
  ["WAE", "مطار وادي الدواسر", "Wadi al-Dawasir Domestic Airport", SA, null, "Asia/Riyadh"],
  ["DWD", "مطار الملك سلمان (الدوادمي)", "King Salman Domestic Airport (Dawadmi)", SA, null, "Asia/Riyadh"],
  ["RSI", "مطار البحر الأحمر الدولي", "Red Sea International Airport", SA, null, "Asia/Riyadh"],
  ["EJH", "مطار الوجه", "Al Wajh Domestic Airport", SA, null, "Asia/Riyadh"],
  ["SHW", "مطار شرورة", "Sharurah Domestic Airport", SA, null, "Asia/Riyadh"],
  ["RAH", "مطار رفحاء", "Rafha Domestic Airport", SA, null, "Asia/Riyadh"],
  ["GBB", "مطار قبالة الدولي", "Gabala International Airport", "أذربيجان", "غابالا", "Asia/Baku"],
  ["JTR", "مطار سانتوريني", "Santorini (Thira) International Airport", "اليونان", "سانتوريني", "Europe/Athens"],
  ["YIA", "مطار يوجياكارتا الدولي", "Yogyakarta International Airport", "اندونيسيا", "يوجياكارتا", "Asia/Jakarta"],
  ["CEI", "مطار شيانغ راي الدولي", "Mae Fah Luang–Chiang Rai International Airport", "تايلاند", "شيانغ راي", "Asia/Bangkok"],
  ["HHQ", "مطار هوا هين", "Hua Hin Airport", "تايلاند", "هواهين", "Asia/Bangkok"],
  ["ADB", "مطار عدنان مندريس (إزمير)", "Izmir Adnan Menderes Airport", "تركيا", "ازمير", "Europe/Istanbul"],
  ["ESB", "مطار إسنبوغا (أنقرة)", "Ankara Esenboğa Airport", "تركيا", "انقره", "Europe/Istanbul"],
  ["YEI", "مطار بورصة يني شهير", "Bursa Yenişehir Airport", "تركيا", "بورصة", "Europe/Istanbul"],
  ["SZF", "مطار سامسون تشارشامبا", "Samsun-Çarşamba Airport", "تركيا", "سامسون", "Europe/Istanbul"],
  ["OGU", "مطار أوردو - غيرسون", "Ordu–Giresun Airport", "تركيا", "أردو", "Europe/Istanbul"],
  ["DLM", "مطار دالامان (فتحية)", "Dalaman Airport", "تركيا", "فتحية", "Europe/Istanbul"],
  ["AER", "مطار سوتشي الدولي", "Sochi International Airport", "روسيا", "سوتشي", "Europe/Moscow"],
  ["KZN", "مطار قازان الدولي", "Kazan International Airport", "روسيا", "قازان", "Europe/Moscow"],
  ["CJU", "مطار جيجو الدولي", "Jeju International Airport", "كوريا الجنوبية", "جيجو", "Asia/Seoul"],
  ["JHB", "مطار سيناي الدولي (جوهور بارو)", "Senai International Airport", "ماليزيا", "جوهور بارو", "Asia/Kuala_Lumpur"],
  ["BKI", "مطار كوتا كينابالو الدولي", "Kota Kinabalu International Airport", "ماليزيا", "كوتا كينابالو", "Asia/Kuala_Lumpur"],
  ["MKZ", "مطار ملاكا الدولي", "Malacca International Airport", "ماليزيا", "ملاكا", "Asia/Kuala_Lumpur"],
  ["KUA", "مطار السلطان أحمد شاه (كوانتان)", "Sultan Haji Ahmad Shah Airport", "ماليزيا", "كوانتان", "Asia/Kuala_Lumpur"],
  ["TGG", "مطار السلطان محمود (كوالا ترينجانو)", "Sultan Mahmud Airport", "ماليزيا", "ترينجانو", "Asia/Kuala_Lumpur"],
  ["AOR", "مطار السلطان عبدالحليم (ألور ستار)", "Sultan Abdul Halim Airport", "ماليزيا", "قدح", "Asia/Kuala_Lumpur"],
  ["HBE", "مطار برج العرب الدولي (الإسكندرية)", "Borg El Arab International Airport", "مصر", "الاسكندرية", "Africa/Cairo"],
  ["DBB", "مطار العلمين الدولي", "El Alamein International Airport", "مصر", "الساحل الشمالي", "Africa/Cairo"],
];

// ---- 5. drafts that named the false rows ----
const KUL = byCode("KUL");
const kulText = `${KUL.arabic_name} (KUL)`;
const kulCity = cities.find((c) => c.id === KUL.city_id)?.arabic_name ?? "";
const drafts = must(await db.from("offer_drafts").select("id, data"));
const isFalse = (v) => /\((AKU|KLIA2)\)\s*$/.test(v ?? "");
const touched = drafts.filter((d) => (d.data?.flights ?? []).some((f) => isFalse(f.from_airport) || isFalse(f.to_airport)));

// ---- the plan ----
const plan = [];
for (const [code, country, city] of links) {
  const a = byCode(code);
  if (!a) throw new Error(`no airport ${code}`);
  const patch = { city_id: cityId(country, city), country_id: countryId(country) };
  if (a.city_id !== patch.city_id || a.country_id !== patch.country_id) plan.push(["update", code, patch]);
}
for (const [code, zone] of Object.entries(zones)) {
  const a = byCode(code);
  if (!a) throw new Error(`no airport ${code}`);
  const patch = { iana_timezone: zone, ...(renames[code] ? { arabic_name: renames[code] } : {}) };
  if (a.iana_timezone !== zone || (renames[code] && a.arabic_name !== renames[code])) plan.push(["update", code, patch]);
}
for (const code of disable) {
  const a = byCode(code);
  if (a && a.status !== "Disabled") plan.push(["update", code, { status: "Disabled" }]);
}
for (const [code, arabic, english, country, city, zone] of added) {
  if (byCode(code)) {
    console.log(`skip ${code}: already there`);
    continue;
  }
  plan.push([
    "insert",
    code,
    { code, arabic_name: arabic, english_name: english, country_id: countryId(country), city_id: city ? cityId(country, city) : null, iana_timezone: zone, status: "Active" },
  ]);
}

console.log(`${plan.length} airport changes:`);
for (const [op, code, row] of plan) console.log(` ${op} ${code}`, JSON.stringify(row));
console.log(`${touched.length} drafts name AKU/KLIA2 → ${kulText}:`, touched.map((d) => d.id).join(" "));

if (!APPLY) {
  console.log("\ndry run — pass --apply to write");
  process.exit(0);
}

mkdirSync("C:/Users/al3r1/dev/backups", { recursive: true });
const backup = `C:/Users/al3r1/dev/backups/airports-fix-2026-10-13-${Date.now()}.json`;
writeFileSync(backup, JSON.stringify({ airports, drafts: touched }, null, 1));
console.log("backup:", backup);

for (const [op, code, row] of plan) {
  if (op === "insert") must(await db.from("airports").insert(row).select("id"));
  else must(await db.from("airports").update(row).eq("id", byCode(code).id).select("id"));
}
for (const d of touched) {
  const fix = (f, side) =>
    isFalse(f[`${side}_airport`]) ? { [`${side}_airport`]: kulText, [`${side}_tz`]: KUL.iana_timezone, [`${side}_city`]: kulCity } : {};
  const flights = d.data.flights.map((f) => ({ ...f, ...fix(f, "from"), ...fix(f, "to") }));
  must(await db.from("offer_drafts").update({ data: { ...d.data, flights } }).eq("id", d.id).select("id"));
}
console.log("applied");
