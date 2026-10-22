// Read/write fixtures and migration are entirely rolled back; no TV sees them.
import pg from "pg";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
try {
  await db.query("begin");
  await db.query("set local lock_timeout = '5s'");
  await db.query(fs.readFileSync("supabase/migrations/20261020180426_reliable_screen_alerts.sql", "utf8"));
  const make = async (destination, inquiry, age = "0 hours") => (await db.query(
    "insert into client_leads(phone,name,destination,inquiry,created_at,last_visit_at) values('SCREEN_TEST_' || gen_random_uuid()::text,'SCREEN_TEST',$1,$2,now()-$3::interval,now()-$3::interval) returning id",
    [destination, inquiry, age],
  )).rows[0].id;
  const events = async (id) => (await db.query("select id,kind,at,request_day from office_screen_events where lead_id=$1 order by at", [id])).rows;
  const inquiry = await make("إندونيسيا", "يستفسر");
  check((await events(inquiry)).length, 1);
  check((await events(inquiry))[0].kind, "يستفسر");
  const original = (await events(inquiry))[0];
  await db.query("update client_leads set inquiry='بكج' where id=$1", [inquiry]);
  check((await events(inquiry))[0].kind, "بكج");
  check((await events(inquiry))[0].id, original.id);
  await db.query("update client_leads set last_visit_at=now()+interval '1 minute' where id=$1", [inquiry]);
  check((await events(inquiry)).length, 1);
  const old = await make("تركيا", "طيران", "2 days");
  check((await events(old)).length, 0);
  await db.query("update client_leads set last_visit_at=now() where id=$1", [old]);
  check((await events(old)).length, 1);
  // Simulate yesterday's already-seen request; a renewed visit creates today's.
  await db.query("update office_screen_events set request_day=request_day-1 where lead_id=$1", [old]);
  await db.query("update client_leads set last_visit_at=now()+interval '1 second' where id=$1", [old]);
  check((await events(old)).length, 2);
  const unknown = await make("", "يستفسر");
  check((await events(unknown)).length, 0);
  await db.query("update client_leads set destination='جورجيا' where id=$1", [unknown]);
  check((await events(unknown)).length, 1);
  const ordered = [ ...(await events(inquiry)), ...(await events(old)), ...(await events(unknown)) ].sort((a,b) => a.at-b.at);
  check(ordered.every((e,i) => !i || e.at-ordered[i-1].at >= 22000), true);
  check((await db.query("select has_function_privilege('anon','public.office_screen_next_at()','execute') as permitted")).rows[0].permitted, false);
  check((await db.query("select relrowsecurity from pg_class where oid='public.office_screen_events'::regclass")).rows[0].relrowsecurity, true);
  console.log(`${checks} screen trigger checks passed; rolling back all fixtures and schema changes.`);
} finally {
  await db.query("rollback");
  await db.end();
}
