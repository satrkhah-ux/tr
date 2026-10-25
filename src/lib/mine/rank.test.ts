import { describe, expect, it } from "vitest";
import { dayCounts, DEFAULT_SETTINGS, parseSettings, quiet, rankDay, waitLevelNow, waitLevels, type FollowRow, type OpenConv } from "./rank";

// 2026-10-26 14:00 Riyadh
const NOW = Date.parse("2026-10-26T11:00:00Z");
const sec = (ms: number) => Math.floor(ms / 1000);
const H = 3600_000;
const conv = (id: number, over: Partial<OpenConv> = {}): OpenConv => ({ id, name: `عميل ${id}`, phone: "+966500000000", assigneeId: 7, waitingSince: 0, lastActivityAt: sec(NOW - H), canReply: true, preview: "", ...over });
const row = (id: number, over: Partial<FollowRow> = {}): FollowRow => ({
  id: `f${id}`,
  conversation_id: id,
  contact_name: null,
  contact_phone: null,
  status: "open",
  step: 1,
  next_followup_at: null,
  client_waiting: false,
  last_attempt_at: null,
  last_client_at: null,
  offer_id: null,
  offer_line: null,
  destination: null,
  summary: null,
  ...over,
});
const hot = { wants: "جورجيا", destination: "جورجيا", people: "", dates: "", offered: "", stopped: "", waiting_on: "us" as const, heat: "hot" as const, heat_why: "", next: "call" as const, advice: "اتصل به", draft: "", upto: 0, seen: 0, step: 1, at: "", unheard: false };
const base = { agentId: 7, open: [], rows: [], marks: new Map(), reminders: [], settings: DEFAULT_SETTINGS, nowMs: NOW };

describe("«متابعتي» — what is on me today", () => {
  it("puts the waiting first (longest first), then the quiet ones (an offer first), then hot, then offers due", () => {
    const items = rankDay({
      ...base,
      open: [
        conv(1, { waitingSince: sec(NOW - 10 * 60_000) }),
        conv(2, { waitingSince: sec(NOW - 2 * H) }),
        conv(3, { lastActivityAt: sec(NOW - 30 * H) }),
        conv(4, { lastActivityAt: sec(NOW - 50 * H) }),
        conv(5, { lastActivityAt: sec(NOW - 2 * H) }), // spoke 2 h ago: not quiet yet
        conv(9, { assigneeId: 8, waitingSince: sec(NOW - H) }), // a colleague's
      ],
      rows: [row(3, { offer_line: "عرض جورجيا" }), row(6, { summary: hot }), row(10, { next_followup_at: new Date(NOW - H).toISOString() })],
    });
    expect(items.map((i) => [i.conversationId, i.kind])).toEqual([
      [2, "waiting"],
      [1, "waiting"],
      [3, "silent"],
      [4, "silent"],
      [6, "hot"],
      [10, "offer"],
    ]);
    expect(dayCounts(items)).toMatchObject({ waiting: 2, silent: 2, hot: 1, offer: 1, total: 6 });
  });

  it("one card per client, the other reasons as tags, with Murad's reading", () => {
    const [item] = rankDay({ ...base, open: [conv(1, { waitingSince: sec(NOW - H) })], rows: [row(1, { summary: hot, client_waiting: true, offer_line: "عرض" })] });
    expect(item).toMatchObject({ kind: "waiting", tags: ["hot", "offer"], wants: "جورجيا", next: "call", advice: "اتصل به", followupId: "f1" });
  });

  it("a hot client spoken to today is not «hot» again", () => {
    expect(rankDay({ ...base, rows: [row(6, { summary: hot, last_attempt_at: new Date(NOW - H).toISOString() })] })).toEqual([]);
    expect(rankDay({ ...base, open: [conv(6)], rows: [row(6, { summary: hot })] })).toEqual([]);
  });

  it("«تمّت» hides a card until something new — the client writes or the next step comes due", () => {
    const marks = new Map([[3, { done_at: new Date(NOW - 10 * 60_000).toISOString(), note: "اتصلت" }]]);
    const quietOne = conv(3, { lastActivityAt: sec(NOW - 30 * H) });
    expect(rankDay({ ...base, open: [quietOne], marks })).toEqual([]);
    const wrote = conv(3, { waitingSince: sec(NOW - 60_000), lastActivityAt: sec(NOW - 60_000) });
    expect(rankDay({ ...base, open: [wrote], marks })[0]).toMatchObject({ kind: "waiting", note: "اتصلت" });
    const stepDue = row(3, { next_followup_at: new Date(NOW - 60_000).toISOString() });
    expect(rankDay({ ...base, open: [quietOne], rows: [stepDue], marks })[0]?.kind).toBe("silent");
  });

  it("«ذكّرني» hides the client until due, then shows it once, as the reminder", () => {
    const waiting = conv(1, { waitingSince: sec(NOW - H) });
    const later = { id: 5, conversation_id: 1, text: "اتصل بعد الظهر", due_at: new Date(NOW + H).toISOString(), done_at: null };
    expect(rankDay({ ...base, open: [waiting], reminders: [later] })).toEqual([]);
    const due = { ...later, due_at: new Date(NOW - 60_000).toISOString() };
    const items = rankDay({ ...base, open: [waiting], reminders: [due, { id: 6, conversation_id: null, text: "اجتماع الفريق", due_at: new Date(NOW - 1000).toISOString(), done_at: null }] });
    expect(items.map((i) => [i.key, i.kind, i.tags])).toEqual([
      ["r:5", "reminder", ["waiting"]],
      ["r:6", "reminder", []],
    ]);
    expect(items[1].name).toBe("اجتماع الفريق");
  });

  it("an employee with no Teletel account still sees their offer follow-ups", () => {
    expect(rankDay({ ...base, agentId: null, open: [conv(1, { waitingSince: sec(NOW - H) })], rows: [row(2, { client_waiting: true })] }).map((i) => i.conversationId)).toEqual([2]);
  });
});

describe("«متابعتي» settings", () => {
  it("keeps sane bounds and falls back to the defaults", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"silentHours":6,"waitMinutes":1,"quietFrom":22,"repeatMinutes":"x"}')).toEqual({ ...DEFAULT_SETTINGS, silentHours: 6, quietFrom: 22 });
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
  });

  it("reminds a wait at the employee's first time and once more, a hot client at five minutes too, nothing past three hours", () => {
    expect(waitLevels(DEFAULT_SETTINGS, false)).toEqual([15, 60]);
    expect(waitLevels(DEFAULT_SETTINGS, true)).toEqual([5, 15, 60]);
    expect(waitLevels({ waitMinutes: 120, repeatMinutes: 90 }, false)).toEqual([120]);
    expect([10, 20, 61, 179, 180].map((m) => waitLevelNow([15, 60], m))).toEqual([null, 15, 60, 60, null]);
    expect(waitLevelNow([5, 15, 60], 7)).toBe(5);
  });

  it("quiet hours wrap midnight in Riyadh time", () => {
    const at = (h: number) => Date.parse(`2026-10-26T${String((h + 21) % 24).padStart(2, "0")}:30:00Z`);
    expect([22, 23, 0, 8, 9, 14].map((h) => quiet({ quietFrom: 23, quietTo: 9 }, at(h)))).toEqual([false, true, true, true, false, false]);
    expect(quiet({ quietFrom: 13, quietTo: 15 }, at(14))).toBe(true);
    expect(quiet({ quietFrom: 9, quietTo: 9 }, at(3))).toBe(false);
  });
});
