// «ربط الجولات بمدنها» — the owner, 2026-10-18. Every one of the tours is filed by
// COUNTRY only (tours.city_id is empty), so a city card in Basic lists every tour of
// the country: Istanbul offered Trabzon's «هضبة هالديزين», Trabzon «جولة البسفور».
//
// READ-ONLY. Suggests, for each tour, the city the client STAYS in when taking it
// (a day trip to Bursa leaves from Istanbul), with the reason, and a corrected name
// where the old PDF import swapped lam-alef («األسماك»). Writes a CSV (UTF-8 with
// BOM, opens in Excel) for the owner to review; nothing is changed in the database.
// The approved file is applied by scripts/tours-city-apply.mjs.
//
// Usage: node scripts/tours-city-suggest.mjs <out.csv>
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/tours-city-suggest.mjs <out.csv>");

const fold = (s) =>
  String(s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, "");

/**
 * Where the client stays for a tour that names a place, not a city. Per country,
 * city → the places its day tours go to (other spellings of the city included).
 * Order matters inside a country: the first city whose word matches wins.
 */
const PLACES = {
  تركيا: {
    طرابزون: ["طرابزون", "اوزنجول", "اوزنغول", "اوزونغول", "اوزون غول", "حيدرنبي", "حيدر نبي", "زيغانا", "سوميلا", "سو ميلا", "هالديزين", "كاراجا", "كيراجا", "همسي", "هامسي", "ريزا", "ريزه", "آيدر", "ايدر", "فرتينا", "اسكيت", "اتاكوي", "أتاكوي", "بوزتبه", "بوستبه", "زاغنوس", "غيريسون", "جيرسون", "بيشيك دوزو", "سيراغول", "تشال", "مزارع الشاي", "مصنع الشاي", "ماشكا", "ما شكا", "السلطان مراد", "تورول", "لمني قول"],
    اسطنبول: ["اسطنبول", "البسفور", "البوسفور", "آيا صوفيا", "ايا صوفيا", "توب كابي", "السلطان أحمد", "السلطان احمد", "دولما", "تشاملجا", "فلوريا", "أمينونو", "امينونو", "الأميرات", "الاميرات", "األميرات", "أورتاكوي", "اورتاكوي", "فيلاند", "السلطان ايوب", "إعمار", "اعمار", "برج البنات", "يلدز", "بورصا", "بورصة", "أولو داغ", "اولو داغ", "صبنجة", "صابنجا", "سابانجا", "معشوقية", "المعشوقية", "ناتوركوي", "كارتبه", "ازميت", "محمودية", "الحلقوم", "السفاري", "الحلقوم"],
    أنطاليا: ["انطاليا", "أنطاليا"],
    بودروم: ["بودروم"],
  },
  ماليزيا: {
    كوالالمبور: ["كوالالمبور", "كوالالبمور", "البرجين التوأمين", "صنوي لاقون", "صنواي", "بوتراجايا", "باتو كيفز", "كهوف باتو", "برجي التوأم", "بتروناس", "سيلانجور", "سيلانغور", "شلالات تشيلينج"],
    "جنتنج هايلاند": ["جنتنج", "جنتينج", "جينتنج"],
    لنكاوي: ["لنكاوي", "لانكاوي"],
    بينانج: ["بينانج", "بينانغ"],
    "كاميرون هايلاند": ["كاميرون"],
    ملاكا: ["ملاكا", "مالاكا"],
    "كوتا كينابالو": ["كينابالو", "كوتا"],
    "جوهور بارو": ["جوهور", "ليجولاند", "ليغولاند"],
    ايبوه: ["ايبوه"],
    كوانتان: ["كوانتان"],
    ترينجانو: ["ترينجانو", "ردانج"],
    "بورت ديكسون": ["ديكسون"],
  },
  اندونيسيا: {
    بالي: ["بالي", "لوفينا", "اوبود", "تاناه لوت", "كينتاماني", "نوسا", "كوتا بالي", "اولواتو", "تيغالالانغ"],
    بونشاك: ["بونشاك", "تلاقاسات", "بنشاك", "تامان سفاري", "سفاري", "بوجور", "بوقور"],
    باندونج: ["باندونج", "باندونغ", "ليمبانغ", "تانغكوبان", "كاوه بوتيه"],
    جاكرتا: ["جاكرتا", "تامان ميني", "راغونان", "سيتو باباكان", "جكرتا", "انكول", "مونس"],
    لومبوك: ["لومبوك", "جيلي"],
    يوجياكارتا: ["يوجيا", "بوروبودور", "برامبانان"],
  },
  تايلاند: {
    بانكوك: ["بانكوك", "السوق العائم", "دريم وورلد", "سفاري وورلد", "القصر الملكي", "ايوثايا", "أيوثايا"],
    فوكيت: ["فوكيت", "بوكيت", "بي بي ايلاند", "سيميلان", "كاتا", "بان ناه", "فوكت", "فاي فاي", "في في", "جيمس بوند", "كورال", "باتونغ"],
    باتايا: ["باتايا", "بتايا", "نونج نوتش", "نونغ نوش", "كوه لان", "الجزيرة المرجانية"],
    كرابي: ["كرابي", "الجزر الأربع", "الجزر الاربع", "فرانانغ"],
    "شيانغ ماي": ["شيانغ ماي", "شنغماي", "تشيانغ ماي"],
    "كوه ساموي": ["ساموي"],
  },
  جورجيا: {
    تبليسي: ["تبليسي", "متسخيتا", "كازبيجي", "غودوري", "جفاري", "انانوري", "سغناغي", "كاخيتي"],
    باتومي: ["باتومي"],
    برجومي: ["برجومي", "بورجومي"],
    كوتايسي: ["كوتايسي", "بروميثيوس", "مارتفيلي", "اوكاتسي"],
    باكورياني: ["باكورياني"],
    غودواري: ["غودواري", "جودوري"],
  },
  أذربيجان: {
    غابالا: ["غابالا", "قبالا", "قابالا", "نوهور", "تفنديغ"],
    قوبا: ["قوبا", "قوبه", "شاهداغ", "تنغيالتي"],
    باكو: ["باكو", "غوبوستان", "قوبوستان", "يانار داغ", "اتشغاه", "البلدة القديمة"],
  },
  "البوسنة والهرسك": {
    موستار: ["موستار", "كرافيتسا", "بوتشيتل", "بلاغاي"],
    سرييفو: ["سراييفو", "سرييفو", "سرايفو", "ترابيفيتش", "ياهورينا"],
    بيهاتش: ["بيهاتش"],
  },
  فيتنام: {
    "دا نانج": ["دا نانج", "دانانغ", "بانا هلز", "بانا هيلز", "جسر التنين", "جبال الرخام", "كهوف الرخام", "الجسر الذهبي", "جسر الذهب", "القرية الفرنسية", "مي خي"],
    سابا: ["سابا", "فنسيبان", "هام رونغ"],
    "نينه بينة": ["نينه بينة", "نينه بينه", "تام كوك", "ninh binh"],
    "هو تشي منه": ["هو تشي منه", "سوي تين", "نوتردام", "suoi tien"],
    "خليج هالونج": ["هالونج", "ها لونج", "halong"],
    "فو كوك": ["فو كوك", "phu quoc"],
    "هوي آن": ["هوي آن", "هوي ان"],
    هانوي: ["هانوي"],
  },
  سنغافورة: {
    "جزيرة سنتوسا": ["سنتوسا"],
    سنغافورة: ["سنغافورة"],
  },
};

