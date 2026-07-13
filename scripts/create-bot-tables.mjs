/**
 * One-time script to create Supabase tables for the PalmX bot.
 * Run once: node scripts/create-bot-tables.mjs
 */

// Secrets are read from the environment — never hardcode them.
// Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//           SUPABASE_MGMT_TOKEN (sbp_… management API token), SUPABASE_PROJECT_REF
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

if (!SUPABASE_URL || !ANON_KEY || !MGMT_TOKEN || !PROJECT_REF) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_MGMT_TOKEN, SUPABASE_PROJECT_REF");
  process.exit(1);
}

const queries = [
  `CREATE TABLE IF NOT EXISTS bot_users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('real','demo')),
    step TEXT NOT NULL DEFAULT 'start',
    demo_balance NUMERIC(18,4) NOT NULL DEFAULT 10000,
    wallet_address TEXT,
    wallet_type TEXT CHECK (wallet_type IN ('phantom','solflare')),
    is_banned BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS bot_trades (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL REFERENCES bot_users(telegram_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('buy','sell')),
    amount_usd NUMERIC(18,4),
    price_entry NUMERIC(18,8),
    price_close NUMERIC(18,8),
    mode TEXT NOT NULL CHECK (mode IN ('real','demo')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled','closed')),
    tp NUMERIC(18,8),
    sl NUMERIC(18,8),
    pnl NUMERIC(18,4),
    tx_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
  )`,

  `CREATE TABLE IF NOT EXISTS bot_messages (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    message_type TEXT NOT NULL DEFAULT 'text',
    content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_bot_trades_telegram_id ON bot_trades(telegram_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_trades_status ON bot_trades(status)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_messages_tid ON bot_messages(telegram_id)`,

  `CREATE OR REPLACE FUNCTION update_updated_at()
   RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS bot_users_updated_at ON bot_users`,
  `CREATE TRIGGER bot_users_updated_at BEFORE UPDATE ON bot_users
   FOR EACH ROW EXECUTE FUNCTION update_updated_at()`,
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
  const text = await res.text();
  return { status: res.status, body: text };
}

console.log("🚀 جاري إنشاء جداول البوت في Supabase...\n");

for (let i = 0; i < queries.length; i++) {
  const q = queries[i];
  const preview = q.slice(0, 60).replace(/\s+/g, " ").trim();
  try {
    const { status, body } = await runQuery(q);
    if (status >= 200 && status < 300) {
      console.log(`✅ [${i + 1}/${queries.length}] ${preview}...`);
    } else {
      console.log(`⚠️  [${i + 1}/${queries.length}] ${preview}`);
      console.log(`    → HTTP ${status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`❌ [${i + 1}/${queries.length}] ${preview}`);
    console.log(`    → ${err.message}`);
  }
}

console.log("\n✅ اكتملت العملية.");
