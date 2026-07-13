// Seeds editorial monthly climate notes for every existing city (12 rows each),
// using a country-based profile. Idempotent (upsert on city_id + month) — admins
// refine the values later in the /setting/climate screen.
// Usage: node scripts/seed-climate.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch {
    /* rely on the real environment */
  }
}
loadEnv();

const TROPICAL = new Set(["ماليزيا", "تايلند", "إندونيسيا", "سنغافورة", "الفلبين", "سريلانكا", "المالديف", "فيتنام"]);
const SEASONAL = new Set(["تركيا", "جورجيا", "أذربيجان", "اليابان", "كوريا الجنوبية", "البوسنة والهرسك", "ألبانيا"]);

// northern-hemisphere temperate curve, indexed by month-1
const SEASONAL_HIGH = [9, 11, 15, 20, 25, 30, 32, 32, 27, 21, 15, 10];
const SEASONAL_LOW = [2, 3, 6, 10, 14, 19, 22, 22, 17, 12, 7, 4];
const SEASONAL_RAIN = ["high", "high", "medium", "medium", "low", "low", "low", "low", "low", "medium", "high", "high"];
const SEASONAL_HUM = ["high", "high", "medium", "medium", "medium", "low", "low", "low", "medium", "medium", "high", "high"];

function profile(country, month) {
  const i = month - 1;
  if (SEASONAL.has(country)) {
    const cold = month <= 2 || month >= 11;
    const hot = month >= 6 && month <= 8;
    return {
      high: SEASONAL_HIGH[i],
      low: SEASONAL_LOW[i],
      rain: SEASONAL_RAIN[i],
      hum: SEASONAL_HUM[i],
      ar: cold
        ? "أجواء باردة، خذ ملابس شتوية ومعطفاً."
        : hot
          ? "أجواء دافئة إلى حارة، ملابس صيفية خفيفة."
          : "أجواء معتدلة، طبقات خفيفة مناسبة.",
      en: cold ? "Cold; pack winter clothing and a coat." : hot ? "Warm to hot; light summer clothing." : "Mild; light layers recommended.",
    };
  }
  if (TROPICAL.has(country)) {
    const monsoon = month >= 10 || month <= 1;
    return {
      high: 32,
      low: 24,
      rain: monsoon ? "high" : "medium",
      hum: "high",
      ar: monsoon
        ? "حار ورطب مع أمطار متكررة، خذ مظلة وملابس قطنية خفيفة."
        : "حار ورطب، ملابس قطنية خفيفة وواقٍ من الشمس.",
      en: monsoon ? "Hot, humid, frequent rain; bring an umbrella and light cotton." : "Hot and humid; light cotton and sunscreen.",
    };
  }
  return {
    high: 25,
    low: 15,
    rain: "medium",
    hum: "medium",
    ar: "أجواء معتدلة بشكل عام، ملابس متوسطة مناسبة.",
    en: "Generally mild; medium-weight clothing is fine.",
  };
}

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const { rows: cities } = await client.query(
    "select c.id, co.arabic_name as country from public.cities c left join public.countries co on co.id = c.country_id order by c.arabic_name",
  );

  let total = 0;
  for (const city of cities) {
    const params = [];
    const tuples = [];
    let idx = 1;
    for (let month = 1; month <= 12; month += 1) {
      const p = profile(city.country ?? "", month);
      tuples.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      params.push(city.id, month, p.high, p.low, p.rain, p.hum, p.ar, p.en);
    }
    await client.query(
      `insert into public.city_climate_notes
         (city_id, month, avg_high_c, avg_low_c, rain_level, humidity_level, advice_ar, advice_en)
       values ${tuples.join(",")}
       on conflict (city_id, month) do update set
         avg_high_c = excluded.avg_high_c,
         avg_low_c = excluded.avg_low_c,
         rain_level = excluded.rain_level,
         humidity_level = excluded.humidity_level,
         advice_ar = excluded.advice_ar,
         advice_en = excluded.advice_en,
         updated_at = now()`,
      params,
    );
    total += 12;
  }
  console.log(`✓ seeded ${total} climate rows across ${cities.length} cities`);
} catch (error) {
  console.error(`✗ climate seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
