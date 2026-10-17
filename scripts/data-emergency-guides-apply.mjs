// «دليل الطوارئ» per destination (destination_guides) for the countries most used today,
// with the Saudi embassy in each — researched 2026-10-17.
//
// Sources: the Saudi embassies' official platform (https://<cc>.saudiembassy.sa/en/Embassy/Pages/ContactInfo.aspx,
// where mofa.gov.sa now redirects) for every embassy/consulate number; the UK government's travel
// advice «getting help» pages and each country's official site for police/ambulance; the hospitals'
// own sites or the UK government's medical-facility lists for the hospital lines.
// Numbers change — re-check against those pages before relying on one.
//
// Usage: node scripts/data-emergency-guides-apply.mjs           (dry run)
//        node scripts/data-emergency-guides-apply.mjs --write   (fills EMPTY fields only — a manager's own entry is never overwritten)
//
// `police`, `ambulance` and `embassy_phone` hold ONE dialable number each: the trip page links them as tel:.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);

const MOFA = "مركز اتصال وزارة الخارجية: +966 92 003 3334";
const lines = (...l) => [...l.filter(Boolean), MOFA].join("\n");

/** country (as in the countries table) → the guide */
const GUIDES = {
  "ماليزيا": {
    police: "999", ambulance: "999", embassy_phone: "+60 3 4257 9825",
    hospital: "مركز برنس كورت الطبي (Prince Court Medical Centre) — كوالالمبور — +60 3 2160 0000، طوارئ +60 3 2160 0999",
    notes: lines("999 رقم واحد للشرطة والإسعاف والإطفاء", "طوارئ السفارة السعودية في كوالالمبور: +60 12 319 9854"),
  },
  "تايلاند": {
    police: "191", ambulance: "1669", embassy_phone: "+66 2 639 2999",
    hospital: "مستشفى بومرنغراد الدولي (Bumrungrad) — بانكوك — +66 2 066 8888",
    notes: lines("شرطة السياحة: 1155", "طوارئ السفارة السعودية في بانكوك: +66 88 500 5353 / +66 62 505 4499"),
  },
  "اندونيسيا": {
    police: "110", ambulance: "119", embassy_phone: "+62 21 2809 4073",
    hospital: "مستشفى BIMC كوتا (BIMC Hospital Kuta) — بالي — +62 361 761263",
    notes: lines("الرقم الموحد للطوارئ: 112", "رقم آخر للسفارة السعودية في جاكرتا: +62 812 8780 2942"),
  },
  "تركيا": {
    police: "112", ambulance: "112", embassy_phone: "+90 312 468 55 40",
    hospital: "المستشفى الأمريكي (Amerikan Hastanesi) — إسطنبول — +90 212 444 3 777",
    notes: lines(
      "112 رقم واحد للشرطة والإسعاف والإطفاء",
      "طوارئ السفارة السعودية في أنقرة: +90 549 564 66 55",
      "القنصلية السعودية في إسطنبول: +90 212 281 91 40 (طوارئ +90 530 955 21 20)",
    ),
  },
  "فيتنام": {
    police: "113", ambulance: "115", embassy_phone: "+84 24 3726 4373",
    hospital: "مستشفى فينمك تايمز سيتي الدولي (Vinmec Times City) — هانوي — +84 24 3974 3556",
    notes: lines("الإطفاء: 114", "طوارئ السفارة السعودية في هانوي: +84 91 663 2926"),
  },
  "جورجيا": {
    police: "112", ambulance: "112", embassy_phone: "+995 32 200 95 04",
    hospital: "ميدي كلوب جورجيا (MediClub Georgia) — تبليسي — +995 322 251991",
    notes: lines("112 رقم واحد للشرطة والإسعاف والإطفاء", "طوارئ السفارة السعودية في تبليسي: +995 598 03 33 00"),
  },
  "أذربيجان": {
    police: "102", ambulance: "103", embassy_phone: "+994 12 497 23 05",
    hospital: "المستشفى السريري المركزي (Central Clinical Hospital) — باكو — +994 12 492 10 92",
    notes: lines("الرقم الموحد للطوارئ: 112", "طوارئ السفارة السعودية في باكو: +994 50 367 11 00"),
  },
  "سنغافورة": {
    police: "999", ambulance: "995", embassy_phone: "+65 6734 5876",
    hospital: "مستشفى ماونت إليزابيث (Mount Elizabeth Orchard) — +65 6250 0000، طوارئ +65 6731 2218",
    notes: lines("طوارئ السفارة السعودية في سنغافورة: +65 9777 4484"),
  },
  "البوسنة والهرسك": {
    police: "122", ambulance: "124", embassy_phone: "+387 33 215 266",
    hospital: "المركز السريري لجامعة سراييفو (KCUS — حكومي) — سراييفو — +387 33 29 70 00",
    notes: lines("الإطفاء: 123", "طوارئ السفارة السعودية في سراييفو: +387 62 404 140"),
  },
  "الإمارات العربية المتحدة": {
    police: "999", ambulance: "998", embassy_phone: "+971 2 444 5700",
    hospital: "المستشفى الأمريكي (American Hospital Dubai) — دبي — +971 4 377 5500",
    notes: lines(
      "شرطة دبي لغير الطوارئ والسياحة: 901",
      "طوارئ السفارة السعودية في أبوظبي: +971 50 800 7718",
      "القنصلية السعودية في دبي: +971 4 377 8300 (طوارئ +971 50 452 2258)",
    ),
  },
  "المملكة المتحدة": {
    police: "999", ambulance: "999", embassy_phone: "+44 20 7917 3000",
    hospital: "مستشفى كرومويل (Cromwell Hospital) — لندن — +44 20 7460 5700",
    notes: lines("999 أو 112 للشرطة والإسعاف والإطفاء", "طوارئ السفارة السعودية في لندن: +44 20 7917 3218"),
  },
  "روسيا": {
    police: "102", ambulance: "103", embassy_phone: "+7 499 245 7007",
    hospital: "المركز الطبي الأوروبي (EMC) — موسكو — +7 495 933 6655",
    notes: lines("الرقم الموحد للطوارئ: 112", "طوارئ السفارة السعودية في موسكو: +7 917 511 0815"),
  },
  "مصر": {
    police: "122", ambulance: "123", embassy_phone: "+20 2 3333 1100",
    hospital: "مستشفى السلام الدولي — المعادي، القاهرة — الخط الساخن 19885",
    notes: lines(
      "شرطة السياحة: 126",
      "طوارئ السفارة السعودية في القاهرة: +20 112 099 5566 / +20 111 511 1819",
      "القنصلية السعودية في الإسكندرية: +20 3 497 7590",
    ),
  },
  "كوريا الجنوبية": {
    police: "112", ambulance: "119", embassy_phone: "+82 2 739 0631",
    hospital: "مستشفى سيفرانس — مركز الرعاية الدولية — سيول — +82 2 2228 5800",
    notes: lines("خط مساعدة السياح: 1330", "طوارئ السفارة السعودية في سيول: +82 10 8962 6999"),
  },
  "جنوب أفريقيا": {
    police: "10111", ambulance: "10177", embassy_phone: "+27 12 362 4233",
    hospital: "مستشفى نتكير كريستيان بارنارد — كيب تاون — +27 21 441 0000",
    notes: lines("من الجوال: 112", "طوارئ السفارة السعودية في بريتوريا: +27 71 000 0017"),
  },
  "المالديف": {
    police: "911", ambulance: "911", embassy_phone: "+960 333 3741",
    hospital: "مستشفى ADK — ماليه — +960 313 5555 (خط 24 ساعة 1440)",
    notes: lines("911 الرقم الموحد للطوارئ", "شرطة السياحة: 1478", "طوارئ السفارة السعودية في ماليه: +960 796 0499"),
  },
  "موريشيوس": {
    police: "999", ambulance: "114", embassy_phone: "+230 467 0078",
    hospital: "مستشفى سي-كير دارنيه (C-Care Darné) — فلوريال — +230 601 2300",
    notes: lines("طوارئ السفارة السعودية في إيبين: +230 5940 5959"),
  },
};

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const countries = new Map((await db.query("select id, arabic_name from countries")).rows.map((r) => [r.arabic_name, r.id]));
const FIELDS = ["police", "ambulance", "embassy_phone", "hospital", "notes"];
for (const [name, g] of Object.entries(GUIDES)) {
  const id = countries.get(name);
  if (!id) {
    console.log(`! ${name}: no such country`);
    continue;
  }
  const have = (await db.query("select * from destination_guides where country_id = $1", [id])).rows[0] ?? {};
  const fill = Object.fromEntries(FIELDS.filter((f) => !String(have[f] ?? "").trim()).map((f) => [f, g[f]]));
  console.log(`${WRITE ? "+" : "-"} ${name}: ${Object.keys(fill).join(", ") || "nothing empty"}`);
  if (!WRITE || Object.keys(fill).length === 0) continue;
  const cols = Object.keys(fill);
  await db.query(
    `insert into destination_guides (country_id, ${cols.join(", ")}, updated_at) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}, now())
     on conflict (country_id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = now()`,
    [id, ...cols.map((c) => fill[c])],
  );
}
await db.end();
