import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), assign: vi.fn(), notes: vi.fn(), members: [] as unknown[] }));
vi.mock("@/lib/providers/teletel", () => ({
  teletelGet: mocks.get, assignMuradHandoff: mocks.assign, addTeletelNote: mocks.notes,
  listTeletelTeams: async () => [{ id: 1, name: "قسم فيزا" }],
  listOpenConversations: async () => ({ rows: [] }), conversationEvents: async () => [],
}));
import { routeCompletedVisa } from "./visa-routing";
import type { SupabaseClient } from "@supabase/supabase-js";
function service() {
  const writes: { table: string; patch: Record<string, unknown> }[] = [];
  const db = { from(table: string) {
    const chain = {
      update(patch: Record<string, unknown>) { writes.push({ table, patch }); return chain; },
      eq() { return chain; }, select() { return chain; },
      async maybeSingle() { return { data: table === "murad_log" ? { conversation_id: 42, created_at: new Date().toISOString(), intake: {} } : { id: "lead", murad_receipt: { receivedAt: new Date().toISOString(), waitSec: 40 } }, error: null }; },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) { return Promise.resolve(resolve({ data: [], error: null })); },
    }; return chain;
  } } as unknown as SupabaseClient;
  return { db, writes };
}
beforeEach(() => { vi.clearAllMocks(); mocks.assign.mockResolvedValue(true); mocks.notes.mockResolvedValue(true); });
describe("confirmed visa routing", () => {
  it("clears the assignee and records the department when everyone is offline", async () => {
    mocks.get.mockImplementation(async (path: string) => path.endsWith("team_members") ? [{ id: 17, name: "موظف", availability_status: "offline", inbox_ids: [75] }] : { inbox_id: 75, status: "open", meta: { team: { id: 1 }, assignee: null } });
    const { db, writes } = service(); expect(await routeCompletedVisa(db, "log")).toBe(true);
    expect(mocks.assign).toHaveBeenCalledWith(42, 1, null);
    expect(writes.find((w) => w.table === "client_leads")?.patch).toMatchObject({ assigned_to_name: "قسم فيزا", murad_receipt: { agent: null, team: "قسم فيزا", pending: false } });
  });
  it("does not record a successful assignment if Teletel selected somebody else", async () => {
    mocks.get.mockResolvedValue({ inbox_id: 75, status: "open", meta: { team: { id: 1 }, assignee: { id: 99 } } });
    mocks.get.mockImplementation(async (path: string) => path.endsWith("team_members") ? [] : { inbox_id: 75, status: "open", meta: { team: { id: 1 }, assignee: { id: 99 } } });
    const { db, writes } = service(); expect(await routeCompletedVisa(db, "log")).toBe(false);
    expect(writes.some((w) => w.table === "client_leads")).toBe(false);
    expect(writes.at(-1)?.patch).toMatchObject({ reason: "visa:handoff_pending" });
  });
});
