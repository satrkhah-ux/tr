// Applies a .sql file to the Postgres database in SUPABASE_DB_URL.
// Usage: node scripts/db-apply.mjs supabase/migrations/0008_package_generator.sql
// Migrations are idempotent, so re-running is safe.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local loader (no dotenv dependency).
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
    /* no .env.local — rely on the real environment */
  }
}
loadEnv();

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/db-apply.mjs <path-to.sql>");
  process.exit(1);
}
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}

const sql = readFileSync(join(root, file), "utf8");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log(`✓ applied ${file}`);
} catch (error) {
  console.error(`✗ failed to apply ${file}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
