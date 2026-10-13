/**
 * Operations order 1 (docs/OPERATIONS-V2-PROMPTS-AR.md), the data half:
 *
 *  a. an offer issued before customerFor existed has no customer — its draft
 *     still names the client: link (or create) the customers row, so the
 *     operations list, the case, every document and the client link print it;
 *  b. an offer whose operation exists is «confirmed» on the board too (a
 *     re-issue had sent AD-6-3427 back to «sent»);
 *  c. a confirmed offer has its operation (AD-1-1057, AD-1-5211, TH-4-3400).
 *
 * Dry run by default (one transaction, rolled back); `--commit` writes, after a
 * backup of every row it can touch.
 *
 *   node scripts/operations-backfill-2026-10-13.mjs [--commit]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;

try {
  // ---- what is there ----
  const nameless = await q(`
    select o.id, o.serial, d.data->'customer' as customer
      from offers o
      join offer_drafts d on d.data->>'produced_serial' = o.serial
     where o.customer_id is null`);
  const unconfirmed = await q(`
    select o.id, o.serial, o.status from operations p join offers o on o.id = p.offer_id
     where o.status not in ('confirmed', 'cancelled')`);
  const orphans = await q(`
    select o.id, o.serial, o.pipeline_stage, o.offer_date::text as offer_date from offers o
     where o.status = 'confirmed' and not exists (select 1 from operations p where p.offer_id = o.id)`);

  const backup = {
    offers: await q(`select id, serial, status, pipeline_stage, customer_id from offers where id = any($1)`, [
      [...nameless, ...unconfirmed, ...orphans].map((r) => r.id),
    ]),
  };

  await q("begin");
  const log = [];

  // a. the client, from the draft that issued the offer
  for (const o of nameless) {
    const name = (o.customer?.customer_name ?? "").trim();
    const phone = (o.customer?.customer_phone ?? "").trim();
    if (!name && !phone) continue;
    const hit = (
      await q(`select id from customers where arabic_name = $1 and ${phone ? "mobile = $2" : "mobile is null"} limit 1`, phone ? [name || phone, phone] : [name || phone])
    )[0];
    const id = hit?.id ?? (await q(`insert into customers (arabic_name, mobile) values ($1, $2) returning id`, [name || phone, phone || null]))[0].id;
    await q(`update offers set customer_id = $2 where id = $1`, [o.id, id]);
    log.push(`customer ${o.serial} ← ${name || phone}${hit ? " (existing)" : " (new)"}`);
  }

  // b. an offer operations is working is confirmed on the board
  for (const o of unconfirmed) {
    await q(`update offers set status = 'confirmed' where id = $1`, [o.id]);
    await q(`insert into offer_status_history (offer_id, from_status, to_status, note) values ($1, $2, 'confirmed', 'backfill: its operation exists')`, [o.id, o.status]);
    log.push(`status ${o.serial}: ${o.status} → confirmed`);
  }

  // c. a confirmed offer has its operation, dated from its latest internal render
  for (const o of orphans) {
    const r = (
      await q(
        `select id, snapshot_json->>'arrival_date' a, snapshot_json->>'departure_date' d from offer_renders
          where offer_id = $1 and variant = 'internal' order by version desc limit 1`,
        [o.id],
      )
    )[0];
    await q(
      `insert into operations (offer_id, render_id, travel_start, travel_end, confirm_channel, note)
       values ($1, $2, $3, $4, 'phone', 'backfill: confirmed offer without an operation')`,
      [o.id, r?.id ?? null, r?.a || o.offer_date || null, r?.d || null],
    );
    if (["active_not_confirmed", "followed_up"].includes(o.pipeline_stage)) {
      await q(`update offers set pipeline_stage = 'confirmed_hotels' where id = $1`, [o.id]);
    }
    log.push(`operation ${o.serial} (${r?.a || o.offer_date || "no dates"})`);
  }

  console.log(log.join("\n") || "nothing to do");
  if (!COMMIT) {
    await q("rollback");
    console.log("\ndry run — rolled back; pass --commit to apply");
  } else {
    mkdirSync("data-import/backups", { recursive: true });
    const file = `data-import/backups/operations-backfill-2026-10-13-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(backup, null, 1));
    await q("commit");
    console.log("committed; backup:", file);
  }
} catch (error) {
  await q("rollback").catch(() => {});
  console.error("rolled back:", error.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
