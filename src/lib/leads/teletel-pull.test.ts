import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const state = vi.hoisted(() => ({ id: 0, source: "auto", patches: [] as Record<string, unknown>[] }));
vi.mock("@/lib/providers/teletel", () => ({
  listOpenConversations: async () => ({ rows: [{ id: state.id, phone: "966500000000", name: "Test", createdAt: 1, lastActivityAt: 10, waitingSince: 0, firstReplyAt: 2, labels: [], assignee: null, team: null }] }),
  conversationThread: async () => ({ historyComplete: true, messages: [{ id: 1, at: 1, text: "ابغى موعد BLS لإسبانيا", fromClient: true, isPrivate: false }] }),
}));
vi.mock("@/lib/data/all-rows", () => ({ allRows: async () => ({ data: [{
  id: "lead", phone: "966500000000", name: "Test", inquiry: "بكج", inquiry_source: state.source,
  destination: "إسبانيا", destination_source: "manual", received_by: "staff", status: "open",
  teletel_conversation_id: state.id, timeline_seen_at: 10, created_at: "1970-01-01T00:00:01Z",
}] }) }));
vi.mock("@/lib/leads/lifecycle", () => ({ onClientReturn: vi.fn(), recordClosed: vi.fn() }));
vi.mock("@/lib/murad/core", () => ({ muradMessageIds: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ logAudit: vi.fn() }));
import { pullTeletel } from "./teletel-pull";
function client() {
  return { from: () => {
    const query = {
      select: () => query, eq: () => query, or: () => query,
      update: (patch: Record<string, unknown>) => { state.patches.push(patch); return query; },
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  } } as unknown as SupabaseClient;
}
describe("automatic request refresh", () => {
  it.each(["auto", "manual"])("refreshes stale automatic services while protecting %s ownership", async (source) => {
    state.id += 1; state.source = source; state.patches = [];
    await pullTeletel(client());
    const classification = state.patches.filter(p => p.inquiry);
    expect(classification).toEqual(source === "auto" ? [expect.objectContaining({ inquiry: "تأشيرات", inquiry_source: "auto" })] : []);
  });
});
