import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ leads: [] as Record<string, unknown>[], followups: [] as Record<string, unknown>[], conversations: [] as Record<string, unknown>[], inserts: [] as Record<string, unknown>[] }));
vi.mock("@/lib/providers/teletel", () => ({ listOpenConversations: async () => ({ rows: state.conversations }), teletelGet: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from(table: string) {
  const filters: [string, unknown][] = [];
  let payload: Record<string, unknown> | undefined;
  const query = {
    select: () => query, order: () => query, range: () => query, not: () => query, is: () => query,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
    insert: (p: Record<string, unknown>) => { payload = p; state.inserts.push(p); return query; },
    update: () => query,
    result: () => {
      if (payload) return { data: { id: "added" } };
      if (table === "app_settings") return { data: { value: "28" } };
      const rows = table === "client_leads" ? state.leads : table === "sla_followups" ? state.followups : [];
      return { data: rows.filter(r => filters.every(([k,v]) => r[k] === v)) };
    },
    maybeSingle: async () => { const r = query.result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    single: async () => query.result(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(query.result()).then(resolve),
  }; return query;
} }) }));
import { syncFollowups } from "./service";
beforeEach(() => {
  state.leads = [{ teletel_conversation_id: 42, inquiry: "طلب غير واضح", status: "open", created_at: "2026-10-20T10:00:00Z" }];
  state.followups = []; state.inserts = [];
  state.conversations = [{ id: 42, teamId: 5, createdAt: 1792490400, waitingSince: 1792490400 }];
});
it("queues an unclear request even outside the configured follow-up team", async () => {
  expect((await syncFollowups()).added).toBe(1);
  expect(state.inserts[0]).toMatchObject({ source: "sla", stage: "new", transfer_reason: "طلب غير واضح — متابعة العميل لتحديد الخدمة المطلوبة" });
});
it("does not queue known services or unread placeholders", async () => {
  for (const inquiry of ["طيران", null]) {
    state.leads[0].inquiry = inquiry;
    expect((await syncFollowups()).added).toBe(0);
  }
  expect(state.inserts).toHaveLength(0);
});
it("does not duplicate active follow-up work", async () => {
  state.followups = [{ id: "existing", conversation_id: 42, status: "open", stage: "working", source: "sla", created_at: "2026-10-20T11:00:00Z" }];
  expect((await syncFollowups()).added).toBe(0);
});
it("does not reopen completed work without a new client message or visit", async () => {
  state.followups = [{ conversation_id: 42, status: "done", done_at: "2026-10-21T00:00:00Z", created_at: "2026-10-20T11:00:00Z" }];
  expect((await syncFollowups()).added).toBe(0);
  state.leads[0].last_visit_at = "2026-10-21T01:00:00Z";
  expect((await syncFollowups()).added).toBe(1);
});
