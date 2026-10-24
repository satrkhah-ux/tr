/**
 * «تصدير Excel» / «استيراد Excel» for every table of the data engine.
 *
 * No spreadsheet library is installed, so the file is CSV — UTF-8 with a BOM,
 * which is what makes Excel open Arabic as Arabic instead of mojibake. Pure: the
 * table screen builds and reads the file in the browser, and the server only
 * ever receives the rows that changed.
 */
import type { TranslationKey } from "@/lib/i18n";
import { normAr } from "@/lib/catalog/norm";
import type { ColumnDef, DataRow, DataValue, FilterOption } from "./types";

export const CSV_BOM = "﻿";

/** Shown as yes/no and stored as booleans, whatever the column type says. */
export const BOOLEAN_KEYS = new Set(["checked", "is_default", "visa_required", "with_driver"]);

/** A form box or a spreadsheet cell → the value the column stores. */
export function coerceCell(column: ColumnDef, raw: string): DataValue {
  const trimmed = raw.replace(/\r\n?/g, "\n").trim();
  if (BOOLEAN_KEYS.has(column.key)) return /^(true|yes|نعم|1)$/i.test(trimmed);
  if (trimmed === "") return null;
  if (column.type === "number" || column.type === "currency") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

// ---------------------------------------------------------------- refs ----

/** A row's value for a column that points at a city or a country, by id. A hotel's country is its city's. */
export function refId(column: ColumnDef, row: DataRow, cities: FilterOption[]): string | null {
  if (column.ref === "countries" && row.city_id) {
    const parent = cities.find((c) => c.value === row.city_id)?.parent;
    if (parent) return parent;
  }
  const own = row[column.key];
  return own === null || own === undefined || own === "" ? null : String(own);
}

/** The label a spreadsheet shows for a ref — the id itself when two rows share the label. */
export function refExport(id: string | null, options: FilterOption[]): string {
  if (!id) return "";
  const label = options.find((o) => o.value === id)?.label;
  if (!label) return id;
  const folded = normAr(label);
  return options.filter((o) => normAr(o.label) === folded).length === 1 ? label : id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A spreadsheet cell back to the id it names: the id, or the one row with that label. */
export function refImport(cell: string, options: FilterOption[]): { id: string | null } | null {
  const text = cell.trim();
  if (!text) return { id: null };
  if (UUID.test(text)) return options.some((o) => o.value === text) ? { id: text } : null;
  const folded = normAr(text);
  const matches = options.filter((o) => normAr(o.label) === folded);
  return matches.length === 1 ? { id: matches[0].value } : null;
}

// ---------------------------------------------------------------- file ----

/**
 * Excel reads a leading = + - @ as a formula, and turns a leading zero, a long
 * digit run or an ISO date into its own number/date format. Such a cell is
 * written ="…" — Excel shows the text and saves it back unchanged.
 */
const EXCEL_MANGLES = /^(?:[=+\-@\t\r]|0\d|\d{12,}$|\d{4}-\d{2}-\d{2})/;

function csvCell(value: string): string {
  const text = EXCEL_MANGLES.test(value) ? `="${value.replace(/"/g, '""')}"` : value;
  return /[",;\r\n\t]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: string[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function unwrapFormula(value: string): string {
  const match = /^="([\s\S]*)"$/.exec(value);
  return match ? match[1].replace(/""/g, '"') : value;
}

/** RFC 4180, plus what Excel writes: a `;` or tab separator, a BOM, CRLF, the ="…" cells above. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => header.split(d).length;
  const delimiter = [";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map(unwrapFormula));
}

/** A cell's text for the file. */
export function exportCell(column: ColumnDef, row: DataRow, refs: RefOptions): string {
  if (column.ref) return refExport(refId(column, row, refs.cities ?? []), refs[column.ref] ?? []);
  const value = row[column.key];
  return value === null || value === undefined ? "" : String(value);
}

export type RefOptions = Partial<Record<"cities" | "countries", FilterOption[]>>;

// ---------------------------------------------------------------- plan ----

/** The header cell → the column it names: its key, or its label in either language. */
export function resolveHeader(header: string[], aliases: Record<string, string[]>): (string | null)[] {
  return header.map((cell) => {
    const name = normAr(cell);
    if (name === "id") return "id";
    for (const [key, names] of Object.entries(aliases)) {
      if (normAr(key) === name || names.some((n) => normAr(n) === name)) return key;
    }
    return null;
  });
}

export type ImportPlan = {
  creates: DataRow[];
  updates: { id: string; changes: DataRow; before: DataRow }[];
  unchanged: number;
  errors: { line: number; error: TranslationKey; detail: string }[];
};

function stored(column: ColumnDef, value: DataValue | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (BOOLEAN_KEYS.has(column.key)) return String(value === true || value === "true");
  if (column.type === "number" || column.type === "currency") return String(Number(value));
  return String(value).trim();
}

/**
 * What saving the file would do — nothing is deleted. A line with an id is an
 * update of that row (only the fields that differ); a line without one is a new
 * row; an id this table does not have, or a city/country it cannot name, is an
 * error shown before anything is saved.
 */
export function planImport(args: {
  keys: (string | null)[];
  lines: string[][];
  columns: ColumnDef[];
  existing: Map<string, DataRow>;
  refs: RefOptions;
}): ImportPlan {
  const plan: ImportPlan = { creates: [], updates: [], unchanged: 0, errors: [] };
  const idAt = args.keys.indexOf("id");
  const mapped = args.columns
    .map((column) => ({ column, at: args.keys.indexOf(column.key) }))
    .filter((m) => m.at >= 0);

  args.lines.forEach((line, index) => {
    const lineNo = index + 2; // the header is line 1
    if (line.every((cell) => cell.trim() === "")) return;
    const values: DataRow = {};
    for (const { column, at } of mapped) {
      const raw = line[at] ?? "";
      if (column.ref) {
        const ref = refImport(raw, args.refs[column.ref] ?? []);
        if (!ref) {
          plan.errors.push({ line: lineNo, error: "data.tools.import.badRef", detail: raw.trim() });
          return;
        }
        values[column.key] = ref.id;
      } else if (BOOLEAN_KEYS.has(column.key) && raw.trim() === "") {
        values[column.key] = null;
      } else {
        values[column.key] = coerceCell(column, raw);
      }
    }
    const id = idAt >= 0 ? (line[idAt] ?? "").trim() : "";
    if (!id) {
      plan.creates.push(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)));
      return;
    }
    const before = args.existing.get(id);
    if (!before) {
      plan.errors.push({ line: lineNo, error: "data.tools.import.unknownId", detail: id });
      return;
    }
    const changes: DataRow = {};
    for (const { column } of mapped) {
      if (stored(column, values[column.key]) !== stored(column, before[column.key])) changes[column.key] = values[column.key];
    }
    if (Object.keys(changes).length === 0) plan.unchanged += 1;
    else plan.updates.push({ id, changes, before });
  });
  return plan;
}
