import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const { setTemporaryPassword } = await import("./temp-password");

/** auth.admin and the two link tables, as setTemporaryPassword reads them. */
function fakeAdmin(user: { last_sign_in_at: string | null; app_metadata?: Record<string, unknown> }, links: { employee?: boolean; partner?: boolean } = {}, revokeFails = false) {
  const updates: Record<string, unknown>[] = [];
  const revoked: unknown[] = [];
  const admin = {
    rpc: async (fn: string, args: unknown) => (revoked.push({ fn, args }), { data: 1, error: revokeFails ? { message: "x" } : null }),
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
  return { admin: admin as unknown as SupabaseClient, updates, revoked };
}

describe("a new temporary password for any login (the owner, 2026-10-22)", () => {
  it("sets it on a never-used login, confirmed, with the first sign-in forced to change it", async () => {
    const { admin, updates } = fakeAdmin({ last_sign_in_at: null, app_metadata: { provider: "email" } }, { partner: true });
    expect(await setTemporaryPassword(admin, "u1", "Rq7-mountain-42", "partner")).toBe("ok");
    expect(updates[0]).toMatchObject({ password: "Rq7-mountain-42", email_confirm: true, app_metadata: { provider: "email", must_change_password: true } });
  });

  it("resets a login already in use and signs it out of every device", async () => {
    const { admin, updates, revoked } = fakeAdmin({ last_sign_in_at: "2026-10-18T09:00:00Z" }, { employee: true });
    expect(await setTemporaryPassword(admin, "u1", "Rq7-mountain-42", "staff")).toBe("ok");
    expect(updates[0]).toMatchObject({ password: "Rq7-mountain-42", app_metadata: { must_change_password: true } });
    expect(revoked).toEqual([{ fn: "revoke_user_sessions", args: { target: "u1" } }]);
  });

  it("says so when the old sessions could not be ended", async () => {
    const { admin } = fakeAdmin({ last_sign_in_at: "2026-10-18T09:00:00Z" }, { employee: true }, true);
    expect(await setTemporaryPassword(admin, "u1", "Rq7-mountain-42", "staff")).toBe("sessions_kept");
  });

  it("never sets a staff login's password from the partner screen, nor a partner's from the staff screen", async () => {
    expect(await setTemporaryPassword(fakeAdmin({ last_sign_in_at: null }, { employee: true }).admin, "u1", "Rq7-mountain-42", "partner")).toBe("wrong_kind");
    expect(await setTemporaryPassword(fakeAdmin({ last_sign_in_at: null }, { partner: true }).admin, "u1", "Rq7-mountain-42", "staff")).toBe("wrong_kind");
  });
});
