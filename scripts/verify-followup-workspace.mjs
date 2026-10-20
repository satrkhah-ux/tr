// node --env-file=.env.local scripts/verify-followup-workspace.mjs
// All fixtures (and, before installation, the migration) are rolled back.
import pg from "pg";
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
let assertions = 0;
const check = (value, expected) => { assert.deepEqual(value, expected); assertions++; };
try {
  await db.query("begin");
  const exists = (await db.query("select to_regprocedure('public.followup_action(uuid,uuid,text,jsonb)') as f")).rows[0].f;
  if (!exists) await db.query(fs.readFileSync("supabase/migrations/20261020145253_followup_workspace.sql", "utf8").replace(/^begin;/, "").replace(/commit;\s*$/, ""));
  const guard = (await db.query("select to_regprocedure('public.followup_assign_available(uuid,uuid,uuid)') as f")).rows[0].f;
  if (!guard) await db.query(fs.readFileSync("supabase/migrations/20261020151252_followup_assignment_guard.sql", "utf8").replace(/^begin;/, "").replace(/commit;\s*$/, ""));
  const employee = async (keys) => (await db.query("insert into employees(arabic_name,status,extra_permission_keys) values('FOLLOWUP_TEST','Active',$1) returning id", [keys])).rows[0].id;
  const worker = await employee(["followups.work"]), other = await employee(["followups.work"]), manager = await employee(["followups.manage"]), stranger = await employee(["clients.view"]);
  const file = (await db.query("insert into sla_followups(conversation_id,kind,transfer_reason) values(-2147483000,'waiting','test') returning id")).rows[0].id;
  await db.query("set local role service_role");
  const run = async (actor, action, data = {}) => (await db.query("select followup_action($1,$2,$3,$4) as result", [file, actor, action, data])).rows[0].result;
  check((await run(stranger, "claim")).error, "forbidden");
  check((await run(worker, "claim")).ok, true);
  check((await run(other, "claim")).error, "claimed");
  check((await db.query("select followup_assign_available($1,$2,$3) as result", [file,manager,other])).rows[0].result.error, "claimed");
  check((await run(other, "result", { outcome: "interested" })).error, "forbidden");
  check((await run(worker, "assign", { employeeId: other })).error, "forbidden");
  check((await run(manager, "assign", { employeeId: stranger })).error, "invalid");
  check((await run(worker, "result", { outcome: "no_answer" })).error, "due");
  const requestId = randomUUID();
  check((await run(worker, "reserve_send", { requestId, text: "test-only" })).ok, true);
  check((await run(worker, "reserve_send", { requestId, text: "test-only" })).duplicate, true);
  check((await run(manager, "assign", { employeeId: other })).error, "busy");
  check((await run(worker, "reserve_send", { requestId: randomUUID(), text: "second" })).error, "busy");
  check((await run(worker, "finish_send", { requestId, state: "uncertain" })).ok, true);
  check((await run(worker, "result", { outcome: "interested" })).error, "busy");
  check((await run(manager, "release_uncertain", { note: "verified absent" })).error, "busy");
  check((await run(worker, "finish_send", { requestId, state: "sent", messageId: 123 })).ok, true);
  check((await run(worker, "reserve_send", { requestId, text: "test-only" })).state, "sent");
  check((await run(worker, "result", { outcome: "later", dueAt: "2099-01-01T00:00:00Z", note: "next", channel: "call" })).ok, true);
  await db.query("select followup_wake(-2147483000,now()+interval '1 second')");
  const woke = (await db.query("select stage,next_followup_at,attempt_count from sla_followups where id=$1", [file])).rows[0];
  check(woke, { stage: "working", next_followup_at: null, attempt_count: 2 });
  await db.query("select followup_wake(-2147483000,now()+interval '1 second')");
  check((await db.query("select count(*)::int as n from followup_attempts where followup_id=$1 and kind='incoming'", [file])).rows[0].n, 1);
  check((await run(manager, "assign", { employeeId: other })).ok, true);
  check((await run(worker, "reserve_send", { requestId: randomUUID(), text: "revoked" })).error, "forbidden");
  check((await run(other, "result", { outcome: "completed", note: "done", channel: "note" })).ok, true);
  check((await run(other, "reserve_send", { requestId: randomUUID(), text: "closed" })).error, "done");
  const privileges = (await db.query(`select
    has_table_privilege('authenticated','public.sla_followups','select') as read,
    has_table_privilege('anon','public.followup_attempts','select') as anon,
    has_function_privilege('authenticated','public.followup_action(uuid,uuid,text,jsonb)','execute') as execute,
    has_function_privilege('anon','public.followup_wake(bigint,timestamptz)','execute') as wake`)).rows[0];
  check(privileges, { read: false, anon: false, execute: false, wake: false });
  await db.query("select * from followup_confirmed_bookings()");
  console.log(`${assertions} database checks passed; no external messages; fixtures rolled back.`);
} finally {
  await db.query("rollback");
  await db.end();
}
