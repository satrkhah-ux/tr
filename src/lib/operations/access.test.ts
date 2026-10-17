import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «ملفاته فقط، يشاهد ويعمل» (2026-10-17): operations.write works every file,
 * operations.own only the files whose offer names the employee, and a child id
 * (a booking, a payment, a supplier link …) is judged by ITS operation, looked
 * up on the server — never by an operation id the browser sends alongside it.
 * 0078's public.owns_operation is the same rule in SQL.
 */

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  perms: [] as string[],
  employeeId: "emp-me" as string | null,
}));

const TABLES: Record<string, Record<string, unknown>[]> = {
  operations: [
    { id: "op-mine", offers: { employee_id: "emp-me" } },
    { id: "op-theirs", offers: [{ employee_id: "emp-colleague" }] },
    { id: "op-nobody", offers: { employee_id: null } },
  ],
  operation_bookings: [
    { id: "b-mine", operation_id: "op-mine" },
    { id: "b-mine-2", operation_id: "op-mine" },
    { id: "b-theirs", operation_id: "op-theirs" },
  ],
  operation_payments: [
    { id: "p-mine", operation_id: "op-mine" },
    { id: "p-theirs", operation_id: "op-theirs" },
  ],
  supplier_payments: [{ id: "sp-loose", operation_id: null }],
  operation_links: [
    { id: "l-mine", booking_id: "b-mine" },
    { id: "l-theirs", booking_id: "b-theirs" },
    // a driver's day: no booking, so no single file
    { id: "l-driver", booking_id: null },
  ],
};

