import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowedSecrets, cleanSecretValue, isForbiddenName, lastFour, namesInRef, rateLimited } from "./core";

/**
 * «المفاتيح والتوكنات»: write-only, env fallback, audit without the value,
 * non-developer refused. The database, the roles and the audit are faked; the
 * AES-GCM vault is the real one with a throwaway key.
 */

const SAMPLE = "sk_test_THIS-IS-A-FAKE-VALUE-1234";

// ---- an in-memory app_secrets / integrations / employees
const tables: Record<string, Record<string, unknown>[]> = {};
function query(table: string) {
  let rows = () => tables[table] ?? [];
  const filters: [string, unknown][] = [];
  const api = {
    select: () => api,
    eq: (col: string, v: unknown) => { filters.push([col, v]); return api; },
    maybeSingle: async () => ({ data: rows().find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows().filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
    upsert: async (row: Record<string, unknown>) => {
      tables[table] = [...(tables[table] ?? []).filter((r) => r.name !== row.name), row];
      return { error: null };
    },
    delete: () => ({ eq: async (col: string, v: unknown) => { tables[table] = (tables[table] ?? []).filter((r) => r[col] !== v); return { error: null }; } }),
  };
  void rows;
  rows = () => tables[table] ?? [];
  return api;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from: (t: string) => query(t) }) }));

let developer = true;
vi.mock("@/lib/roles/current", () => ({ currentCan: async (p: string) => p === "developer.access" && developer }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => "emp-dev" }));
const audits: { action: string; meta?: Record<string, unknown> }[] = [];
vi.mock("@/lib/data/audit", () => ({ logAudit: async (a: { action: string; meta?: Record<string, unknown> }) => { audits.push(a); return true; } }));
vi.mock("@/lib/developer/checks", () => ({ runCheck: async (id: string) => ({ id, status: "down", detail: { key: "dev.d.failed", params: { reason: "The token is not valid or expired!" } } }) }));

const { saveSecret, clearSecret, listSecrets, checkSecret } = await import("./actions");
const { getSecret, forgetSecrets } = await import("./get");

beforeEach(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  delete process.env.MYFATOORAH_API_KEY;
  tables.app_secrets = [];
  tables.integrations = [{ secret_ref: "MYFATOORAH_API_KEY / MYFATOORAH_BASE_URL", check_key: "pay_myfatoorah" }, { secret_ref: "SUPABASE_SERVICE_ROLE_KEY", check_key: "db" }];
  tables.employees = [{ id: "emp-dev", arabic_name: "المطوّر" }];
  audits.length = 0;
  developer = true;
  forgetSecrets();
});

describe("the rules", () => {
  it("names come from «الربط الخارجي»; the system's own keys are never settable", () => {
    expect(namesInRef("MYFATOORAH_API_KEY / MYFATOORAH_BASE_URL")).toEqual(["MYFATOORAH_API_KEY", "MYFATOORAH_BASE_URL"]);
    expect(isForbiddenName("SUPABASE_SERVICE_ROLE_KEY")).toBe(true);
    expect(isForbiddenName("SETTINGS_ENCRYPTION_KEY")).toBe(true);
    expect(isForbiddenName("NEXT_PUBLIC_SUPABASE_URL")).toBe(true);
    const names = allowedSecrets(tables.integrations as never).map((a) => a.name);
    expect(names).toContain("MYFATOORAH_API_KEY");
    expect(names).toContain("TAMARA_API_TOKEN");
    expect(names).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(allowedSecrets([]).find((a) => a.name === "RESERVATIONS_IMAP_PASSWORD")?.checkId).toBe("mail_reservations");
  });
  it("only the last four characters, one clean line, a write budget", () => {
    expect(lastFour(SAMPLE)).toBe("1234");
    expect(lastFour("abc")).toBe("••••");
    expect(cleanSecretValue("  key  ")).toBe("key");
    expect(cleanSecretValue("a\nb")).toBeNull();
    expect(cleanSecretValue("")).toBeNull();
    let stamps: number[] = [];
    for (let i = 0; i < 20; i++) stamps = rateLimited(stamps, 1000 + i, 20).next;
    expect(rateLimited(stamps, 1100, 20).blocked).toBe(true);
    expect(rateLimited(stamps, 1000 + 11 * 60_000, 20).blocked).toBe(false);
  });
});

describe("write-only vault", () => {
  it("a saved value is never returned, listed, stored in clear, or audited", async () => {
    const saved = await saveSecret("MYFATOORAH_API_KEY", SAMPLE);
    expect(saved).toEqual({ ok: true, last4: "1234" });
    expect(JSON.stringify(saved)).not.toContain(SAMPLE);
    // stored encrypted
    expect(JSON.stringify(tables.app_secrets)).not.toContain(SAMPLE);
    // the page's list: set, from the vault, last four — never the value
    const list = await listSecrets();
    const row = list!.rows.find((r) => r.name === "MYFATOORAH_API_KEY")!;
    expect(row).toMatchObject({ set: true, source: "vault", last4: "1234", updatedBy: "المطوّر" });
    expect(JSON.stringify(list)).not.toContain(SAMPLE);
    // audit: the name, never the value
    expect(audits.map((a) => a.action)).toEqual(["secrets.saved"]);
    expect(JSON.stringify(audits)).not.toContain(SAMPLE);
    // the server reads it
    expect(await getSecret("MYFATOORAH_API_KEY")).toBe(SAMPLE);
  });
  it("falls back to the server's environment, and back to it after a clear", async () => {
    process.env.MYFATOORAH_API_KEY = "env-value-5678";
    expect(await getSecret("MYFATOORAH_API_KEY")).toBe("env-value-5678");
    const list = await listSecrets();
    expect(list!.rows.find((r) => r.name === "MYFATOORAH_API_KEY")).toMatchObject({ source: "env", last4: "5678" });
    await saveSecret("MYFATOORAH_API_KEY", SAMPLE);
    expect(await getSecret("MYFATOORAH_API_KEY")).toBe(SAMPLE);
    expect(await clearSecret("MYFATOORAH_API_KEY")).toEqual({ ok: true });
    expect(await getSecret("MYFATOORAH_API_KEY")).toBe("env-value-5678");
    expect(audits.map((a) => a.action)).toEqual(["secrets.saved", "secrets.cleared"]);
  });
  it("a name outside the list, or the system's own key, is refused", async () => {
    expect(await saveSecret("SUPABASE_SERVICE_ROLE_KEY", SAMPLE)).toMatchObject({ ok: false });
    expect(await saveSecret("RANDOM_THING", SAMPLE)).toMatchObject({ ok: false });
    expect(tables.app_secrets).toHaveLength(0);
  });
  it("a non-developer is refused everything", async () => {
    developer = false;
    expect(await listSecrets()).toBeNull();
    expect(await saveSecret("MYFATOORAH_API_KEY", SAMPLE)).toMatchObject({ ok: false });
    expect(await clearSecret("MYFATOORAH_API_KEY")).toMatchObject({ ok: false });
    expect(await checkSecret("MYFATOORAH_API_KEY")).toMatchObject({ ok: false });
    expect(tables.app_secrets).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
  it("«افحص الآن» runs the integration's own check and shows the provider's answer", async () => {
    const r = await checkSecret("MYFATOORAH_API_KEY");
    expect(r).toMatchObject({ id: "pay_myfatoorah", status: "down" });
  });
});
