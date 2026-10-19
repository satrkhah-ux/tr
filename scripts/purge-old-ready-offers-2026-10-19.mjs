// One-time cleanup (the owner's order 2026-10-19, approved by the user in chat): delete the
// 27 ready offers of the 2026-07-27 sync that the owner's new sheet no longer has — inactive
// since his first sync today, and no draft names any of them as its source (checked again
// inside the transaction; one reference aborts it). Each row is written to a JSON file first
// (copied to /home/deploy/backups/pkg/manual/ by the caller), one audit row records it.
//   node scripts/purge-old-ready-offers-2026-10-19.mjs <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const out = process.argv[2];
if (!out) throw new Error("usage: purge-old-ready-offers-2026-10-19.mjs <out.json>");

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("begin");
  const { rows } = await c.query("select * from public.ready_offers where active = false and synced_at::date = '2026-07-27' order by code for update");
  const ids = rows.map((r) => r.id);
  const refs = (await c.query("select count(*)::int as n from public.offer_drafts where data->'source'->>'ready_offer_id' = any($1)", [ids])).rows[0].n;
  if (rows.length !== 27 || refs !== 0) throw new Error(`stopped: ${rows.length} rows, ${refs} draft references`);
  writeFileSync(out, JSON.stringify(rows, null, 1));
  const del = await c.query("delete from public.ready_offers where id = any($1)", [ids]);
  await c.query(
    "insert into public.audit_logs (action, entity, entity_id, meta) values ('ready_offers.purged', 'ready_offers', 'sync-2026-07-27', $1)",
    [{ count: del.rowCount, reason: "«يحذف القديم ويبقى الجديد» — no longer in the owner's sheet, no draft points at them", backup: "/home/deploy/backups/pkg/manual/ready-offers-old-2026-10-19.json" }],
  );
  await c.query("commit");
  const left = (await c.query("select count(*)::int as n, count(*) filter (where active)::int as live from public.ready_offers")).rows[0];
  console.log(`deleted ${del.rowCount}; ready_offers now ${left.n} (${left.live} active)`);
  console.log("designs on the deleted:", rows.filter((r) => r.design_url).map((r) => r.design_url));
} catch (e) {
  await c.query("rollback");
  throw e;
} finally {
  await c.end();
}