/** select(...).in("id", ids) only — all the rule asks. */
function fakeDb() {
  return {
    from(table: string) {
      return {
        select: () => ({
          in: async (_column: string, ids: string[]) => ({ data: (TABLES[table] ?? []).filter((r) => ids.includes(r.id as string)), error: null }),
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => state.user,
  createSupabaseServiceClient: () => fakeDb(),
}));
vi.mock("@/lib/roles/current", () => ({ currentCan: async (p: string) => state.perms.includes(p) }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => state.employeeId }));

import { gateCaseManager, gateManager, gateManagerRow, gateManagerRows, gateOperation, gateOps, gateRow, gateRows, mayWork } from "./access";

beforeEach(() => {
  state.user = { id: "user-1" };
  state.perms = ["operations.own"];
  state.employeeId = "emp-me";
});

describe("mayWork", () => {
  it("all-files access works every file, own access only the files it issued", () => {
    expect(mayWork({ all: true }, "anyone")).toBe(true);
    expect(mayWork({ all: true }, null)).toBe(true);
    expect(mayWork({ all: false, employeeId: "emp-me" }, "emp-me")).toBe(true);
    expect(mayWork({ all: false, employeeId: "emp-me" }, "emp-colleague")).toBe(false);
    // a file with no issuer on it belongs to nobody's «own»
    expect(mayWork({ all: false, employeeId: "emp-me" }, null)).toBe(false);
    expect(mayWork(null, "emp-me")).toBe(false);
  });
});

describe("the gates", () => {
  it("operations.write passes every file without looking", async () => {
    state.perms = ["operations.write", "operations.own"];
    expect(await gateOperation("op-theirs")).toBeNull();
    expect(await gateRow("operation_bookings", "b-theirs")).toBeNull();
    expect(await gateManager()).toBeNull();
  });

  it("operations.own works its own file and is refused a colleague's", async () => {
    expect(await gateOps()).toBeNull();
    expect(await gateOperation("op-mine")).toBeNull();
    expect(await gateOperation("op-theirs")).toBe("ops.err.notYours");
    expect(await gateOperation("op-nobody")).toBe("ops.err.notYours");
    expect(await gateOperation("op-missing")).toBe("ops.err.notYours");
  });

  it("maps a child id to its own operation, through the booking for a link", async () => {
    expect(await gateRow("operation_bookings", "b-mine")).toBeNull();
    expect(await gateRow("operation_bookings", "b-theirs")).toBe("ops.err.notYours");
    expect(await gateRow("operation_payments", "p-theirs")).toBe("ops.err.notYours");
    expect(await gateRow("operation_links", "l-mine")).toBeNull();
    expect(await gateRow("operation_links", "l-theirs")).toBe("ops.err.notYours");
    // rows that hang off no single file are not «own»
    expect(await gateRow("operation_links", "l-driver")).toBe("ops.err.notYours");
    expect(await gateRow("supplier_payments", "sp-loose")).toBe("ops.err.notYours");
  });

  it("one foreign id among many refuses the whole action", async () => {
    expect(await gateRows("operation_bookings", ["b-mine", "b-mine-2", "b-mine"])).toBeNull();
    expect(await gateRows("operation_bookings", ["b-mine", "b-theirs"])).toBe("ops.err.notYours");
    expect(await gateRows("operation_bookings", ["b-mine", "b-missing"])).toBe("ops.err.notYours");
    expect(await gateRows("operation_bookings", [])).toBe("ops.err.notYours");
  });

  it("keeps the manager's steps from an own-files holder, even on their file", async () => {
    expect(await gateManager()).toBe("ops.err.managerOnly");
  });

  it("the manager's steps on one case: operations.write on every file", async () => {
    state.perms = ["operations.write", "operations.own"];
    expect(await gateCaseManager("op-theirs")).toBeNull();
    expect(await gateManagerRow("operation_payments", "p-theirs")).toBeNull();
    expect(await gateManagerRows("operations", ["op-mine", "op-theirs"])).toBeNull();
  });

  it("operations.manage_own: the manager's steps on my file, never a colleague's (the owner, 2026-10-17)", async () => {
    state.perms = ["operations.own", "operations.manage_own"];
    expect(await gateCaseManager("op-mine")).toBeNull();
    expect(await gateManagerRow("operation_payments", "p-mine")).toBeNull();
    expect(await gateManagerRow("operation_bookings", "b-mine")).toBeNull();
    expect(await gateCaseManager("op-theirs")).toBe("ops.err.notYours");
    expect(await gateManagerRow("operation_payments", "p-theirs")).toBe("ops.err.notYours");
    expect(await gateCaseManager("op-nobody")).toBe("ops.err.notYours");
    // a supplier payment naming one foreign case among mine is refused whole
    expect(await gateManagerRows("operations", ["op-mine", "op-theirs"])).toBe("ops.err.notYours");
    // what spans every case stays operations.write
    expect(await gateManager()).toBe("ops.err.managerOnly");
  });

  it("operations.own without manage_own: the manager's steps refused even on my file — the revoke path", async () => {
    expect(await gateCaseManager("op-mine")).toBe("ops.err.managerOnly");
    expect(await gateManagerRow("operation_payments", "p-mine")).toBe("ops.err.managerOnly");
    expect(await gateCaseManager("op-theirs")).toBe("ops.err.notYours");
  });

  it("manage_own alone (no operations.own) opens nothing", async () => {
    state.perms = ["operations.manage_own"];
    expect(await gateCaseManager("op-mine")).toBe("ops.err.forbidden");
    expect(await gateManager()).toBe("ops.err.forbidden");
  });

  it("refuses without a permission, an employee row or a session", async () => {
    state.perms = ["offers.write"];
    expect(await gateOps()).toBe("ops.err.forbidden");
    expect(await gateOperation("op-mine")).toBe("ops.err.forbidden");
    expect(await gateManager()).toBe("ops.err.forbidden");

    state.perms = ["operations.own"];
    state.employeeId = null;
    expect(await gateOperation("op-mine")).toBe("ops.err.forbidden");

    state.user = null;
    expect(await gateOperation("op-mine")).toBe("err.session");
  });
});
