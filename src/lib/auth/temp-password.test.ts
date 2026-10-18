import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const { setTemporaryPassword } = await import("./temp-password");

/** auth.admin and the two link tables, as setTemporaryPassword reads them. */
function fakeAdmin(user: { last_sign_in_at: string | null; app_metadata?: Record<string, unknown> }, links: { employee?: boolean; partner?: boolean } = {}) {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: "u1", app_metadata: {}, ...user } }, error: null }),
        updateUserById: async (_id: string, attrs: Record<string, unknown>) => (updates.push(attrs), { data: {}, error: null }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: (table === "employees" ? links.employee : links.partner) ? [{ id: "x" }] : [], error: null }),
        }),
      }),
    }),
  };
  return { admin: admin as unknown as SupabaseClient, updates };
}

describe("a temporary password only for a login nobody has used", () => {
  it("sets it on a never-used login, confirmed, with the first sign-in forced to change it", async () => {
    const { admin, updates } = fakeAdmin({ last_sign_in_at: null, app_metadata: { provider: "email" } }, { partner: true });
    expect(await setTemporaryPassword(admin, "u1", "Rq7-mountain-42", "partner")).toBe("ok");
    expect(updates[0]).toMatchObject({ password: "Rq7-mountain-42", email_confirm: true, app_metadata: { provider: "email", must_change_password: true } });
  });

  it("refuses a login already in use — its password is its owner's", async () => {
    const { admin, updates } = fakeAdmin({ last_sign_in_at: "2026-10-18T09:00:00Z" }, { employee: true });
    expect(await setTemporaryPassword(admin, "u1", "Rq7-mountain-42", "staff")).toBe("in_use");
    expect(updates).toEqual([]);
  });

  it("never sets a staff login's password from the partner screen, nor a partner's from the staff screen", async () => {
    expect(await setTemporaryPassword(fakeAdmin({ last_sign_in_at: null }, { employee: true }).admin, "u1", "Rq7-mountain-42", "partner")).toBe("wrong_kind");
    expect(await setTemporaryPassword(fakeAdmin({ last_sign_in_at: null }, { partner: true }).admin, "u1", "Rq7-mountain-42", "staff")).toBe("wrong_kind");
  });
});
