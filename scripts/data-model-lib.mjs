/**
 * Shared by the data-model scripts (data section orders 4–9, migration 0072):
 *
 *   node scripts/data-<topic>-proposal.mjs          READ ONLY → data-import/data-<topic>-proposal.json
 *   (a person reads it, sets `ok` on each item — true = apply, false = leave)
 *   node scripts/data-<topic>-apply.mjs             dry run: applies, prints, rolls back
 *   node scripts/data-<topic>-apply.mjs --commit    backup to data-import/backups, then one transaction
 *
 * The connection is .env.local's SUPABASE_DB_URL — the PRODUCTION database
 * (memory: the local env is the live one). Proposals run inside a READ ONLY
 * transaction, so they cannot write even by mistake. Apply only items with
 * `ok === true`; every apply re-checks what it relies on inside its transaction.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

export const COMMIT = process.argv.includes("--commit");

/** `--name value` from the command line. */
export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function env() {
  if (!existsSync(".env.local")) throw new Error("no .env.local here — run from the checkout that has it");
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
}

async function connect() {
  const url = env().SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL missing in .env.local");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

/** Does this column exist yet? (0072 may not be applied when a proposal runs.) */
export async function hasColumn(q, table, column) {
  const rows = await q(
    "select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
    [table, column],
  );
  return rows.length > 0;
}

/** Build a proposal inside a READ ONLY transaction and write it. */
export async function propose(topic, build) {
  const client = await connect();
  const q = async (sql, args = []) => (await client.query(sql, args)).rows;
  try {
    await client.query("begin transaction read only");
    const body = await build(q);
    await client.query("rollback");
    mkdirSync("data-import", { recursive: true });
    const file = `data-import/data-${topic}-proposal.json`;
    writeFileSync(file, JSON.stringify({ topic, generated_at: new Date().toISOString(), ...body }, null, 1));
    console.log(`\nwrote ${file} — set "ok" on each item, then: node scripts/data-${topic}-apply.mjs`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

export function readProposal(topic) {
  const file = arg("proposal", `data-import/data-${topic}-proposal.json`);
  if (!existsSync(file)) throw new Error(`${file} not found — run scripts/data-${topic}-proposal.mjs first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The items a person approved. */
export const approved = (list) => (list ?? []).filter((item) => item.ok === true);

/**
 * One transaction: `backup(q)` is read first (every row the apply may touch),
 * `apply(q, log)` makes the changes and pushes { kind, … } lines to `log`.
 * Without --commit everything is rolled back; with it the backup is written
 * before the commit, the log after.
 */
export async function applyInTransaction(topic, { backup, apply }) {
  const client = await connect();
  const q = async (sql, args = []) => (await client.query(sql, args)).rows;
  const log = [];
  try {
    const saved = await backup(q);
    await client.query("begin");
    await apply(q, log);
    const counts = {};
    for (const line of log) counts[line.kind] = (counts[line.kind] ?? 0) + 1;
    console.log(counts);
    if (!COMMIT) {
      await client.query("rollback");
      console.log("\ndry run — rolled back; pass --commit to apply");
      return;
    }
    mkdirSync("data-import/backups", { recursive: true });
    const file = `data-import/backups/data-${topic}-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(saved));
    await client.query("commit");
    writeFileSync(file.replace(".json", ".log.json"), JSON.stringify(log, null, 1));
    console.log("committed; backup:", file);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("rolled back:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
