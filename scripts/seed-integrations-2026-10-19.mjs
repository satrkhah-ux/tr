// «الربط الخارجي» — the first list (the owner, 2026-10-19), each item verified on the
// servers that day: env var NAMES from the live .env files (never a value), the
// containers, the crontabs, the bots' usernames. Inserts what is not there yet
// (by name) and never overwrites a row someone has since edited on the page.
//   node scripts/seed-integrations-2026-10-19.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const R = (name, kind, o = {}) => ({ name, kind, ...o });
const ROWS = [
  // ---------- servers ----------
  R("خادم vps-new (186.241.16.106)", "server", {
    used_by: "pkg.traveliun.com (traveliun-app)، بوت ترافليون (traveliun-bot :8787)، Supabase، n8n، Coolify، acctrav، sufra، shaamcx-demo، server-hub",
    secret_ref: "ssh deploy@vps-new (ومستخدم root)",
    notes: "مؤقتات: supabase-backup 03:30 UTC، sofra-backup؛ acme.sh يجدد الشهادة؛ crontab المستخدم deploy يشغّل مهام النظام المجدولة",
  }),
  R("خادم vps-deploy القديم (187.124.112.104)", "server", {
    used_by: "Coolify، Teletel (nginx)، dababa، station، muhta، shaamcx-demo؛ نسخة traveliun-app قديمة؛ Supabase قديم (متوقف)",
    secret_ref: "ssh vps-deploy",
    notes: "crontab ‏deploy يستدعي /api/eye/daily 17:00 UTC (مكرر — محمي)؛ عليه supabase-backup.timer أيضاً؛ تحت المراجعة",
  }),
  // ---------- database ----------
  R("قاعدة البيانات (Supabase ذاتية الاستضافة)", "database", { used_by: "النظام كله", secret_ref: "SUPABASE_DB_URL، SUPABASE_SERVICE_ROLE_KEY، NEXT_PUBLIC_SUPABASE_ANON_KEY، NEXT_PUBLIC_SUPABASE_URL", check_key: "db" }),
  R("تسجيل الدخول (Supabase Auth)", "database", { used_by: "دخول الموظفين والشركاء", secret_ref: "SUPABASE_SERVICE_ROLE_KEY", check_key: "auth" }),
  R("الملفات (Supabase Storage)", "database", { used_by: "الجوازات، الأدلة، المرفقات، تصاميم العروض الجاهزة (ready-designs)", secret_ref: "SUPABASE_SERVICE_ROLE_KEY", check_key: "storage" }),
  R("النسخ الاحتياطي اليومي (supabase-backup)", "cron", { used_by: "قاعدة البيانات", secret_ref: "systemd timer على vps-new 03:30 UTC", notes: "آخر تشغيل ناجح 2026-10-19 03:30 UTC — لا فحص آلي من النظام بعد" }),
  // ---------- APIs ----------
  R("OpenAI", "api", { used_by: "مُراد، المستقبل الآلي، البرنامج اليومي، قراءة الجوازات/OCR", secret_ref: "OPENAI_API_KEY", check_key: "openai", notes: "ANTHROPIC_API_KEY غير مضبوط" }),
  R("AviationStack (الرحلات)", "api", { used_by: "بحث الرحلات ومتابعتها", secret_ref: "AVIATIONSTACK_API_KEY", check_key: "aviationstack" }),
  R("Open-Meteo (الطقس)", "api", { used_by: "الطقس في البرنامج اليومي", secret_ref: "بلا مفتاح", check_key: "weather" }),
  R("أسعار العملات (exchange-api / open.er-api)", "api", { used_by: "التسعير — والدولار بسعر الشركة من «سياسة الربح»", secret_ref: "بلا مفتاح", check_key: "rates" }),
  R("Teletel (Chatwoot)", "api", {
    used_by: "العملاء، مُراد، المستقبل الآلي، رسائل واتساب، SLA",
    secret_ref: "TELETEL_BASE_URL، TELETEL_API_TOKEN، TELETEL_ACCOUNT_ID",
    account: "توكن «احمد الرفاعي»",
    check_key: "teletel",
    notes: "Webhook: /api/teletel/webhook (رسالة جديدة)؛ نفس التوكن في بوت ترافليون (CHATWOOT_TOKEN)",
  }),
  R("موردو الفنادق (TBO + التجريبي)", "api", { used_by: "أسعار الفنادق من الموردين", secret_ref: "جدول hotel_suppliers (مشفر) + SETTINGS_ENCRYPTION_KEY", check_key: "suppliers" }),
  R("المسافر — عرض تجريبي", "api", { used_by: "عرض الإدارة", secret_ref: "ALMOSAFER_DEMO" }),
  R("سكربت Google Ads", "script", {
    used_by: "بوت الإعلانات (@atraveliunbot) و«رؤية للإعلانات»",
    account: "al.3r18y@gmail.com — ocid 1441849826",
    secret_ref: "داخل حساب Google Ads: مفتاح البوت (ADS_HOOK_KEY في ملف البوت) ومفتاح /api/ads/hook (مشتق من ADMIN_API_SECRET)",
    check_key: "ads_fresh",
    notes: "النسخة 2 (docs/ads/traveliun-ads-script.js) كل ساعة؛ القديمة لم تكن ترى حملات «ماكس»",
  }),
  R("إنتاج PDF (Chromium)", "service", { used_by: "ملفات العروض والقسائم", secret_ref: "داخل صورة التطبيق", check_key: "pdf" }),
  // ---------- bots ----------
  R("@spytraveliunbot — عين الإدارة", "bot", { used_by: "التقرير اليومي للإدارة وتنبيهات «الربط الخارجي»", secret_ref: "TELEGRAM_EYE_BOT_TOKEN، TELEGRAM_EYE_WEBHOOK_SECRET", check_key: "bot_eye" }),
  R("@traveliunopbot — العمليات", "bot", { used_by: "ملخص العمليات وتنبيهاتها", secret_ref: "TELEGRAM_OPS_BOT_TOKEN، TELEGRAM_OPS_WEBHOOK_SECRET", check_key: "bot_ops" }),
  R("@TraveliunAppbot — تطبيق تيليجرام", "bot", { used_by: "الدخول من تيليجرام (/tg)", secret_ref: "TELEGRAM_WEBAPP_BOT_TOKEN", check_key: "bot_app" }),
  R("@atraveliunbot — بوت ترافليون (خارجي)", "bot", {
    used_by: "الإعلانات، المحادثات، التنبيهات — حاوية traveliun-bot على vps-new",
    secret_ref: "/home/deploy/apps/traveliun-bot/.env (BOT_TOKEN، OPENAI_KEY، CHATWOOT_TOKEN، ADS_HOOK_KEY)",
    check_key: "bot_external",
    notes: "منفذ الإعلانات 8787؛ أُصلح توكن Teletel فيه 2026-10-19",
  }),
  R("@plamxbot — بوت قالب PalmX", "bot", { used_by: "/api/telegram/webhook من القالب القديم", secret_ref: "TELEGRAM_BOT_TOKEN، TELEGRAM_WEBHOOK_SECRET", unused: true, notes: "ليس من ترافليون — للحذف بقرار المالك" }),
  // ---------- sheets ----------
  R("شيت العروض الجاهزة", "sheet", { used_by: "«العروض الجاهزة»", secret_ref: "app_settings ready_offers_sheet (أو READY_OFFERS_SHEET_ID)", check_key: "sheet_ready_offers" }),
  R("شيت المحادثات (العملاء)", "sheet", { used_by: "«العملاء» قبل Teletel", secret_ref: "LEADS_SHEET_ID (وإلا الافتراضي في الكود)، LEADS_SHEET_WEBHOOK", check_key: "sheet_leads" }),
  // ---------- scheduled jobs (crontab of deploy on vps-new) ----------
  R("/api/murad/run — كل دقيقة", "cron", { used_by: "مُراد والمستقبل الآلي وفحوص «الربط الخارجي»", secret_ref: "crontab ‏deploy@vps-new + ADMIN_API_SECRET", check_key: "job_murad" }),
  R("/api/leads/pull — كل 5 دقائق", "cron", { used_by: "«العملاء» من Teletel", secret_ref: "crontab ‏deploy@vps-new + ADMIN_API_SECRET", check_key: "job_leads_pull" }),
  R("/api/ops/flights — كل 30 دقيقة", "cron", { used_by: "متابعة الرحلات في العمليات", secret_ref: "crontab ‏deploy@vps-new + ADMIN_API_SECRET", check_key: "job_ops_flights" }),
  R("/api/ops/daily — 04:00 UTC", "cron", { used_by: "مهام العمليات اليومية ورسائل العملاء المؤرخة", secret_ref: "crontab ‏deploy@vps-new + ADMIN_API_SECRET", check_key: "job_ops_daily" }),
  R("/api/eye/daily — 17:00 UTC", "cron", {
    used_by: "تقرير «عين الإدارة»",
    secret_ref: "crontab ‏deploy@vps-new + ADMIN_API_SECRET",
    check_key: "job_eye",
    notes: "مجدول 3 مرات (deploy و root على vps-new، و deploy على الخادم القديم) — يُرسل مرة واحدة يومياً",
  }),
  // ---------- domains ----------
  R("pkg.traveliun.com — شهادة TLS", "domain", { used_by: "النظام", secret_ref: "acme.sh على vps-new", check_key: "tls_pkg" }),
  R("traveliun.com — النطاق", "domain", { used_by: "الموقع والنظام", check_key: "domain_traveliun" }),
  R("app.traveliun.com — النظام القديم", "domain", { used_by: "المرجع القديم (cPanel)", notes: "صفحة /visas مصدر قائمة التأشيرات" }),
  R("chat.teletel.io", "domain", { used_by: "Teletel" }),
  // ---------- code ----------
  R("GitHub satrkhah-ux", "service", { used_by: "كود النظام", account: "satrkhah@gmail.com" }),
  // ---------- leftovers ----------
  R("متغيرات قالب قديمة في ملف التطبيق", "service", {
    secret_ref: "BOT_FEE_PERCENT، BOT_MAX_TRADE_SIZE_USD، BOT_TREASURY_WALLET، JUPITER_API_BASE_URL، NEXT_PUBLIC_SOLANA_RPC_URL",
    unused: true,
    notes: "من قالب العملات الرقمية — لا يستعملها ترافليون — للحذف بقرار المالك",
  }),
];

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let added = 0;
for (const [i, r] of ROWS.entries()) {
  const res = await c.query(
    `insert into integrations (name, kind, used_by, secret_ref, account, notes, check_key, unused, sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (name) do nothing`,
    [r.name, r.kind, r.used_by ?? null, r.secret_ref ?? null, r.account ?? null, r.notes ?? null, r.check_key ?? null, r.unused ?? false, i],
  );
  added += res.rowCount ?? 0;
}
console.log(`integrations: ${added} added of ${ROWS.length}`);
await c.end();
