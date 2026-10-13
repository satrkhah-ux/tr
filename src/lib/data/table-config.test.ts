import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GRANTED_COLUMNS, SEARCH_KEY_TABLES, isCostColumn } from "./table-config";

/**
 * The engine names the granted columns itself, so its list and 0047's GRANT
 * must agree: a column the code names and the database withholds fails the whole
 * screen with 42501, and one the database grants and the code forgets is a
 * column nobody without pricing.internal can ever see. Writes are granted on the
 * same list (writable() strips the rest), so all three are held to it.
 */
const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0047_cost_data_lockdown.sql", import.meta.url)),
  "utf8",
);

function grantedIn(table: string): { select: string[]; insert: string[]; update: string[] } {
  const match = MIGRATION.match(
    new RegExp(
      `grant select \\(([^)]*)\\),\\s*insert \\(([^)]*)\\),\\s*update \\(([^)]*)\\)\\s+on public\\.${table} to authenticated`,
    ),
  );
  const columns = (i: number) => (match?.[i] ?? "").split(",").map((c) => c.trim()).filter(Boolean).sort();
  return { select: columns(1), insert: columns(2), update: columns(3) };
}

describe("GRANTED_COLUMNS", () => {
  for (const [table, columns] of Object.entries(GRANTED_COLUMNS)) {
    it(`matches 0047's select, insert and update grants on ${table}`, () => {
      const expected = [...(columns ?? [])].sort();
      expect(grantedIn(table)).toEqual({ select: expected, insert: expected, update: expected });
    });
  }

  it("withholds the buy side and nothing else", () => {
    expect(isCostColumn("services", "buy_price")).toBe(true);
    expect(isCostColumn("transportation_types", "buy_currency")).toBe(true);
    expect(isCostColumn("services", "sell_price")).toBe(false);
    expect(isCostColumn("hotels", "anything")).toBe(false);
  });
});

describe("SEARCH_KEY_TABLES", () => {
  it("is the list 0070 gives a search_key computed field", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/0070_data_tools.sql", import.meta.url)),
      "utf8",
    );
    const list = sql.match(/foreach t in array array\[([^\]]*)\]/)?.[1] ?? "";
    const tables = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(tables).toEqual([...SEARCH_KEY_TABLES].sort());
    // a whole-row reference needs every column — not on the column-granted tables
    for (const table of Object.keys(GRANTED_COLUMNS)) expect(tables).not.toContain(table);
  });
});
