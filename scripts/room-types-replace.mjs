// The owner's order (2026-10-15): delete every old room name — the catalogue in
// src/lib/catalog/hotel-room-catalog.json replaces them (deployed first: the code
// no longer reads room_types for choices, and old drafts keep their room text).
//
//   node scripts/room-types-replace.mjs            dry run (default)
//   node scripts/room-types-replace.mjs --commit   backup + delete, one transaction
//
// offer_hotels.room_type_id is the only foreign key to room_types: it is set to
// null first (each issued offer keeps its room_type_name text), then every
// room_types row is deleted. The backup holds both, so it can be put back.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const commit = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

const fks = await q(
  `select conrelid::regclass::text as t, a.attname as col from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey) where k.contype = 'f' and k.confrelid = 'public.room_types'::regclass`,
);
const unexpected = fks.filter((f) => !(f.t === "offer_hotels" && f.col === "room_type_id"));
if (unexpected.length) throw new Error(`other tables point at room_types: ${JSON.stringify(unexpected)} — review first`);

const rooms = await q(`select * from public.room_types`);
const linked = await q(`select id, room_type_id, room_type_name from public.offer_hotels where room_type_id is not null`);
console.log(`room_types rows: ${rooms.length}; offer_hotels rows pointing at them: ${linked.length}`);

if (!commit) {
  console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}

const dir = "data-import/backups/room-types-2026-10-15";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/room_types.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: rooms }, null, 1));
writeFileSync(`${dir}/offer_hotels-room_type_id.json`, JSON.stringify(linked, null, 1));
await c.query("begin");
try {
  const unlinked = await c.query(`update public.offer_hotels set room_type_id = null where room_type_id is not null`);
  const deleted = await c.query(`delete from public.room_types`);
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'room_types.replaced', 'room_types', null, $1)`,
    [JSON.stringify({ deleted: deleted.rowCount, unlinked_offer_hotels: unlinked.rowCount, backup: dir, by: "src/lib/catalog/hotel-room-catalog.json" })],
  );
  await c.query("commit");
  console.log(`deleted ${deleted.rowCount} room types; ${unlinked.rowCount} offer_hotels rows keep their room text. Backup: ${dir}`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