/** The old PDF import swapped lam-alef: «األسماك» for «الأسماك». Only the patterns seen in the list. */
function fixName(name) {
  return name
    .replace(/األ/g, "الأ")
    .replace(/اإل/g, "الإ")
    .replace(/االنزالق/g, "الانزلاق")
    .replace(/االنزلاق/g, "الانزلاق")
    .replace(/الشالالت/g, "الشلالات")
    .replace(/شالالت/g, "شلالات")
    .replace(/الشالل/g, "الشلال")
    .replace(/شالل/g, "شلال");
}

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const tours = (
  await c.query(`select t.id, t.arabic_name, co.arabic_name country from tours t left join countries co on co.id = t.country_id order by co.arabic_name, t.arabic_name`)
).rows;
const cities = (await c.query(`select ci.id, ci.arabic_name, co.arabic_name country from cities ci join countries co on co.id = ci.country_id`)).rows;
await c.end();

const cityIn = (country, name) => cities.find((x) => x.country === country && fold(x.arabic_name) === fold(name));
const rows = [["id", "الدولة", "الجولة", "المدينة المقترحة", "city_id", "السبب", "اسم مصحَّح (إن لزم)"]];
const counts = { suggested: 0, none: 0, fixed: 0 };
for (const t of tours) {
  const name = t.arabic_name ?? "";
  const f = fold(fixName(name));
  let pick = null;
  let why = "";
  // 1. a place its day tours go to — the city the client STAYS in (Ayder and Uzungöl are trips from Trabzon)
  for (const [city, words] of Object.entries(PLACES[t.country] ?? {})) {
    const word = words.find((w) => f.includes(fold(w)));
    if (word) {
      pick = cityIn(t.country, city);
      why = pick ? `«${word}» — رحلة من ${city}` : `«${word}» — ${city} غير موجودة في المدن`;
      break;
    }
  }
  // 2. else a city of its country named in it — longest name first («جوهور بارو» before «جوهر»)
  if (!pick) {
    const named = cities
      .filter((x) => x.country === t.country && fold(x.arabic_name).length >= 3 && f.includes(fold(x.arabic_name)))
      .sort((a, b) => fold(b.arabic_name).length - fold(a.arabic_name).length)[0];
    if (named) {
      pick = named;
      why = `يذكر «${named.arabic_name}»`;
    }
  }
  const fixed = fixName(name);
  if (fixed !== name) counts.fixed += 1;
  if (pick) counts.suggested += 1;
  else counts.none += 1;
  rows.push([t.id, t.country ?? "", name, pick?.arabic_name ?? "", pick?.id ?? "", why || "لا يذكر مدينة ولا مكاناً معروفاً — تبقى للدولة كلها", fixed !== name ? fixed : ""]);
}

const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
writeFileSync(out, "﻿" + csv, "utf8");
console.log(JSON.stringify({ tours: tours.length, ...counts, out }));
