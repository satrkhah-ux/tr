// The decisions register under concurrency, on a THROWAWAY Postgres (never the live one):
//   docker run --rm -d --name adm-dec-pg -e POSTGRES_PASSWORD=x -p 5544:5432 postgres:16
//   node scripts/test-admin-decisions-db.mjs postgres://postgres:x@localhost:5544/postgres
// Checks: 40 managers issuing 40 drafts at once get 40 different, gapless serials; 10 taps on one draft issue it once;
// two «استلمت» at once store one acknowledgement.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.argv[2];
if (!url || /supabase/.test(url))
  throw new Error("a throwaway database URL, please");
const pool = new pg.Pool({ connectionString: url, max: 45 });

await pool.query(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create extension if not exists pgcrypto;
  drop table if exists admin_decision_recipients, admin_decisions, admin_decision_counters, staff_bot_pending, employees cascade;
  create table employees (id uuid primary key default gen_random_uuid(), arabic_name text);
  create table staff_bot_pending (chat_id bigint primary key, kind text not null constraint staff_bot_pending_kind_check check (kind in ('broadcast','alert','decision')));
`);
await pool.query(
  readFileSync(
    new URL(
      "../supabase/migrations/20261029110300_admin_decisions.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const { rows: people } = await pool.query(
  "insert into employees (arabic_name) select 'موظف ' || g from generate_series(1, 3) g returning id, arabic_name as name",
);
const recipients = JSON.stringify(people);
const draft = async () =>
  (
    await pool.query(
      "insert into admin_decisions (kind, title, final_text) values ('تعميم', 'اختبار', 'نص') returning id",
    )
  ).rows[0].id;
const issue = (id) =>
  pool
    .query("select admin_decision_issue($1, null, 'المدير', $2::jsonb) s", [
      id,
      recipients,
    ])
    .then((r) => r.rows[0].s);

// 40 drafts issued at the same moment
const drafts = await Promise.all(Array.from({ length: 40 }, draft));
const serials = await Promise.all(drafts.map(issue));
assert.equal(new Set(serials).size, 40, "every serial is different");
const year = new Date().getFullYear();
const nums = serials.map((s) => Number(s.split("-")[2])).sort((a, b) => a - b);
assert.deepEqual(
  nums,
  Array.from({ length: 40 }, (_, i) => i + 1),
  "gapless from 0001",
);
assert.ok(serials.every((s) => new RegExp(`^ق-${year}-\\d{4}$`).test(s)));

// one draft, ten taps
const one = await draft();
const taps = await Promise.all(Array.from({ length: 10 }, () => issue(one)));
assert.equal(taps.filter(Boolean).length, 1, "issued once");
assert.equal(
  Number(
    (
      await pool.query(
        "select count(*) from admin_decision_recipients where decision_id = $1",
        [one],
      )
    ).rows[0].count,
  ),
  3,
);

// «استلمت» twice at once (the bot and the bell): one acknowledgement
const ack = () =>
  pool.query(
    "update admin_decision_recipients set acknowledged_at = now(), ack_via = 'bot' where decision_id = $1 and employee_id = $2 and acknowledged_at is null returning 1",
    [one, people[0].id],
  );
const acks = await Promise.all([ack(), ack(), ack()]);
assert.equal(
  acks.reduce((n, r) => n + r.rowCount, 0),
  1,
  "acknowledged once",
);

// an empty audience never takes a number
const empty = await draft();
await assert.rejects(
  pool.query("select admin_decision_issue($1, null, 'x', '[]'::jsonb)", [
    empty,
  ]),
);
assert.equal(
  (await pool.query("select last from admin_decision_counters")).rows[0].last,
  41,
);

console.log(
  "admin decisions DB checks OK:",
  serials.length,
  "concurrent serials,",
  taps.filter(Boolean)[0],
);
await pool.end();
