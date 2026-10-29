import { beforeEach, describe, expect, it, vi } from "vitest";

/** «أرسل الخطأ لمُراد» on the server: cleaned again, our texts without the model, one report per occurrence. */

const inserted: Record<string, unknown>[] = [];
const db = {
  from: () => {
    const api = {
      insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; },
      select: () => api, eq: () => api, gte: () => api, order: () => api,
      limit: async () => ({ data: inserted.map((r, i) => ({ id: String(i), created_at: "2026-10-29T10:00:00Z", ...r })), error: null }),
      then: (resolve: (v: { count: number; error: null }) => void) => resolve({ count: 0, error: null }),
    };
    return api;
  },
};
vi.mock("./core", () => ({
  currentSecretaryEmployee: async () => ({ id: "11111111-1111-1111-1111-111111111111", name: "سارة", agentId: null, chatId: null }),
  secretaryDb: () => db,
  secretarySettings: async () => ({ off: false, dailyLimit: 30 }),
  secretaryBriefing: async () => ({}),
  renderBriefing: () => "",
  planText: () => "",
}));
const helpCalls: string[] = [];
vi.mock("./help", () => ({ helpReply: async (q: string) => { helpCalls.push(q); return "شرح النموذج"; } }));
vi.mock("@/lib/murad/model", () => ({ muradJson: async () => null }));
vi.mock("@/lib/roles/current", () => ({ currentCan: async () => false }));
const audits: { action: string; meta?: unknown }[] = [];
vi.mock("@/lib/data/audit", () => ({ logAudit: async (a: { action: string; meta?: unknown }) => { audits.push(a); return true; } }));
const seen = new Set<string>();
const notices: { dedupeKey?: string; title: string; body?: string }[] = [];
vi.mock("@/lib/notifications/notify", () => ({
  notifyEmployee: async (n: { dedupeKey?: string; title: string; body?: string }) => {
    notices.push(n);
    if (seen.has(n.dedupeKey!)) return { ok: true, created: 0 };
    seen.add(n.dedupeKey!);
    return { ok: true, created: 1 };
  },
}));

const { explainErrorToSecretary, reportErrorToAdmin } = await import("./chat");

const RAW = {
  message: "لا تملك صلاحية لهذا الإجراء.\n    at writeAccess (src/lib/data/actions.ts:42:11)\nBearer abcdefghijklmnopqrstu",
  route: "/operations/42abc?token=SECRET123",
  action: "recordPayment",
  at: "2026-10-29T10:00:05.000Z",
};

beforeEach(() => {
  inserted.length = 0;
  audits.length = 0;
  notices.length = 0;
  helpCalls.length = 0;
  seen.clear();
});

describe("explain + report", () => {
  it("our known text is explained without the model, and nothing secret is stored", async () => {
    const r = await explainErrorToSecretary(RAW);
    expect(r.ok).toBe(true);
    expect(helpCalls).toHaveLength(0);
    const stored = JSON.stringify(inserted) + JSON.stringify(audits);
    for (const leaked of ["actions.ts", "abcdefghijklmnopqrstu", "SECRET123", "token="]) expect(stored).not.toContain(leaked);
    expect(inserted.at(-1)?.content).toContain("صلاحية");
  });

  it("an unknown error goes to the model", async () => {
    await explainErrorToSecretary({ ...RAW, message: "Unexpected end of JSON input" });
    expect(helpCalls).toHaveLength(1);
  });

  it("«أبلغ الإدارة»: one notice + one audit row per occurrence, however often pressed", async () => {
    expect(await reportErrorToAdmin(RAW)).toEqual({ ok: true, already: false });
    expect(await reportErrorToAdmin(RAW)).toEqual({ ok: true, already: true });
    expect(await reportErrorToAdmin({ ...RAW, at: "2026-10-29T10:00:40.000Z" })).toEqual({ ok: true, already: true });
    expect(audits.filter((a) => a.action === "secretary.error_reported")).toHaveLength(1);
    expect(JSON.stringify(notices)).not.toContain("SECRET123");
    expect(JSON.stringify(notices)).not.toContain("actions.ts");
    // a later occurrence is a new report
    expect(await reportErrorToAdmin({ ...RAW, at: "2026-10-29T10:05:00.000Z" })).toEqual({ ok: true, already: false });
  });

  it("an empty error is refused", async () => {
    expect(await reportErrorToAdmin({ message: "  " })).toMatchObject({ ok: false });
    expect(await explainErrorToSecretary(null)).toMatchObject({ ok: false });
  });
});
