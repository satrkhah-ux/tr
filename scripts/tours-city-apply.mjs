// Applies the owner-reviewed «ربط الجولات بمدنها» CSV (made by tours-city-suggest.mjs).
// The CITY NAME column is what counts — the owner may edit it in Excel (or clear it:
// the tour stays for the whole country); the corrected-name column, when filled,
// renames the tour. A backup of every touched row is written first, and everything
// runs in one transaction. Dry run unless --apply.
//
// Usage: node scripts/tours-city-apply.mjs <reviewed.csv> [--apply]
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("usage: node scripts/tours-city-apply.mjs <reviewed.csv> [--apply]");
const apply = flag === "--apply";

/** a small CSV reader: quoted fields, doubled quotes, CRLF */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n") row.push(cell.replace(/\r$/, "")), rows.push(row), (row = []), (cell = "");
    else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}
const fold = (s) => String(s ?? "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "");

const rows = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, "")).slice(1).filter((r) => r[0]);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const cities = (await c.query(`select ci.id, ci.arabic_name, co.arabic_name country from cities ci join countries co on co.id = ci.country_id`)).rows;
const ids = rows.map((r) => r[0]);
const before = (await c.query(`select id, arabic_name, city_id from tours where id = any($1::uuid[])`, [ids])).rows;
const byId = new Map(before.map((t) => [t.id, t]));

const plan = [];
const problems = [];
for (const [id, country, , cityName, , , fixed] of rows) {
  const t = byId.get(id);
  if (!t) {
    problems.push(`missing tour ${id}`);
    continue;
  }
  const city = cityName?.trim() ? cities.find((x) => x.country === country && fold(x.arabic_name) === fold(cityName)) : null;
  if (cityName?.trim() && !city) problems.push(`no city «${cityName}» in ${country} (tour ${id})`);
  const city_id = city?.id ?? null;
  const name = fixed?.trim() || t.arabic_name;
  if (city_id !== t.city_id || name !== t.arabic_name) plan.push({ id, city_id, name });
}
console.log(JSON.stringify({ rows: rows.length, changes: plan.length, withCity: plan.filter((p) => p.city_id).length, renamed: plan.filter((p) => p.name !== byId.get(p.id).arabic_name).length, problems }, null, 1));

if (apply && !problems.length) {
  const backup = `tours-city-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(before, null, 1));
  await c.query("begin");
  try {
    for (const p of plan) await c.query(`update tours set city_id = $2, arabic_name = $3 where id = $1`, [p.id, p.city_id, p.name]);
    await c.query("commit");
    console.log(`applied ${plan.length}; backup ${backup}`);
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
} else if (apply) {
  console.log("not applied: fix the problems above first");
}
await c.end();
