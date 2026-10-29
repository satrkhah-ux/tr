import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «📜 إصدار قرار» is not guarded by its keyboard: any linked account can send any callback_data. Every management step
 * checks the caller BEFORE it reads or writes a decision; «✅ استلمت» acknowledges the caller's own copy and nobody
 * else's.
 */

const can = { manager: false };
const calls = vi.hoisted(() => ({
  acknowledge: vi.fn(async () => null),
  createDraft: vi.fn(),
  decisionPng: vi.fn(),
  deleteDraft: vi.fn(),
  directory: vi.fn(),
  getDecision: vi.fn(),
  issueDecision: vi.fn(),
  issuedDecisions: vi.fn(),
  loadSettings: vi.fn(),
  recipientOf: vi.fn(async () => null),
  recipientsOf: vi.fn(),
  resendTo: vi.fn(),
  resolveAudience: vi.fn(),
  setDraftText: vi.fn(),
  updateDraft: vi.fn(),
  restoreOriginal: vi.fn(),
  wordDraft: vi.fn(),
  dateTimeText: vi.fn(() => ""),
}));
const sent = vi.hoisted(() => ({
  send: vi.fn(),
  call: vi.fn(async () => ({ ok: true })),
  photo: vi.fn(),
}));

vi.mock("@/lib/decisions/decisions", () => calls);
vi.mock("./staff-manager", () => ({
  isBotManager: vi.fn(async () => can.manager),
}));
vi.mock("./staff-bot", () => ({
  escapeHtml: (s: string) => s,
  staffSend: sent.send,
  staffCall: sent.call,
  staffSendPhoto: sent.photo,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      upsert: vi.fn(),
      delete: () => ({ eq: () => ({ eq: vi.fn() }) }),
    }),
  }),
}));

const { decreeCallback, decreeHome, decreeText } =
  await import("./staff-decree");
const me = { id: "e1", name: "موظف", chatId: 1, agentId: null };
const D = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  can.manager = false;
  for (const f of [...Object.values(calls), ...Object.values(sent)])
    f.mockClear();
});

const touched = () =>
  Object.entries(calls).filter(
    ([name, f]) => name !== "dateTimeText" && f.mock.calls.length,
  );

describe("every management step checks the caller first", () => {
  for (const data of [
    "zn",
    "zl",
    `zv:${D}`,
    "zk:0",
    `zt:${D}:e`,
    `zg:${D}:a`,
    `zx:${D}`,
    `zw:${D}`,
    `zo:${D}`,
    `zp:${D}`,
    `zi:${D}`,
    `zc:${D}`,
  ]) {
    it(`${data}: a forged button from a non-manager reads and writes nothing`, async () => {
      const v = await decreeCallback(me, 1, data, 5);
      expect(v?.text).toMatch(/للإدارة/);
      expect(touched()).toEqual([]);
    });
  }

  it("the kinds screen and a pending text too", async () => {
    expect((await decreeHome(me)).text).toMatch(/للإدارة/);
    await decreeText(me, 1, "نص", D);
    expect(touched()).toEqual([]);
  });
});

describe("«✅ استلمت»", () => {
  it("acknowledges the caller's own copy only, whoever they are", async () => {
    await decreeCallback(me, 1, `zy:${D}`, 5);
    expect(calls.acknowledge).toHaveBeenCalledWith(
      D,
      { id: "e1", name: "موظف" },
      "bot",
    );
    await decreeCallback(me, 1, `zs:${D}`);
    expect(calls.resendTo).toHaveBeenCalledWith(D, "e1", 1);
  });
  it("a second tap shows the acknowledgement already stored, and stores nothing new", async () => {
    calls.acknowledge.mockResolvedValueOnce(null);
    calls.recipientOf.mockResolvedValueOnce({
      acknowledged_at: "2026-10-29T08:00:00.000Z",
    } as never);
    calls.getDecision.mockResolvedValueOnce({
      serial: "ق-2026-0001",
      kind: "تعميم",
      title: "t",
    } as never);
    await decreeCallback(me, 1, `zy:${D}`, 9);
    expect(calls.acknowledge).toHaveBeenCalledTimes(1);
    expect(sent.call).toHaveBeenCalledWith(
      "editMessageCaption",
      expect.objectContaining({ message_id: 9 }),
    );
  });
});
