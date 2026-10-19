// «الربط الخارجي» correction (the evaluator, 2026-10-19): pkg's database is Supabase
// CLOUD (project rpuxdgrypnmihgmbeunq, ap-south-1 Mumbai — the live app's
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_URL), not the self-hosted stack on
// vps-new. That stack (/home/deploy/supabase/docker) holds the TraveliunAPP
// migration copy — the schema plus the legacy_sys/legacy_app archive, one auth
// user, no writes — and no container points at it; supabase-backup.timer backs up
// THAT stack, so it does not protect pkg's data. Prints each row before and after.
//   node scripts/fix-integrations-cloud-2026-10-19.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CLOUD = "Supabase Cloud — المشروع rpuxdgrypnmihgmbeunq (ap-south-1 مومباي)";
const UPDATES = [
  {
    from: "قاعدة البيانات (Supabase ذاتية الاستضافة)",
    set: {
      name: "قاعدة البيانات (Supabase Cloud)",
      notes: `${CLOUD}. الخطة والتكلفة والحساب والنسخ الاحتياطي يعبّئها المالك — ليست على حساب satrkhah@gmail.com (403). فحص «db» يقرأ من واجهة REST السحابية نفسها.`,
    },
  },
  { from: "تسجيل الدخول (Supabase Auth)", set: { notes: CLOUD } },
  { from: "الملفات (Supabase Storage)", set: { notes: CLOUD } },
  {
    from: "النسخ الاحتياطي اليومي (supabase-backup)",
    set: {
      used_by: "Supabase الذاتية على vps-new فقط — ليست قاعدة pkg",
      notes: "لا يحمي بيانات pkg (السحابية). نسخ قاعدة pkg سؤال مفتوح للمالك: الخطة المجانية بلا نسخ تلقائي، Pro يومي لسبعة أيام. آخر تشغيل ناجح 2026-10-19 03:30 UTC",
    },
  },
];
const NEW_ROW = {
  name: "Supabase ذاتية الاستضافة على vps-new (ليست قاعدة pkg)",
  kind: "database",
  used_by: "نسخة ترحيل TraveliunAPP: مخطط النظام + الأرشيف القديم (legacy_sys، legacy_app)، مستخدم دخول واحد، بلا كتابة — لا تطبيق يتصل بها",
  secret_ref: "/home/deploy/supabase/docker/.env",
  notes: "حاويات supabase-* على شبكة supabase_default؛ ينسخها supabase-backup.timer 03:30 UTC",
};

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  for (const u of UPDATES) {
    const before = await client.query("select id, name, used_by, notes from public.integrations where name = $1", [u.from]);
    if (!before.rowCount) {
      console.log("not found (already fixed?):", u.from);
      continue;
    }
    console.log("before:", before.rows[0]);
    const cols = Object.keys(u.set);
    await client.query(
      `update public.integrations set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`,
      [before.rows[0].id, ...cols.map((c) => u.set[c])],
    );
  }
  const had = await client.query("select 1 from public.integrations where name = $1", [NEW_ROW.name]);
  if (!had.rowCount) {
    const sort = (await client.query("select coalesce(max(sort), 0) + 1 as s from public.integrations where kind = 'database'")).rows[0].s;
    await client.query(
      "insert into public.integrations (name, kind, used_by, secret_ref, notes, sort) values ($1, $2, $3, $4, $5, $6)",
      [NEW_ROW.name, NEW_ROW.kind, NEW_ROW.used_by, NEW_ROW.secret_ref, NEW_ROW.notes, sort],
    );
    console.log("added:", NEW_ROW.name);
  }
  await client.query("commit");
  const after = await client.query("select name, used_by, notes from public.integrations where kind in ('database', 'cron') order by kind, sort");
  console.table(after.rows);
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}
