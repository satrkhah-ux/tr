// Pull the REFERENCE tables out of the legacy mysqldump, as JSON.
//
// Why this exists: scripts/legacy-import-*.sql read from `legacy_app` /
// `legacy_sys` Postgres schemas that nothing in this repo ever creates. Loading
// a 260 MB MySQL dump into staging schemas means converting all 116 tables;
// we need ten of them. So this streams the dump, parses only those ten, and
// writes JSON that a generator turns into one idempotent Postgres file.
//
// Reference data ONLY — no customers, no offers, no employees. The dump holds
// real client names and phone numbers and none of them are read here.
//
// The file carries BOTH legacy systems:
//   `tourhawl_systraveliun`   — the older one, `app_*` tables
//   `tourhawl_traveliun_app`  — the newer one (app.traveliun.com), plain names
// We want the NEWER half, so parsing starts at its `-- Database:` marker.
//
// Usage: node scripts/legacy-extract-reference.mjs [path-to-dump]
//   → data-import/extracted/<table>.json   (data-import/ is gitignored)
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? "data-import/traveliun-legacy.sql";
const outDir = join(root, "data-import/extracted");

/** The newer system's database, as phpMyAdmin names it in the dump. */
const TARGET_DB = "tourhawl_traveliun_app";

/** Reference tables only. Everything else in the dump is skipped unread. */
const WANTED = new Set([
  "countries",
  "cities",
  "hotels",
  "rooms_types",
  "rooms",
  "services",
  "services_types",
  "cars",
  "cars_types",
  "currencies",
  "airports",
  "airlines",
  "transfers",
  "transfer_cars_prices",
]);

/**
 * Split one MySQL tuple body into raw field strings.
 *
 * Not a `split(",")`: a comma inside a quoted address or an Arabic note is
 * data, and MySQL escapes a quote as \' — so the scan has to track quoting.
 * Returns the fields with quotes stripped and escapes resolved; an unquoted
 * NULL becomes null, an unquoted number becomes a number.
 */
function splitTuple(body) {
  const out = [];
  let buf = "";
  let quoted = false;
  let inQuote = false;
  let escaped = false;

  const push = () => {
    const raw = buf.trim();
    if (quoted) out.push(buf);
    else if (raw === "NULL" || raw === "") out.push(null);
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out.push(Number(raw));
    else out.push(raw);
    buf = "";
    quoted = false;
  };

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (escaped) {
      // MySQL's escapes, as they actually appear in a phpMyAdmin dump.
      buf += c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c;
      escaped = false;
      continue;
    }
    if (inQuote) {
      if (c === "\\") escaped = true;
      else if (c === "'") inQuote = false;
      else buf += c;
      continue;
    }
    if (c === "'") {
      inQuote = true;
      quoted = true;
      // Drop the separator whitespace that sat before the opening quote —
      // otherwise every value in the dump comes back with a leading space and
      // nothing ever matches a name in our own tables.
      buf = "";
    } else if (c === ",") {
      push();
    } else {
      buf += c;
    }
  }
  push();
  return out;
}

/** Column names out of `INSERT INTO \`t\` (\`a\`, \`b\`) VALUES`. */
function parseColumns(line) {
  const m = line.match(/^INSERT INTO `[a-z_]+` \(([^)]*)\) VALUES/i);
  if (!m) return null;
  return m[1].split(",").map((c) => c.trim().replace(/`/g, ""));
}

const rows = {};
for (const t of WANTED) rows[t] = [];

let inTargetDb = false;
let table = null;
let columns = null;
// A tuple can span lines (a note with a newline in it), so the body is
// accumulated until its parens balance outside of quotes.
let pending = "";

function flushTuple(body) {
  const fields = splitTuple(body);
  if (!columns) return;
  const row = {};
  columns.forEach((col, i) => {
    row[col] = fields[i] ?? null;
  });
  rows[table].push(row);
}

/** Does this text close the tuple it opened? Quote-aware. */
function balanced(text) {
  let depth = 0;
  let inQuote = false;
  let escaped = false;
  for (const c of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inQuote) {
      if (c === "\\") escaped = true;
      else if (c === "'") inQuote = false;
      continue;
    }
    if (c === "'") inQuote = true;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
  }
  return depth <= 0;
}

const stream = file.endsWith(".gz")
  ? createReadStream(join(root, file)).pipe(createGunzip())
  : createReadStream(join(root, file));

const rl = createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of rl) {
  if (line.startsWith("-- Database: ")) {
    inTargetDb = line.includes(TARGET_DB);
    table = null;
    continue;
  }
  if (!inTargetDb) continue;

  if (pending) {
    pending += "\n" + line;
    if (balanced(pending)) {
      const body = pending.slice(pending.indexOf("(") + 1, pending.lastIndexOf(")"));
      flushTuple(body);
      pending = "";
    }
    continue;
  }

  if (/^INSERT INTO `[a-z_]+`/i.test(line)) {
    const name = line.match(/^INSERT INTO `([a-z_]+)`/i)[1];
    table = WANTED.has(name) ? name : null;
    columns = table ? parseColumns(line) : null;
    // phpMyAdmin puts the tuples on the following lines, but a short table can
    // carry them on the INSERT line itself.
    if (table) {
      const after = line.slice(line.indexOf("VALUES") + 6).trim();
      if (after && after !== "") {
        for (const chunk of after.replace(/;$/, "").split(/\),\s*\(/)) {
          flushTuple(chunk.replace(/^\(/, "").replace(/\)$/, ""));
        }
        table = null;
      }
    }
    continue;
  }

  if (!table) continue;

  const trimmed = line.trim();
  if (!trimmed.startsWith("(")) {
    if (trimmed.startsWith(";") || trimmed === "") table = null;
    continue;
  }
  if (!balanced(trimmed)) {
    pending = trimmed;
    continue;
  }
  const body = trimmed.slice(1, trimmed.lastIndexOf(")"));
  flushTuple(body);
  if (trimmed.endsWith(";")) table = null;
}

mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [name, list] of Object.entries(rows)) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(list, null, 1), "utf8");
  total += list.length;
  console.log(`${name.padEnd(16)} ${String(list.length).padStart(6)} rows`);
}
console.log(`\n${total} rows → data-import/extracted/`);
