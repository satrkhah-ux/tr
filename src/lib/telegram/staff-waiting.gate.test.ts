import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «⏳ المحادثات المنتظرة» behind its buttons: a forged callback from anyone who
 * is not a manager reads nothing; a nudge is refused inside fifteen minutes; and
 * what goes out goes to the colleague's Telegram only — Teletel is never written to.
 */

const state = vi.hoisted(() => ({
  manager: false,
  lastNudgeAt: null as string | null,
  claimed: { content: "العميل أبو فهد ينتظر ردّك منذ 2 س", target_id: "e7" } as { content: string; target_id: string | null } | null,
}));
const spy = vi.hoisted(() => ({
  open: vi.fn(),
  thread: vi.fn(),
  colleagues: vi.fn(),
  people: vi.fn(),
  online: vi.fn(),
  send: vi.fn(),
  call: vi.fn(),
  audit: vi.fn(),
  remember: vi.fn(),
  tables: [] as string[],
  inserts: [] as { table: string; row: unknown }[],
}));

/** a chainable stand-in for the service client: every call returns itself; the end answers per table */
function fakeDb() {
  return {
    rpc: vi.fn(),
    from(table: string) {
      spy.tables.push(table);
      const answer = (): unknown => {
        if (table === "audit_logs") return state.lastNudgeAt ? { created_at: state.lastNudgeAt } : null;
        if (table === "staff_bot_broadcasts") return writing === "insert" ? { id: 7 } : state.claimed;
        return null;
      };
      let writing: "insert" | "update" | null = null;
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order", "limit", "in", "gte", "like", "is"]) b[m] = () => b;
      b.insert = (row: unknown) => {
        writing = "insert";
        spy.inserts.push({ table, row });
        return b;
      };
      b.update = () => {
        writing = "update";
        return b;
      };
      b.maybeSingle = async () => ({ data: answer(), error: null });
      b.single = async () => ({ data: answer(), error: null });
      b.then = (ok: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => fakeDb() }));
vi.mock("./staff-manager", () => ({
  isBotManager: vi.fn(async () => state.manager),
  colleagues: spy.colleagues,
  broadcastText: (content: string, sender: string, alert = false) => `${alert ? "🔔 تنبيه من الإدارة" : "📢 إعلان من الإدارة"}\n\n${content}\n\n— ${sender}`,
}));
vi.mock("./staff-bot", () => ({ staffSend: spy.send, staffCall: spy.call, escapeHtml: (s: string) => s }));
vi.mock("./staff-replies", () => ({ rememberThread: spy.remember, whenText: () => "14:05" }));
// only reads exist here: a call to anything that writes to Teletel would throw
vi.mock("@/lib/providers/teletel", () => ({ listOpenConversations: spy.open, conversationThread: spy.thread, teletelConversationUrl: () => null }));
vi.mock("@/lib/followups/service", () => ({ followupPeople: spy.people }));
vi.mock("@/lib/mine/remind", () => ({ onlineAgents: spy.online }));
vi.mock("@/lib/data/audit", () => ({ logAudit: spy.audit }));

const w = await import("./staff-waiting");
const me = { id: "m1", name: "المدير", chatId: 100, agentId: null };
const NOW = Date.now() / 1000;

beforeEach(() => {
  state.manager = false;
  state.lastNudgeAt = null;
  state.claimed = { content: "العميل أبو فهد ينتظر ردّك منذ 2 س", target_id: "e7" };
  for (const f of [spy.open, spy.thread, spy.colleagues, spy.people, spy.online, spy.send, spy.call, spy.audit, spy.remember]) f.mockReset();
  spy.tables.length = 0;
  spy.inserts.length = 0;
  spy.open.mockResolvedValue({
    at: 0,
    rows: [
      { id: 11, name: "أبو فهد", phone: "+966500000001", assignee: "سامي", assigneeId: 7, waitingSince: NOW - 7200, lastActivityAt: NOW, preview: "" },
      { id: 12, name: "نورة", phone: "+966500000002", assignee: null, assigneeId: null, waitingSince: NOW - 600, lastActivityAt: NOW, preview: "" },
    ],
  });
  spy.colleagues.mockResolvedValue([{ id: "e7", name: "سامي", chatId: 777, agentId: 7 }]);
  spy.send.mockResolvedValue({ ok: true, messageId: 55 });
  spy.thread.mockResolvedValue({ messages: [], canReply: true, historyComplete: true });
});

describe("a forged button from someone who is not a manager reads nothing", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["list", () => w.waitingListView(me, "aw:all:0")],
    ["pick", () => w.waitingPickView(me)],
    ["conversation", () => w.waitingConvView(me, 11)],
    ["nudge", () => w.prepareNudge(me, 100, 11, false)],
    ["team nudge", () => w.prepareNudge(me, 100, 12, true)],
    ["confirm", () => w.confirmNudge(me, 100, 1, "bw:send:7:11")],
  ];
  for (const [name, call] of calls) {
    it(name, async () => {
      await call();
      expect(spy.open).not.toHaveBeenCalled();
      expect(spy.thread).not.toHaveBeenCalled();
      expect(spy.colleagues).not.toHaveBeenCalled();
      expect(spy.tables).toEqual([]);
      expect(spy.audit).not.toHaveBeenCalled();
    });
  }
});

describe("for a manager", () => {
  beforeEach(() => {
    state.manager = true;
  });

  it("lists the unassigned client as «بلا موظف» and offers the team nudge on it", async () => {
    const list = await w.waitingListView(me, "aw:none:0");
    expect(list.text).toContain("<b>نورة</b> — منذ 10 د — عند: بلا موظف");
    expect(list.text).not.toContain("أبو فهد");
    const conv = await w.waitingConvView(me, 12);
    expect(conv.buttons.flat().map((b) => b.text)).toContain("📢 نبّه الفريق");
  });

  it("refuses a second nudge inside fifteen minutes, and saves nothing", async () => {
    state.lastNudgeAt = new Date(Date.now() - 5 * 60_000).toISOString();
    await w.prepareNudge(me, 100, 11, false);
    expect(spy.send.mock.calls[0][1]).toContain("نُبِّه قبل 5 دقيقة");
    expect(spy.inserts).toEqual([]);
  });

  it("refuses at «إرسال» too when the window closed in the meantime", async () => {
    state.lastNudgeAt = new Date(Date.now() - 60_000).toISOString();
    await w.confirmNudge(me, 100, 1, "bw:send:7:11");
    expect(spy.send).toHaveBeenCalledTimes(1);
    expect(spy.send.mock.calls[0][0]).toBe(100);
    expect(spy.audit).not.toHaveBeenCalled();
  });

  it("sends the nudge to the colleague's chat only, with no line of the conversation, and records it", async () => {
    await w.confirmNudge(me, 100, 1, "bw:send:7:11");
    const toColleague = spy.send.mock.calls.filter((c) => c[0] === 777);
    expect(toColleague).toHaveLength(1);
    expect(toColleague[0][1]).toBe("🔔 تنبيه من الإدارة\n\nالعميل أبو فهد ينتظر ردّك منذ 2 س\n\n— المدير");
    expect(spy.send.mock.calls.every((c) => c[0] === 777 || c[0] === 100)).toBe(true);
    expect(spy.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff_bot.alert_sent", entity: "conversations", entity_id: "11", meta: expect.objectContaining({ to: "e7" }) }),
    );
  });
});
