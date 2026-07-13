/**
 * Fix: Disable RLS on bot tables (they are backend-only, not user-facing)
 * Run once: node scripts/fix-bot-rls.mjs
 */

// Read from env — never hardcode. Required: SUPABASE_MGMT_TOKEN, SUPABASE_PROJECT_REF
const MGMT_TOKEN  = process.env.SUPABASE_MGMT_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

if (!MGMT_TOKEN || !PROJECT_REF) {
  console.error("Missing env SUPABASE_MGMT_TOKEN and/or SUPABASE_PROJECT_REF");
  process.exit(1);
}

const queries = [
  // Disable RLS on bot tables (internal use only)
  `ALTER TABLE bot_users    DISABLE ROW LEVEL SECURITY`,
  `ALTER TABLE bot_trades   DISABLE ROW LEVEL SECURITY`,
  `ALTER TABLE bot_messages DISABLE ROW LEVEL SECURITY`,

  // Also grant full access just in case
  `GRANT ALL ON bot_users    TO anon, authenticated`,
  `GRANT ALL ON bot_trades   TO anon, authenticated`,
  `GRANT ALL ON bot_messages TO anon, authenticated`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated`,
];

async function runQuery(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MGMT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  return { status: res.status, body: await res.text() };
}

for (let i = 0; i < queries.length; i++) {
  const { status, body } = await runQuery(queries[i]);
  const ok = status >= 200 && status < 300;
  const preview = queries[i].slice(0, 70);
  console.log(`${ok ? "✅" : "⚠️ "} [${i + 1}/${queries.length}] ${preview}`);
  if (!ok) console.log(`    → ${body.slice(0, 200)}`);
}

console.log("\n✅ تم إصلاح صلاحيات RLS.");
