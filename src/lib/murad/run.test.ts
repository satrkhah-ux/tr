import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The minute job end to end, with Teletel, the model and the database all
 * faked — nothing is ever sent from a test. What it proves: a listed number
 * gets a reply and everyone else only a staff note; the turn is claimed before
 * the model is asked and never asked twice; the cap and the lease stop a run;
 * a colleague who answers while the model writes is never talked over.
 */

const NOW = Math.floor(Date.now() / 1000);
const LISTED = "+966511111111";
const STRANGER = "+966500000002";

type Row = Record<string, unknown>;
type Msg = { id: number; created_at: number; message_type: number; private?: boolean; content: string; sender_type?: string };

const s = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  log: [] as Row[],
  threads: new Map<number, Msg[][]>(),
  reads: new Map<number, number>(),
  sent: [] as { id: number; text: string }[],
  notes: [] as { id: number; text: string }[],
  labels: [] as { id: number; labels: string[] }[],
  asked: 0,
}));

const conversation = (id: number, phone: string, quietMin: number) => ({
  id,
  inboxId: 11,
  contactId: id,
  name: `c${id}`,
  phone,
  assignee: null,
  team: null,
  teamId: null,
  waitingSince: NOW - quietMin * 60,
  firstReplyAt: NOW - 3600,
  lastActivityAt: NOW - quietMin * 60,
  createdAt: NOW - 7200,
  canReply: true,
  preview: "",
  labels: [],
});
const OPEN = [conversation(1, LISTED, 6), conversation(2, STRANGER, 7)];
const PHONE: Record<number, string> = { 1: LISTED, 2: STRANGER };

/** A chainable stand-in for the supabase client: records the filters, answers per table and operation. */
function fakeDb() {
  return {
    from(table: string) {
      const q = { op: "select", payload: undefined as unknown, filters: [] as unknown[][], head: false };
      const run = (): { data: unknown; error: unknown; count?: number } => {
        const eq = (col: string) => q.filters.find((f) => f[0] === "eq" && f[1] === col)?.[2];
        if (table === "app_settings") {
          if (q.op === "insert") {
            const row = q.payload as { key: string; value: string };
            if (s.settings.has(row.key)) return { data: null, error: { code: "23505" } };
            s.settings.set(row.key, row.value);
            return { data: null, error: null };
          }
          if (q.op === "delete") {
            if (s.settings.get(String(eq("key"))) === eq("value")) s.settings.delete(String(eq("key")));
            return { data: null, error: null };
          }
          if (q.op === "update") return { data: [], error: null };
          if (q.op === "upsert") return { data: null, error: null };
          return { data: [...s.settings].map(([key, value]) => ({ key, value })), error: null };
        }
        if (table === "murad_log") {
          if (q.op === "insert") {
            const row = q.payload as Row;
            if (s.log.some((r) => r.conversation_id === row.conversation_id && r.client_message_id === row.client_message_id)) return { data: null, error: { code: "23505" } };
            const made = { ...row, id: `log-${s.log.length + 1}`, acted_at: null, staff_replied_at: null, reply_message_id: null };
            s.log.push(made);
            return { data: { id: made.id }, error: null };
          }
          if (q.op === "update") {
            for (const r of s.log) if (r.id === eq("id")) Object.assign(r, q.payload as Row);
            return { data: null, error: null };
          }
          if (q.head) return { data: null, error: null, count: s.log.filter((r) => r.provider).length };
          return { data: s.log, error: null };
        }
        return { data: q.op === "select" && q.filters.some((f) => f[0] === "maybeSingle") ? null : [], error: null };
      };
      const b: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
      };
      for (const op of ["insert", "update", "upsert", "delete"]) b[op] = (payload?: unknown) => ((q.op = op), (q.payload = payload), b);
      b.select = (_cols?: string, opts?: { head?: boolean }) => ((q.head = Boolean(opts?.head)), b);
      for (const m of ["eq", "in", "not", "is", "lt", "lte", "gte", "ilike", "or", "order", "limit", "single", "maybeSingle"]) b[m] = (...args: unknown[]) => (q.filters.push([m, ...args]), b);
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => fakeDb() }));
vi.mock("@/lib/features-server", () => ({ getFeatureFlags: async () => ({ murad_suggest: true, murad_auto: true }) }));
vi.mock("@/lib/data/client-trip", () => ({ getClientTrip: async () => null }));
vi.mock("@/lib/data/operation-hub", () => ({ getClientHub: async () => null }));
vi.mock("@/lib/data/destination-guides", () => ({ getTripGuide: async () => null }));
vi.mock("./model", () => ({
  muradProvider: () => ({ provider: "openai", model: "test-model" }),
  muradReply: async () => ((s.asked += 1), { reply: "هلا والله، وش الوجهة؟", needsStaff: false, reason: "استفسار" }),
}));
// Teletel — reads come from the threads above; every write is only recorded
vi.mock("@/lib/providers/teletel", async (actual) => ({
  ...(await actual<typeof import("@/lib/providers/teletel")>()),
  getTeletelConfig: () => ({ baseUrl: "https://example.invalid", token: "t", accountId: "1" }),
  listOpenConversations: async () => ({ rows: OPEN, at: Date.now() }),
  teletelGet: async (path: string) => {
    const id = Number(path.split("/")[2]);
    if (path.endsWith("/messages")) {
      const versions = s.threads.get(id) ?? [[]];
      const n = s.reads.get(id) ?? 0;
      s.reads.set(id, n + 1);
      return { payload: versions[Math.min(n, versions.length - 1)] };
    }
    return { can_reply: true, labels: [], meta: { sender: { name: `c${id}`, phone_number: PHONE[id] } } };
  },
  sendTeletelMessage: async (id: number, text: string) => (s.sent.push({ id, text }), 9000 + id),
  addTeletelNote: async (id: number, text: string) => (s.notes.push({ id, text }), true),
  addTeletelLabels: async (id: number, labels: string[]) => (s.labels.push({ id, labels }), true),
}));

