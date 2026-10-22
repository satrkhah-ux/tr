// «تنبيهاتي» stage a (the owner, 2026-10-22): link each employee to their
// Telegram account (the IDs the owner gave) and to their Teletel agent.
//
//   node scripts/staff-bot-link-2026-10-22.mjs            # report only
//   node scripts/staff-bot-link-2026-10-22.mjs --apply    # write
//
// Telegram: match by email, else by exact name. Teletel: match by email, else
// by name, and only when exactly one agent fits. Anything unclear is reported
// and left alone, to be set on «الموظفين». Writes only empty fields, so a value
// someone already set by hand is never overwritten.
import { readFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const APPLY = process.argv.includes("--apply");

// [name, email | null, telegram id | null] as the owner sent them
const OWNER_LIST = [
  ["رهف", "rahaf@traveliun.com", 8292751133],
  ["محمد صالح", "saleh@traveliun.com", 8502112798],
  ["اكرم الحريبي", "akram_saif@traveliun.com", 6840194526],
  ["عبدالله", null, 499492441],
  ["احمد يوسف", "sales.ksa@traveliun.com", 8737984504],
  ["احمد القدسي", "ahmed.alqadasi@traveliun.com", 1007708118],
  ["عبدالرزاق", "abdulrazak@traveliun.com", 6652201791],
  ["خالد محمد علي الجبري", "khalid.aljabri@traveliun.com", 7261448692],
  ["احمد علي صالح الكوماني", "alkwmani435@gmail.com", null],
  ["محمد الحبيب", "m.alhabib@traveliun.com", 1016690903],
  ["ريموندا", "remonda.traveliun@gmail.com", 2128098556],
  ["باسل", null, 8948845017],
  ["مريم", null, 1640771138],
  ["اسوار", "aswar@traveliun.com", null],
  ["رشا", "rasha.khalifa87@gmail.com", null],
  ["محمد اسكندر", null, 6328570275],
];

/** «عبد الله» = «عبدالله», hamzas and invisible marks folded, a «- حسابات» suffix dropped. */
const norm = (s) =>
  String(s ?? "")
    .replace(/[‎‏؜]/g, "")
    .split(" - ")[0]
    .replace(/[أإآ]/g, "ا")
    .replace(/عبد\s+ال/g, "عبدال")
    .replace(/\s+/g, " ")
    .trim();
const words = (s) => norm(s).split(" ").filter(Boolean);
const lower = (s) => (s ? String(s).trim().toLowerCase() : null);

async function teletelAgents() {
  const base = process.env.TELETEL_BASE_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1/accounts/${process.env.TELETEL_ACCOUNT_ID || "1"}/assignable_agents?inbox_ids[]=11`, {
    headers: { api_access_token: process.env.TELETEL_API_TOKEN },
  });
  if (!res.ok) throw new Error(`Teletel agents: HTTP ${res.status}`);
  return (await res.json()).payload.map((a) => ({ id: a.id, name: a.name, email: lower(a.email) }));
}

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: employees } = await db.query("select id, arabic_name, email, status, telegram_chat_id, teletel_agent_id from employees");
const agents = await teletelAgents();

const report = { telegram: [], teletel: [], unmatched: [], unclear: [] };
const updates = new Map(); // employee id → { telegram_chat_id?, teletel_agent_id? }
const set = (id, patch) => updates.set(id, { ...updates.get(id), ...patch });

// --- Telegram, from the owner's list
for (const [name, email, tg] of OWNER_LIST) {
  const byEmail = email && employees.find((e) => lower(e.email) === lower(email));
  const byName = employees.filter((e) => norm(e.arabic_name) === norm(name));
  const emp = byEmail || (byName.length === 1 ? byName[0] : null);
  if (!emp) {
    report.unmatched.push(`${name}${email ? ` <${email}>` : ""} — ${tg ?? "بلا معرّف"}`);
    continue;
  }
  if (!tg) {
    report.telegram.push(`${emp.arabic_name}: لم يُربط (لا معرّف)`);
    continue;
  }
  if (emp.telegram_chat_id && String(emp.telegram_chat_id) !== String(tg)) {
    report.unclear.push(`${emp.arabic_name}: Telegram already ${emp.telegram_chat_id}, owner gave ${tg} — left as is`);
    continue;
  }
  if (!emp.telegram_chat_id) set(emp.id, { telegram_chat_id: tg });
  report.telegram.push(`${emp.arabic_name}: ${tg}${byEmail ? "" : " (by name)"}`);
}

// --- Teletel, for every active employee
const taken = new Set(employees.map((e) => e.teletel_agent_id).filter(Boolean));
for (const emp of employees.filter((e) => e.status === "Active" && !e.teletel_agent_id)) {
  let agent = emp.email ? agents.find((a) => a.email === lower(emp.email)) : null;
  let how = "email";
  if (!agent) {
    const mine = words(emp.arabic_name);
    // the agent's every word in the employee's name («احمد الكوماني» ⊂ «احمد علي صالح الكوماني»), exactly one such agent
    const fits = agents.filter((a) => {
      const theirs = words(a.name);
      return theirs.length > 0 && theirs.every((w) => mine.includes(w));
    });
    if (fits.length === 1) [agent, how] = [fits[0], "name"];
    else if (fits.length > 1) report.unclear.push(`${emp.arabic_name}: ${fits.length} Teletel agents fit (${fits.map((a) => a.name).join("، ")}) — left empty`);
  }
  if (!agent) continue;
  if (taken.has(agent.id)) {
    report.unclear.push(`${emp.arabic_name}: agent ${agent.id} «${agent.name}» already linked to someone else`);
    continue;
  }
  taken.add(agent.id);
  set(emp.id, { teletel_agent_id: agent.id });
  report.teletel.push(`${emp.arabic_name} → ${agent.id} «${norm(agent.name)}» (${how})`);
}

console.log("Telegram:\n  " + report.telegram.join("\n  "));
console.log("Teletel:\n  " + report.teletel.join("\n  "));
console.log("Not employees in the system:\n  " + (report.unmatched.join("\n  ") || "—"));
console.log("Unclear (left alone):\n  " + (report.unclear.join("\n  ") || "—"));

if (APPLY) {
  await db.query("begin");
  for (const [id, patch] of updates) {
    const cols = Object.keys(patch);
    await db.query(
      `update employees set ${cols.map((c, i) => `${c} = coalesce(${c}, $${i + 2})`).join(", ")} where id = $1`,
      [id, ...cols.map((c) => patch[c])],
    );
    await db.query(
      "insert into audit_logs (actor_email, action, entity, entity_id, meta) values ($1, 'employee.bot_linked', 'employees', $2, $3)",
      ["script:staff-bot-link-2026-10-22", id, JSON.stringify(patch)],
    );
  }
  await db.query("commit");
  console.log(`applied: ${updates.size} employees`);
} else {
  console.log(`report only — ${updates.size} employees would change; --apply to write`);
}
await db.end();
