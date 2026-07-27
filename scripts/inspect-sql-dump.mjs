// Inspect a mysqldump .sql (or .sql.gz) WITHOUT loading it into memory.
//
// Prints every table, its columns and how many rows the dump carries — the
// input to the mapping plan when migrating the old MySQL system onto our
// PostgreSQL schema. Read-only: it never touches a database.
//
// Usage:
//   node scripts/inspect-sql-dump.mjs data-import/backup.sql
//   node scripts/inspect-sql-dump.mjs data-import/backup.sql.gz --sample customers
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const file = process.argv[2];
const sampleIndex = process.argv.indexOf("--sample");
const sampleTable = sampleIndex > -1 ? process.argv[sampleIndex + 1] : null;

if (!file) {
  console.error("usage: node scripts/inspect-sql-dump.mjs <dump.sql|dump.sql.gz> [--sample <table>]");
  process.exit(1);
}

/**
 * Row counter for INSERT statements, carried ACROSS lines.
 *
 * Two things make this harder than a `split("),(")`:
 *  - phpMyAdmin writes `INSERT INTO t (cols…) VALUES` and then puts each tuple
 *    on its OWN line, ending with `;` many lines later — so counting must be a
 *    state machine, not a per-line regex.
 *  - a "(" or ";" inside a string value (an address, an Arabic note) is not
 *    syntax, and MySQL escapes quotes as \' — so the scan must track quoting.
 */
class InsertScanner {
  constructor() {
    this.reset();
  }

  reset() {
    this.table = null;
    this.depth = 0;
    this.inQuote = false;
    this.quoteChar = "";
    this.escaped = false;
  }

  get active() {
    return this.table !== null;
  }

  /** Scan a chunk; returns how many new tuples started in it. */
  scan(text) {
    let rows = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (this.escaped) {
        this.escaped = false;
        continue;
      }
      if (this.inQuote) {
        if (c === "\\") this.escaped = true;
        else if (c === this.quoteChar) this.inQuote = false;
        continue;
      }
      if (c === "'" || c === '"') {
        this.inQuote = true;
        this.quoteChar = c;
      } else if (c === "(") {
        if (this.depth === 0) rows += 1;
        this.depth += 1;
      } else if (c === ")") {
        this.depth -= 1;
      } else if (c === ";" && this.depth === 0) {
        // statement finished — anything after it is not part of this INSERT
        this.table = null;
      }
    }
    return rows;
  }
}

const tables = new Map(); // name -> { columns: [], rows: 0 }
let current = null; // table whose CREATE block we are inside
let samplePrinted = false;
const inserts = new InsertScanner();

function bump(name, rows) {
  if (rows === 0) return;
  if (!tables.has(name)) tables.set(name, { columns: [], rows: 0 });
  tables.get(name).rows += rows;
}

const raw = createReadStream(file);
const stream = file.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
const lines = createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of lines) {
  const trimmed = line.trim();

  // Mid-statement: keep counting this INSERT's tuples before anything else.
  if (inserts.active) {
    const table = inserts.table;
    bump(table, inserts.scan(line));
    continue;
  }

  const create = trimmed.match(/^CREATE TABLE (?:IF NOT EXISTS )?[`"]?([\w$]+)[`"]?\s*\(/i);
  if (create) {
    current = create[1];
    if (!tables.has(current)) tables.set(current, { columns: [], rows: 0 });
    continue;
  }

  if (current) {
    // end of the CREATE block
    if (/^\)\s*(ENGINE|DEFAULT|;)/i.test(trimmed)) {
      current = null;
      continue;
    }
    const column = trimmed.match(/^[`"]([\w$]+)[`"]\s+([a-zA-Z]+(?:\([^)]*\))?)/);
    // keys/constraints are not columns
    if (column && !/^(PRIMARY|UNIQUE|KEY|CONSTRAINT|FOREIGN|INDEX|FULLTEXT)\b/i.test(trimmed)) {
      tables.get(current).columns.push(`${column[1]} ${column[2].toLowerCase()}`);
    }
    continue;
  }

  // `INSERT INTO t (cols…) VALUES` — the column list contains parentheses, so
  // find VALUES explicitly and only start counting AFTER it, or the column
  // list itself would be miscounted as the first row.
  const insert = trimmed.match(/^INSERT INTO [`"]?([\w$]+)[`"]?/i);
  if (insert) {
    const name = insert[1];
    const at = trimmed.search(/\bVALUES\b/i);
    inserts.reset();
    inserts.table = name;
    if (at > -1) {
      const tail = trimmed.slice(at + "VALUES".length);
      bump(name, inserts.scan(tail));
      if (sampleTable && name === sampleTable && !samplePrinted) {
        samplePrinted = true;
        console.log(`\n--- sample from ${name} ---`);
        console.log(tail.slice(0, 1200) || "(tuples start on the next line)");
        console.log("--- end sample ---\n");
      }
    }
  }
}

const sorted = [...tables.entries()].sort((a, b) => b[1].rows - a[1].rows);
const withRows = sorted.filter(([, t]) => t.rows > 0);

console.log(`\nDUMP: ${file}`);
console.log(`tables: ${tables.size}  |  with data: ${withRows.length}  |  total rows: ${sorted.reduce((s, [, t]) => s + t.rows, 0)}\n`);

for (const [name, t] of sorted) {
  console.log(`${String(t.rows).padStart(7)}  ${name}`);
  if (t.columns.length > 0) console.log(`         ${t.columns.join(", ")}`);
}

if (withRows.length === 0) {
  console.log("\n(no INSERT statements found — the export may be structure-only)");
}
