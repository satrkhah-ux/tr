import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFER_LOCKED_COLUMNS, changedLockedColumns } from "./locked-columns";

describe("changedLockedColumns", () => {
  const stored = { total: 1200, total_sar: 1200, customer_id: "c1", partner_company_id: null, partner_cost: null };

  it("ignores what the form sends back unchanged", () => {
    expect(changedLockedColumns({ destination: "تركيا", total: "1200", customer_id: "c1" }, stored)).toEqual([]);
    expect(changedLockedColumns({ total: "", partner_cost: null }, { ...stored, total: null })).toEqual([]);
  });

  it("names what actually moves", () => {
    expect(changedLockedColumns({ total: "1300" }, stored)).toEqual(["total"]);
    expect(changedLockedColumns({ partner_company_id: "p1", customer_id: "c2" }, stored)).toEqual(["partner_company_id", "customer_id"]);
    expect(changedLockedColumns({ total: 5 }, null)).toEqual(["total"]);
  });
});

describe("0073 grants back every offers column except these", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../../../supabase/migrations/0073_role_write_policies.sql", import.meta.url)),
    "utf8",
  );
  const granted = (sql.match(/grant update \(([^)]*)\)\s+on public\.offers to authenticated/)?.[1] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  it("revokes the table grant, so the column list is what sessions keep", () => {
    expect(sql).toMatch(/revoke update on public\.offers from authenticated, anon;/);
    expect(granted.length).toBeGreaterThan(10);
    for (const column of OFFER_LOCKED_COLUMNS) expect(granted).not.toContain(column);
  });
});
