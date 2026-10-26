import { beforeEach, describe, expect, it, vi } from "vitest";

/** «ألغِ كل الأجهزة» and the revoke after a password change: the signed-in employee's own live links, every one. */
const state = vi.hoisted(() => ({
  employee: "emp-1" as string | null,
  partner: null as object | null,
  calls: [] as string[],
  revoked: [{ id: "l1" }, { id: "l2" }],
  audit: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => state.employee }));
vi.mock("@/lib/partners/session", () => ({ getPartnerSession: async () => state.partner }));
vi.mock("@/lib/roles/current", () => ({ currentPermissions: async () => ["offers.write"] }));
vi.mock("@/lib/data/audit", () => ({ logAudit: state.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => {
    const q = {
      from: (t: string) => (state.calls.push(`from:${t}`), q),
      update: (v: { revoked_at?: string }) => (state.calls.push(`update:${v.revoked_at ? "revoked_at" : "?"}`), q),
      eq: (c: string, v: string) => (state.calls.push(`eq:${c}=${v}`), q),
      is: (c: string, v: null) => (state.calls.push(`is:${c}=${v}`), q),
      select: () => Promise.resolve({ data: state.revoked, error: null }),
    };
    return q;
  },
}));
import { revokeAllMyExtensionLinks } from "./extension-links";

beforeEach(() => {
  state.employee = "emp-1";
  state.partner = null;
  state.calls = [];
  state.audit.mockClear();
});

describe("every device of mine, revoked", () => {
  it("revokes the signed-in employee's live links only, and says how many", async () => {
    expect(await revokeAllMyExtensionLinks()).toEqual({ ok: true, count: 2 });
    expect(state.calls).toEqual(["from:extension_links", "update:revoked_at", "eq:employee_id=emp-1", "is:revoked_at=null"]);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ext.revoked", meta: { all: true, count: 2 } }));
  });

  it("touches nothing for a partner company's session or without an employee", async () => {
    state.partner = { partner_id: "p" };
    expect((await revokeAllMyExtensionLinks()).ok).toBe(false);
    state.partner = null;
    state.employee = null;
    expect((await revokeAllMyExtensionLinks()).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });
});