const clientSaid = (id: number, minAgo: number): Msg => ({ id, created_at: NOW - minAgo * 60, message_type: 0, content: "السلام عليكم، أبي عرض" });

async function freshRun() {
  vi.resetModules();
  return (await import("./run")).runMurad();
}

beforeEach(() => {
  s.settings = new Map([["client_whatsapp", "all"], ["murad_auto_phones", JSON.stringify([LISTED])]]);
  s.log = [];
  s.threads = new Map([
    [1, [[clientSaid(501, 6)]]],
    [2, [[clientSaid(601, 7)]]],
  ]);
  s.reads = new Map();
  s.sent = [];
  s.notes = [];
  s.labels = [];
  s.asked = 0;
});

describe("the minute job", { timeout: 30_000 }, () => {
  it("replies only to the listed number; the stranger's conversation gets a staff note and nothing else", async () => {
    const summary = await freshRun();
    expect(summary).toMatchObject({ auto: 1, suggest: 1, used: 2 });
    expect(s.sent).toEqual([{ id: 1, text: "هلا والله، وش الوجهة؟" }]);
    expect(s.sent.some((x) => x.id === 2)).toBe(false);
    expect(s.notes.find((n) => n.id === 2)?.text).toMatch(/^💡 رد مقترح من مُراد: /);
    expect(s.notes.find((n) => n.id === 1)?.text).toMatch(/^🤖 مُراد ردّ تلقائياً/);
    expect(s.labels).toEqual([{ id: 1, labels: ["مراد"] }]);
    expect(s.log.map((r) => [r.conversation_id, r.client_message_id, r.mode, r.reply_message_id])).toEqual([
      [1, 501, "auto", 9001],
      [2, 601, "suggest", null],
    ]);
    // the lease is given back
    expect(s.settings.has("murad_run_lock")).toBe(false);
  });

  it("never asks the model twice about the same client message", async () => {
    await freshRun();
    expect(s.asked).toBe(2);
    // a new process (no memory of what it read): the log alone keeps the turns answered
    for (const r of s.log) r.acted_at = new Date((NOW - 30 * 60) * 1000).toISOString();
    const again = await freshRun();
    expect(s.asked).toBe(2);
    expect(again).toMatchObject({ auto: 0, suggest: 0 });
    expect(s.sent).toHaveLength(1);
  });

  it("a non-listed number is never auto-answered, even on an empty list and with every switch on", async () => {
    s.settings.set("murad_auto_phones", "[]");
    await freshRun();
    expect(s.sent).toEqual([]);
    expect(s.log.every((r) => r.mode === "suggest")).toBe(true);
  });

  it("stops at the daily cap", async () => {
    s.settings.set("murad_daily_cap", "1");
    const summary = await freshRun();
    expect(s.asked).toBe(1);
    expect(summary).toMatchObject({ capped: true, used: 1, cap: 1 });
  });

  it("a run already working keeps the next one out", async () => {
    s.settings.set("murad_run_lock", "another-run");
    expect(await freshRun()).toEqual({ skipped: "busy" });
    expect(s.asked).toBe(0);
    expect(s.settings.get("murad_run_lock")).toBe("another-run");
  });

  it("a colleague who answers while the model writes is not talked over", async () => {
    const human: Msg = { id: 502, created_at: NOW - 10, message_type: 1, content: "هلا، معك أحمد", sender_type: "user" };
    s.threads.set(1, [[clientSaid(501, 6)], [clientSaid(501, 6), human]]);
    await freshRun();
    expect(s.sent).toEqual([]);
    expect(s.log.find((r) => r.conversation_id === 1)).toMatchObject({ mode: "skipped", error: "turn_changed" });
  });
});
