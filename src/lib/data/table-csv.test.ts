import { describe, expect, it } from "vitest";
import { CSV_BOM, exportCell, parseCsv, planImport, refImport, resolveHeader, toCsv } from "./table-csv";
import type { ColumnDef, DataRow, FilterOption } from "./types";

const cities: FilterOption[] = [
  { value: "11111111-1111-4111-8111-111111111111", label: "كوالالمبور", parent: "my" },
  { value: "22222222-2222-4222-8222-222222222222", label: "لنكاوي", parent: "my" },
  { value: "33333333-3333-4333-8333-333333333333", label: "طرابلس", parent: "ly" },
  { value: "44444444-4444-4444-8444-444444444444", label: "طرابلس", parent: "lb" },
];
const countries: FilterOption[] = [
  { value: "my", label: "ماليزيا" },
  { value: "ly", label: "ليبيا" },
  { value: "lb", label: "لبنان" },
];
const refs = { cities, countries };

const columns: ColumnDef[] = [
  { key: "arabic_name", labelKey: "col.arabicName" },
  { key: "english_name", labelKey: "col.englishName" },
  { key: "city_id", labelKey: "filter.city", ref: "cities" },
  { key: "country_id", labelKey: "filter.country", ref: "countries", editable: false },
  { key: "stars", labelKey: "col.stars", type: "number" },
  { key: "contact_number", labelKey: "col.contactNumber", type: "phone" },
  { key: "is_default", labelKey: "col.isDefault" },
  { key: "status", labelKey: "col.status", type: "status" },
];
const importable = columns.filter((c) => c.editable !== false && c.type !== "status");

const rows: DataRow[] = [
  {
    id: "h1", arabic_name: "فندق \"الماسة\", كوالالمبور", english_name: "Diamond, KL", city_id: cities[0].value,
    country_id: null, stars: 5, contact_number: "0551234567", is_default: false, status: "Active",
  },
  {
    id: "h2", arabic_name: "=SUM(A1)", english_name: null, city_id: cities[2].value,
    country_id: "ly", stars: null, contact_number: "+60 3 2170 8888", is_default: true, status: "Inactive",
  },
  {
    id: "h3", arabic_name: "شقق\nبحرية", english_name: "  spaced  ", city_id: null,
    country_id: null, stars: 3, contact_number: "2026-10-13", is_default: null, status: null,
  },
];

function exportFile(list: DataRow[]): string {
  return toCsv([
    ["id", ...columns.map((c) => c.key)],
    ...list.map((r) => [String(r.id), ...columns.map((c) => exportCell(c, r, refs))]),
  ]);
}

function reimport(text: string, existing: DataRow[]) {
  const [header, ...lines] = parseCsv(text);
  return planImport({
    keys: resolveHeader(header, Object.fromEntries(importable.map((c) => [c.key, []]))),
    lines,
    columns: importable,
    existing: new Map(existing.map((r) => [String(r.id), r])),
    refs,
  });
}

describe("table CSV", () => {
  it("writes a BOM and guards what Excel would mangle", () => {
    const text = exportFile(rows);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toContain('"=""0551234567"""');
    expect(text).toContain('"=""=SUM(A1)"""');
    expect(text).toContain('"=""+60 3 2170 8888"""');
  });

  it("names a city by its label, or by id when two cities share it; a hotel's country is its city's", () => {
    expect(exportCell(columns[2], rows[0], refs)).toBe("كوالالمبور");
    expect(exportCell(columns[2], rows[1], refs)).toBe(cities[2].value);
    expect(exportCell(columns[3], rows[0], refs)).toBe("ماليزيا");
    expect(refImport("طرابلس", cities)).toBeNull();
    expect(refImport("كوالالامبور", cities)).toBeNull();
    expect(refImport("لنكاوى", cities)).toEqual({ id: cities[1].value });
  });

  it("round-trips: export then import without edits = no difference", () => {
    const plan = reimport(exportFile(rows), rows);
    expect(plan).toMatchObject({ creates: [], updates: [], errors: [] });
    expect(plan.unchanged).toBe(3);
  });

  it("reads back what Excel saves: semicolons, CRLF, unwrapped cells, TRUE", () => {
    const text = `${CSV_BOM}id;arabic_name;stars;is_default;contact_number\r\nh1;فندق "الماسة", كوالالمبور;5;FALSE;0551234567\r\n`;
    const [header, ...lines] = parseCsv(text.replace('فندق "الماسة", كوالالمبور', '"فندق ""الماسة"", كوالالمبور"'));
    expect(header).toEqual(["id", "arabic_name", "stars", "is_default", "contact_number"]);
    const plan = planImport({
      keys: resolveHeader(header, Object.fromEntries(importable.map((c) => [c.key, []]))),
      lines,
      columns: importable,
      existing: new Map(rows.map((r) => [String(r.id), r])),
      refs,
    });
    expect(plan.unchanged).toBe(1);
  });

  it("previews changes, new rows and errors — and never a deletion", () => {
    const [header, ...lines] = parseCsv(exportFile(rows));
    lines[0][header.indexOf("stars")] = "4";
    lines[0][header.indexOf("city_id")] = "لنكاوي";
    lines[1][0] = "missing-id";
    lines[2][header.indexOf("city_id")] = "مدينة لا توجد";
    lines.push(["", "فندق جديد", "", "كوالالمبور", "", "", "", "", ""]);
    lines.push(["", "", "", "", "", "", "", "", ""]);
    const plan = planImport({
      keys: resolveHeader(header, Object.fromEntries(importable.map((c) => [c.key, []]))),
      lines,
      columns: importable,
      existing: new Map(rows.map((r) => [String(r.id), r])),
      refs,
    });
    expect(plan.updates).toEqual([{ id: "h1", changes: { stars: 4, city_id: cities[1].value }, before: rows[0] }]);
    expect(plan.creates).toEqual([{ arabic_name: "فندق جديد", city_id: cities[0].value }]);
    expect(plan.errors.map((e) => [e.line, e.error])).toEqual([
      [3, "data.tools.import.unknownId"],
      [4, "data.tools.import.badRef"],
    ]);
  });

  it("matches headers by key or by either language's label", () => {
    const keys = resolveHeader(["ID", "الاسم العربي", "Stars", "something else"], {
      arabic_name: ["الاسم العربي", "Arabic name"],
      stars: ["النجوم", "Stars"],
    });
    expect(keys).toEqual(["id", "arabic_name", "stars", null]);
  });
});
