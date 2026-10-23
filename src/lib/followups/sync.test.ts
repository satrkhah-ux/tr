import { beforeEach, expect, it, vi } from "vitest";
const now = Math.floor(Date.now() / 1000);
const state = vi.hoisted(() => ({
  leads: [] as Record<string, unknown>[], followups: [] as Record<string, unknown>[], conversations: [] as Record<string, unknown>[],
  employees: [] as Record<string, unknown>[], messages: [] as Record<string, unknown>[], inserts: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/providers/teletel", () => ({
  listOpenConversations: async () => ({ rows: state.conversations }),
  recentResolvedConversations: async () => [],
  teletelGet: async (path: string) => (path.endsWith("/messages") ? { payload: state.messages } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from(table: string) {
  const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  let payload: Record<string, unknown> | undefined;
  const query = {
    select: () => query, order: () => query, range: () => query, not: () => query, is: () => query, neq: () => query, limit: () => query,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return query; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return query; },
    insert: (p: Record<string, unknown>) => { payload = p; state.inserts.push(p); return query; },
    update: () => query,
    result: () => {
      if (payload) return { data: { id: "added" } };
      if (table === "app_settings") return { data: { value: "28" } };
      const rows = { client_leads: state.leads, sla_followups: state.followups, employees: state.employees }[table] ?? [];
      return { data: rows.filter((r) => filters.every((f) => f(r))) };
    },
    maybeSingle: async () => { const r = query.result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    single: async () => query.result(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(query.result()).then(resolve),
  }; return query;
} }) }));
import { syncFollowups } from "./service";
const quiet = { id: 42, teamId: 5, createdAt: now - 86400, waitingSince: 0, lastActivityAt: now - 3 * 3600, assigneeId: 9, name: "سالم", phone: "+966500000000" };
beforeEach(() => {
  state.leads = [{ teletel_conversation_id: 42, inquiry: "طلب غير واضح", status: "open", destination: "جورجيا", created_at: "2026-10-20T10:00:00Z" }];
  state.followups = []; state.inserts = [];
  state.employees = [{ id: "seller-1", arabic_name: "رهف", status: "Active", teletel_agent_id: 13, roles: { permission_keys: ["offers.write"] } }];
  state.messages = [];
  state.conversations = [{ ...quiet, waitingSince: now - 600, lastActivityAt: now - 600 }];
});
it("no longer queues an unclear request — intake keeps it (the owner, 2026-10-23)", async () => {
  expect((await syncFollowups()).added).toBe(0);
  expect(state.inserts).toHaveLength(0);
});
it("keeps queueing transfers to the follow-up team", async () => {
  state.conversations = [{ ...state.conversations[0], teamId: 28 }];
  expect((await syncFollowups()).added).toBe(1);
  expect(state.inserts[0]).toMatchObject({ source: "teletel", transfer_reason: "تحويل إلى فريق متابعة المبيعات" });
});
it("follows an offer the client went quiet after, as the seller who priced it", async () => {
  state.conversations = [quiet];
  state.messages = [
    { id: 1, created_at: now - 4 * 3600, message_type: 0, content: "كم سعر بكج جورجيا لشخصين؟" },
    { id: 2, created_at: now - 3 * 3600, message_type: 1, content: "سعر البكج 7 ليالي 8,400 ريال", sender: { id: 13 } },
  ];
  expect((await syncFollowups()).added).toBe(1);
  expect(state.inserts[0]).toMatchObject({ source: "price", step: 0, assigned_to: "seller-1", stage: "waiting", destination: "جورجيا", client_line: "كم سعر بكج جورجيا لشخصين؟" });
});
it("does not follow a question, nor an offer a closed file already followed", async () => {
  state.conversations = [quiet];
  state.messages = [{ id: 2, created_at: now - 3 * 3600, message_type: 1, content: "أي وجهة تفضل؟", sender: { id: 13 } }];
  expect((await syncFollowups()).added).toBe(0);
  state.conversations = [{ ...quiet, lastActivityAt: quiet.lastActivityAt + 1 }];
  state.messages = [{ id: 2, created_at: now - 3 * 3600, message_type: 1, content: "السعر 4500 ريال", sender: { id: 13 } }];
  state.followups = [{ conversation_id: 42, status: "done", done_at: new Date().toISOString(), created_at: "2026-10-20T11:00:00Z" }];
  expect((await syncFollowups()).added).toBe(0);
});
