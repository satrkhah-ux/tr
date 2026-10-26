import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «🏢 لوحة الإدارة» is not guarded by its keyboard: any linked account can send
 * any callback_data. Every screen checks the caller BEFORE it reads anything —
 * the snapshot, the operations digest, the visa board, Teletel — and «💰 المال»
 * refuses a manager without its permission even when the button is forged.
 */

const can = { manager: false, keys: new Set<string>() };
const reads = vi.hoisted(() => ({
  snapshot: vi.fn(),
  visas: vi.fn(),
  ops: vi.fn(),
  open: vi.fn(),
  agents: vi.fn(),
  summaries: vi.fn(),
  presence: vi.fn(),
  colleagues: vi.fn(),
}));

vi.mock("./staff-manager", () => ({ isBotManager: vi.fn(async () => can.manager), colleagues: reads.colleagues }));
vi.mock("@/lib/manager-screen/snapshot", () => ({ managerSnapshot: reads.snapshot }));
vi.mock("@/lib/data/visa-files", () => ({ getVisaBoard: reads.visas }));
vi.mock("./ops-digest", () => ({ buildOpsDigest: reads.ops }));
vi.mock("@/lib/providers/teletel", () => ({ listOpenConversations: reads.open, agentSummaries: reads.summaries, teletelGet: reads.agents }));
vi.mock("@/lib/routing/presence", () => ({ presenceOnlineAgentIds: reads.presence }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (_fn: string, args: { p_key: string }) => ({ data: can.keys.has(args.p_key) }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

const { adminTeamView, alertPickView, dayView, moneyView, opsVisaView, performanceView, systemView } = await import("./staff-admin");
const me = { id: "e1", name: "مدير", chatId: 1, agentId: null };
const every = { dayView, adminTeamView, performanceView, moneyView, opsVisaView, systemView, alertPickView };

beforeEach(() => {
  can.manager = false;
  can.keys = new Set();
  for (const f of Object.values(reads)) f.mockReset();
  reads.snapshot.mockResolvedValue(null);
  reads.visas.mockResolvedValue({ ok: false });
  reads.colleagues.mockResolvedValue([]);
});

describe("every administration screen checks the caller before reading", () => {
  for (const [name, view] of Object.entries(every)) {
    it(`${name}: a forged button from a non-manager reads nothing`, async () => {
      const v = await view(me);
      expect(v.text).toMatch(/للإدارة/);
      for (const f of Object.values(reads)) expect(f).not.toHaveBeenCalled();
    });
  }
});

describe("«💰 المال والتحصيل»", () => {
  it("refuses a manager without dashboard.admin / developer.access, before any read", async () => {
    can.manager = true;
    const v = await moneyView(me);
    expect(v.text).toBe("«المال والتحصيل» للإدارة العليا فقط.");
    expect(reads.snapshot).not.toHaveBeenCalled();
    expect(reads.ops).not.toHaveBeenCalled();
    expect(reads.visas).not.toHaveBeenCalled();
  });

  it("opens for the administration", async () => {
    can.manager = true;
    can.keys = new Set(["dashboard.admin"]);
    await moneyView(me);
    expect(reads.snapshot).toHaveBeenCalled();
  });
});
