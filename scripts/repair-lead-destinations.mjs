// Read-only by default. --apply repairs inferred destinations with optimistic
// concurrency and writes a rollback manifest before changing any record.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import pg from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
}
// Execute the exact production pure classifier, not a second implementation.
function load(relative) {
  const file = path.resolve(relative);
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})((
    name,
  ) => load(path.join(path.dirname(file), name + ".ts")), loaded, loaded.exports);
  return loaded.exports;
}
const { inferConversationDestination } = load("src/lib/leads/destination.ts");
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const apply = process.argv.includes("--apply");
const report = { mode: apply ? "apply" : "review", scanned: 0, unchanged: 0, incomplete: 0, failed: 0, applied: 0, conflicts: 0, changes: [] };
const output = path.resolve("output/destination-repair-" + Date.now() + ".json");
fs.mkdirSync(path.dirname(output), { recursive: true });
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
const base = process.env.TELETEL_BASE_URL.replace(/\/+$/, "");
async function messages(id, since) {
  let before = "";
  const out = [];
  for (let page = 0; page < 50; page++) {
    const response = await fetch(`${base}/api/v1/accounts/${process.env.TELETEL_ACCOUNT_ID || "1"}/conversations/${id}/messages${before}`, {
      headers: { api_access_token: process.env.TELETEL_API_TOKEN },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const batch = (await response.json()).payload;
    if (!Array.isArray(batch)) throw new Error("Invalid response");
    if (!batch.length) return out;
    out.push(...batch.filter((m) => m.message_type !== 2 && m.created_at >= since).map((m) => ({
      id: m.id, at: m.created_at, text: m.content || "", fromClient: m.message_type === 0, isPrivate: m.private === true,
    })));
    if (batch.some((m) => m.created_at <= since)) return out;
    const cursor = "?before=" + Math.min(...batch.map((m) => m.id));
    if (cursor === before) return null;
    before = cursor;
  }
  return null;
}
try {
  await db.connect();
  if (apply) await db.query(`update public.integrations
    set used_by=concat_ws('؛ ', used_by, 'مراجعة وتصحيح الوجهات: scripts/repair-lead-destinations.mjs'), updated_at=now()
    where check_key='teletel' and coalesce(used_by,'') not like '%repair-lead-destinations.mjs%'`);
  const { rows: places } = await db.query(`select arabic_name as name, arabic_name as country from countries
    union all select c.arabic_name as name, coalesce(p.arabic_name,'') as country from cities c left join countries p on p.id=c.country_id`);
  const { rows: eligible } = await db.query(`select id, teletel_conversation_id, destination, destination_source, updated_at,
    coalesce(last_visit_at,created_at) as visit_at from client_leads
    where teletel_conversation_id is not null and destination_source is distinct from 'manual'
    and (destination_source in ('client','labels') or (source='teletel' and created_by is null))
    order by created_at desc`);
  const limitArg = process.argv.find((arg) => /^--limit=\d+$/.test(arg));
  const rows = limitArg ? eligible.slice(0, Number(limitArg.split("=")[1])) : eligible;
  console.log("Eligible conversations:", rows.length);
  for (let start = 0; start < rows.length; start += 4) {
    await Promise.all(rows.slice(start, start + 4).map(async (row) => {
      report.scanned++;
      try {
        const thread = await messages(row.teletel_conversation_id, new Date(row.visit_at).getTime() / 1000);
        if (!thread) { report.incomplete++; return; }
        const inferred = inferConversationDestination(thread, places);
        if (inferred.destination === row.destination && row.destination_source === "client") { report.unchanged++; return; }
        const change = { id: row.id, conversation: row.teletel_conversation_id, before: row.destination,
          sourceBefore: row.destination_source, after: inferred.destination, evidenceId: inferred.evidenceId,
          ambiguous: inferred.ambiguous, updatedBefore: row.updated_at, applied: false };
        report.changes.push(change);
        save();
        if (apply) {
          const result = await db.query(`update client_leads set destination=$1, destination_source='client', updated_at=now()
            where id=$2 and updated_at=$3 and destination_source is distinct from 'manual'
            and destination is not distinct from $4 returning id`,
          [change.after, row.id, row.updated_at, row.destination]);
          change.applied = result.rowCount === 1;
          if (change.applied) report.applied++; else report.conflicts++;
        }
      } catch {
        report.failed++;
      }
    }));
    save();
    if (start % 40 === 0) console.log(JSON.stringify({ scanned: report.scanned, changes: report.changes.length, failed: report.failed }));
  }
  save();
  console.log(JSON.stringify({ ...report, changes: report.changes.length, report: output }));
} finally {
  await db.end();
}
