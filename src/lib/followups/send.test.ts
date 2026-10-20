import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  row: { id: "11111111-1111-4111-8111-111111111111", assigned_to: "worker", status: "open", conversation_id: 42 },
  rpc: vi.fn(), send: vi.fn(), thread: vi.fn(),
}));
vi.mock("@/lib/roles/current", () => ({ currentCan: async (key: string) => key === "followups.work" }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => "worker" }));
vi.mock("@/lib/data/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/data/cron-runs", () => ({ recordCronRun: vi.fn() }));
vi.mock("@/lib/followups/service", () => ({
  followupDb: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.row }) }) }) }),
    rpc: mocks.rpc,
  }),
  followupRows: vi.fn(), enrollFollowup: vi.fn(), followupPeople: vi.fn(), followupTeamId: vi.fn(), syncFollowups: vi.fn(),
}));
vi.mock("@/lib/providers/teletel", () => ({
  conversationThread: mocks.thread, sendTeletelMessage: mocks.send,
  teletelGet: vi.fn(), listTeletelTeams: vi.fn(), listOpenConversations: vi.fn(), assignTeletelTeam: vi.fn(),
}));
import { sendFollowupReply } from "@/lib/data/followups";
const requestId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row.assigned_to = "worker";
  mocks.thread.mockResolvedValue({ canReply: true });
  mocks.rpc.mockResolvedValue({ data: { ok: true } });
  mocks.send.mockResolvedValue(123);
});
describe("follow-up outbound safety", () => {
  it("cannot send into another employee's file", async () => {
    mocks.row.assigned_to = "someone-else";
    expect(await sendFollowupReply(mocks.row.id, "hello", requestId)).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not resend a successfully reserved duplicate", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, duplicate: true, state: "sent" } });
    expect(await sendFollowupReply(mocks.row.id, "hello", requestId)).toMatchObject({ duplicate: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not send outside the provider reply window", async () => {
    mocks.thread.mockResolvedValue({ canReply: false });
    expect(await sendFollowupReply(mocks.row.id, "hello", requestId)).toMatchObject({ error: "window" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps ambiguous provider failure locked instead of retrying", async () => {
    mocks.send.mockResolvedValue(null);
    expect(await sendFollowupReply(mocks.row.id, "hello", requestId)).toMatchObject({ error: "uncertain" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenLastCalledWith("followup_action", expect.objectContaining({
      p_action: "finish_send", p_data: { requestId, state: "uncertain", messageId: null },
    }));
  });
  it("stops after a competing action acquired the lock", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error: "busy" } });
    expect(await sendFollowupReply(mocks.row.id, "hello", requestId)).toMatchObject({ error: "busy" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
