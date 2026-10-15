// The owner's decisions on the 39 wrong-name hotels (review page
// https://claude.ai/artifact/BBS1j83MJH8obB54Dge8pq) applied to the catalogue.
//
//   node scripts/wrong-names-apply.mjs <choices-dir>            dry run (default)
//   node scripts/wrong-names-apply.mjs <choices-dir> --commit   backup + apply, one transaction
//
// <choices-dir> holds one JSON per hotel id as the page's db exports it ({ choice }).
// Only «approve» is acted on: rename → the proposed Arabic/English names (and the
// address cleared where the proposal says it belongs to the other hotel); merge →
// the twin takes its corrected names and this row goes (only while nothing uses
// it); deactivate → status 'Inactive'. Anything referenced aborts the run.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const [dir, flag] = process.argv.slice(2);
if (!dir || !existsSync(dir)) throw new Error("usage: node scripts/wrong-names-apply.mjs <choices-dir> [--commit]");
const commit = flag === "--commit";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const choices = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const doc = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return [f.replace(/\.json$/, ""), (doc.data ?? doc).choice];
    }),
);
const proposal = JSON.parse(readFileSync("data-import/wrong-names-proposal.json", "utf8"));
const todo = proposal.items.filter((it) => choices[it.id] === "approve");

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

async function refs(id) {
  const [r] = await q(
    `select (select count(*) from public.offer_hotels where hotel_id = $1)::int as offer_hotels,
            (select count(*) from public.room_types where hotel_id = $1)::int as room_types,
            (select count(*) from public.hotel_rate_memory where hotel_id = $1)::int as rates,
            (select count(*) from public.hotel_content_cache where internal_hotel_id = $1)::int as cache,
            (select count(*) from public.offer_drafts d where d.data::text like '%' || $1 || '%')::int as drafts`,
    [id],
  );
  return r;
}

const ids = [...new Set(todo.flatMap((it) => [it.id, it.twin?.id].filter(Boolean)))];
const before = await q(`select * from public.hotels where id = any($1::uuid[])`, [ids]);
if (before.length !== ids.length) throw new Error(`expected ${ids.length} hotels, found ${before.length}`);

const plan = [];
for (const it of todo) {
  if (it.action === "rename") {
    const set = { arabic_name: it.proposed.arabic_name, english_name: it.proposed.english_name };
    if (it.proposed && "address" in it.proposed) set.address = it.proposed.address;
    plan.push({ kind: "rename", id: it.id, set, from: it.current });
  } else if (it.action === "merge") {
    const r = await refs(it.id);
    if (Object.values(r).some((n) => n > 0)) throw new Error(`merge ${it.id} is referenced: ${JSON.stringify(r)} — stop`);
    const twinSet = it.twin_proposed ? { arabic_name: it.twin_proposed.arabic_name, english_name: it.twin_proposed.english_name } : null;
    plan.push({ kind: "merge", id: it.id, twin: it.twin.id, twinSet, from: it.current });
  } else if (it.action === "deactivate") {
    plan.push({ kind: "deactivate", id: it.id, from: it.current });
  }
}
console.log(`plan: ${plan.filter((p) => p.kind === "rename").length} renames, ${plan.filter((p) => p.kind === "merge").length} merges, ${plan.filter((p) => p.kind === "deactivate").length} deactivations`);
for (const p of plan) console.log(" ", p.kind.padEnd(10), p.id.slice(0, 8), (p.from.ar || "").slice(0, 34).padEnd(34), "→", p.set?.arabic_name ?? (p.twinSet?.arabic_name ? "twin: " + p.twinSet.arabic_name : p.kind === "merge" ? "into twin" : "Inactive"));

if (!commit) {
  console.log("\ndry run — nothing written. Re-run with --commit to apply.");
  await c.end();
  process.exit(0);
}

const bdir = "data-import/backups/wrong-names-2026-10-15";
mkdirSync(bdir, { recursive: true });
writeFileSync(`${bdir}/hotels-before.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: before }, null, 2));
const actor = { actor_id: null, actor_email: "owner-review-page" };
await c.query("begin");
try {
  for (const p of plan) {
    if (p.kind === "rename") {
      const cols = Object.keys(p.set);
      await c.query(`update public.hotels set ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [p.id, ...cols.map((k) => p.set[k])]);
    } else if (p.kind === "merge") {
      if (p.twinSet) await c.query(`update public.hotels set arabic_name = $2, english_name = $3 where id = $1`, [p.twin, p.twinSet.arabic_name, p.twinSet.english_name]);
      await c.query(`delete from public.hotels where id = $1`, [p.id]);
    } else {
      await c.query(`update public.hotels set status = 'Inactive' where id = $1`, [p.id]);
    }
    await c.query(
      `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values ($1, $2, $3, 'hotels', $4, $5)`,
      [actor.actor_id, actor.actor_email, `hotel.wrong_name.${p.kind}`, p.kind === "merge" ? p.twin : p.id, JSON.stringify({ from: p.from, set: p.set ?? p.twinSet ?? null, dropped: p.kind === "merge" ? p.id : undefined })],
    );
  }
  await c.query("commit");
  console.log(`\napplied ${plan.length} changes; backup in ${bdir}/hotels-before.json`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
