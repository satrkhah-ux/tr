// The menu consolidation (the owner, 2026-10-19) takes eight tables' pages off
// the menu and keeps the tables. This reads each one in full into
// data-import/backups/nav-consolidation-2026-10-19/<table>.json (gitignored) —
// it writes nothing to the database.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const TABLES = ["profits", "statuses", "supervisors", "guide_informations", "ports", "drivers", "room_types", "care_tickets"];
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const dir = "data-import/backups/nav-consolidation-2026-10-19";
mkdirSync(dir, { recursive: true });
for (const t of TABLES) {
  const { rows } = await c.query(`select * from public.${t}`);
  writeFileSync(`${dir}/${t}.json`, JSON.stringify({ table: t, taken_at: new Date().toISOString(), rows }, null, 1));
  console.log(`${t}: ${rows.length} rows`);
}
await c.end();
