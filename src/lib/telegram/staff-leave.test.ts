import { beforeEach, describe, expect, it, vi } from "vitest";

/** «🏖️ منح إجازة»: its own buttons only, a forged one reads nothing, and a leave that meets another is not saved twice. */

const state = vi.hoisted(() => ({
  manager: false,
  existing: [] as { starts_on: string; ends_on: string }[],
  inserts: [] as unknown[],
  tables: [] as string[],
}));
const spy = vi.hoisted(() => ({ colleagues: vi.fn(), send: vi.fn(), audit: vi.fn() }));

vi.mock("./staff-manager", () => ({ isBotManager: vi.fn(async () => state.manager), colleagues: spy.colleagues }));
vi.mock("./staff-bot", () => ({ staffSend: spy.send, escapeHtml: (s: string) => s }));
vi.mock("@/lib/data/audit", () => ({ logAudit: spy.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      state.tables.push(table);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) b[m] = () => b;
      b.insert = (row: unknown) => {
        state.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 9 }, error: null }) }) };
      };
      b.then = (ok: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: state.existing, error: null }).then(ok);
      return b;
    },
  }),
}));

const { grantLeave, leaveView, parseLeaveData } = await import("./staff-leave");
const me = { id: "m1", name: "المدير", chatId: 100, agentId: null };
const EMP = "0b1c2d3e-0000-4000-8000-000000000001";

beforeEach(() => {
  state.manager = false;
  state.existing = [];
  state.inserts = [];
  state.tables = [];
  for (const f of Object.values(spy)) f.mockReset();
  spy.colleagues.mockResolvedValue([{ id: EMP, name: "سامي", chatId: 777, agentId: 7 }]);
  spy.send.mockResolvedValue({ ok: true, messageId: 1 });
});

describe("«🏖️ منح إجازة» buttons", () => {
  it("reads only its own steps", () => {
    expect(parseLeaveData("lv")).toEqual({ ok: false, id: null, days: null, reason: null });
    expect(parseLeaveData(`lv:${EMP}:3:1`)).toEqual({ ok: false, id: EMP, days: 3, reason: 1 });
    expect(parseLeaveData(`lvok:${EMP}:7:0`)).toEqual({ ok: true, id: EMP, days: 7, reason: 0 });
    expect([
      parseLeaveData("lv:x"),
      parseLeaveData(`lv:${EMP}:4`),
      parseLeaveData(`lv:${EMP}:3:9`),
      parseLeaveData(`lvok:${EMP}:3`),
      parseLeaveData("lt"),
    ]).toEqual([null, null, null, null, null]);
  });

  it("a forged step from someone who is not a manager reads and saves nothing", async () => {
    expect((await leaveView(me, `lv:${EMP}:3:1`)).text).toBe("هذا للإدارة فقط.");
    await grantLeave(me, 100, `lvok:${EMP}:3:1`);
    expect(spy.colleagues).not.toHaveBeenCalled();
    expect(state.tables).toEqual([]);
    expect(spy.audit).not.toHaveBeenCalled();
  });
});

describe("for a manager", () => {
  beforeEach(() => {
    state.manager = true;
  });

  it("walks the colleague → days → reason → preview", async () => {
    expect((await leaveView(me, "lv")).buttons.flat().map((b) => b.text)).toContain("سامي");
    expect((await leaveView(me, `lv:${EMP}`)).text).toContain("كم يوماً من اليوم؟");
    expect((await leaveView(me, `lv:${EMP}:3`)).text).toContain("ما سببها؟");
    const preview = await leaveView(me, `lv:${EMP}:3:1`);
    expect(preview.text).toContain("السبب: مرضية");
    expect(preview.buttons[0][0]).toEqual({ text: "✅ امنح الإجازة", callback_data: `lvok:${EMP}:3:1` });
  });

  it("saves it, tells the colleague, records it", async () => {
    await grantLeave(me, 100, `lvok:${EMP}:1:0`);
    expect(state.inserts).toHaveLength(1);
    expect(spy.send.mock.calls.some((c) => c[0] === 777 && String(c[1]).includes("🏖️"))).toBe(true);
    expect(spy.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "presence.leave_added", entity_id: EMP }));
  });

  it("does not save a second leave over days already given", async () => {
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    state.existing = [{ starts_on: today, ends_on: today }];
    await grantLeave(me, 100, `lvok:${EMP}:3:0`);
    expect(state.inserts).toEqual([]);
    expect(spy.send.mock.calls[0][1]).toContain("تتقاطع");
  });
});
