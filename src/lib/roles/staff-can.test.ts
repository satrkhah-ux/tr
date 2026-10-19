import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, grantedPermissions, isPermission } from "./roles";

/**
 * currentCan() (roles.ts grantedPermissions) and public.staff_can() (0073) must
 * answer alike — a gate the app passes and the database refuses is a broken
 * screen, and the other way round is the hole 0073 closed.
 */
const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0073_role_write_policies.sql", import.meta.url)),
  "utf8",
);
// the live definition: 0106 added the colleague's own keys, 0107 the ones taken
const LATEST = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0107_employee_permission_overrides.sql", import.meta.url)),
  "utf8",
);

describe("grantedPermissions — the app's side", () => {
  it("is the role's keys for an Active employee, unknown keys dropped", () => {
    expect(grantedPermissions({ status: "Active", permission_keys: ["offers.write", "nonsense", "operations.write"] })).toEqual([
      "offers.write",
      "operations.write",
    ]);
  });

  it("is nothing for no employee, a suspended one, or no role", () => {
    expect(grantedPermissions(null)).toEqual([]);
    expect(grantedPermissions({ status: "Suspended", permission_keys: ["operations.write"] })).toEqual([]);
    expect(grantedPermissions({ status: null, permission_keys: ["operations.write"] })).toEqual([]);
    expect(grantedPermissions({ status: "Active", permission_keys: null })).toEqual([]);
  });

  it("adds the colleague's own keys to the role's (0106), even without a role", () => {
    expect(grantedPermissions({ status: "Active", permission_keys: ["offers.write"], extra_permission_keys: ["data.write", "x"] })).toEqual([
      "offers.write",
      "data.write",
    ]);
    expect(grantedPermissions({ status: "Active", permission_keys: null, extra_permission_keys: ["data.write"] })).toEqual(["data.write"]);
    expect(grantedPermissions({ status: "Suspended", permission_keys: null, extra_permission_keys: ["data.write"] })).toEqual([]);
  });

  it("takes what was removed from the colleague, even when the role gives it (0107)", () => {
    expect(
      grantedPermissions({ status: "Active", permission_keys: ["offers.write", "clients.view"], extra_permission_keys: ["data.write"], removed_permission_keys: ["clients.view"] }),
    ).toEqual(["offers.write", "data.write"]);
  });

  it("has no implicit administrator: «All Permissions» holds exactly what it lists", () => {
    const listed = ALL_PERMISSIONS.filter((p) => p !== "operations.book");
    expect(grantedPermissions({ status: "Active", permission_keys: listed })).not.toContain("operations.book");
  });
});

describe("staff_can — the database's side (0073, 0106, 0107)", () => {
  const body = LATEST.match(/create or replace function public\.staff_can[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? "";

  it("checks the same three things", () => {
    expect(body).toMatch(/e\.auth_user_id = auth\.uid\(\)/);
    expect(body).toMatch(/e\.status = 'Active'/);
    expect(body).toMatch(/left join public\.roles r on r\.id = e\.role_id/);
    expect(body).toMatch(/p = any \(coalesce\(r\.permission_keys, '\{\}'\) \|\| e\.extra_permission_keys\)/);
    expect(body).toMatch(/not \(p = any \(e\.removed_permission_keys\)\)/);
  });

  it("is only ever asked for a permission the app knows", () => {
    const asked = [...MIGRATION.matchAll(/staff_can\('{1,2}([a-z.]+)'{1,2}\)/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(0);
    for (const p of asked) expect(isPermission(p), p).toBe(true);
  });
});
