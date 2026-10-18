// The owner's order (2026-10-18, in this chat: «1- نعم»): stop the dated and
// stage WhatsApp messages of the two Indonesia trial files of the test number
// …8023 (AD-2-3599, AD-4-8573), without cancelling the files.
//
// sendClientMessage sends each message once per operation and marks it in
// operation_alerts (kind client_msg, ref = the message key, unique) BEFORE
// sending — a mark already there means «sent», and nothing goes. This writes
// those marks for every key the files have not sent yet. Undo: delete the
// rows whose ids are written to the backup folder.
//
//   node scripts/stop-test-reminders-2026-10-18.mjs            dry run
//   node scripts/stop-test-reminders-2026-10-18.mjs --commit   write the marks
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const commit = process.argv.includes("--commit");
const SERIALS = ["AD-2-3599%", "AD-4-8573%"];
const KEYS = ["bookings_confirmed", "documents_ready", "trip_reminder", "welcome", "three_days_before", "day_before", "departure_day", "midway", "rate_trip"];
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const cols = (await c.query("select column_name from information_schema.columns where table_name = 'operation_alerts'")).rows.map((r) => r.column_name);
console.log("operation_alerts:", cols.join(", "));
const ops = (await c.query("select o.id, f.serial from operations o join offers f on f.id = o.offer_id where f.serial like $1 or f.serial like $2", SERIALS)).rows;
const todo = [];
for (const op of ops) {
  const sent = new Set((await c.query("select ref from operation_alerts where operation_id = $1 and kind = 'client_msg'", [op.id])).rows.map((r) => r.ref));
  const left = KEYS.filter((k) => !sent.has(k));
  console.log(`${op.serial}: already sent ${[...sent].join(", ") || "none"} — to stop: ${left.join(", ") || "none"}`);
  for (const k of left) todo.push({ operation_id: op.id, serial: op.serial, ref: k });
}
if (!commit) {
  console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}
await c.query("begin");
try {
  const ids = [];
  for (const t of todo) {
    const r = await c.query("insert into operation_alerts (operation_id, kind, ref) values ($1, 'client_msg', $2) on conflict do nothing returning id", [t.operation_id, t.ref]);
    if (r.rows[0]) ids.push({ id: r.rows[0].id, ...t });
  }
  await c.query(
    "insert into audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'data.updated', 'operation_alerts', null, $1)",
    [JSON.stringify({ stopped_client_messages: ids.length, files: [...new Set(todo.map((t) => t.serial))], reason: "trial files of the test number" })],
  );
  await c.query("commit");
  const dir = "data-import/backups/stop-test-reminders-2026-10-18";
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/marks.json`, JSON.stringify({ taken_at: new Date().toISOString(), undo: "delete from operation_alerts where id in (these ids)", rows: ids }, null, 1));
  console.log(`marked ${ids.length} messages as sent. Undo list: ${dir}/marks.json`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
