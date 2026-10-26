import { describe, expect, it } from "vitest";
import {
  filterLabel,
  managerThreadText,
  nudgeContent,
  nudgedRecently,
  nudgedText,
  parseWaitData,
  pickWaiting,
  teamNudgeContent,
  toneOf,
  waitListView,
  type WaitRow,
} from "./staff-waiting-core";
import { waitText } from "./staff-numbers";

const t = { waitAmberMin: 5, waitRedMin: 15 };
const row = (id: number, minutes: number, over: Partial<WaitRow> = {}): WaitRow => ({
  id,
  name: `عميل ${id}`,
  minutes,
  agentId: 7,
  employeeId: "e7",
  holder: "سامي",
  ...over,
});
const rows = [
  row(1, 3),
  row(2, 120),
  row(3, 9, { agentId: null, employeeId: null, holder: null }),
  row(4, 40, { agentId: 9, employeeId: null, holder: "حساب مشترك" }),
  row(5, 16, { employeeId: "e8", holder: "فارس" }),
];
const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("«⏳ المحادثات المنتظرة» list", () => {
  it("reads only its own buttons", () => {
    expect(parseWaitData("aw:all:0")).toEqual({ filter: { kind: "all" }, page: 0 });
    expect(parseWaitData("aw:e:0b1c2d3e-0000-4000-8000-000000000001:2")).toEqual({
      filter: { kind: "emp", id: "0b1c2d3e-0000-4000-8000-000000000001" },
      page: 2,
    });
    expect([parseWaitData("aw:e:x:0"), parseWaitData("aw:all:-1"), parseWaitData("aw:all"), parseWaitData("av:1")]).toEqual([null, null, null, null]);
  });

  it("puts the longest wait first, and filters red, unassigned or one colleague", () => {
    expect(pickWaiting(rows, { kind: "all" }, t).map((r) => r.id)).toEqual([2, 4, 5, 3, 1]);
    expect(pickWaiting(rows, { kind: "red" }, t).map((r) => r.id)).toEqual([2, 4, 5]);
    // «بلا موظف» = nobody holds it; a shared Teletel account is somebody
    expect(pickWaiting(rows, { kind: "none" }, t).map((r) => r.id)).toEqual([3]);
    expect(pickWaiting(rows, { kind: "emp", id: "e7" }, t).map((r) => r.id)).toEqual([2, 1]);
    expect([toneOf(15, t), toneOf(5, t), toneOf(4, t)]).toEqual(["red", "amber", "plain"]);
    expect(filterLabel({ kind: "emp", id: "e8" }, "فارس")).toBe("لدى فارس");
  });

  it("says who holds each one, «بلا موظف» when nobody does, fifteen to a page", () => {
    const many = Array.from({ length: 17 }, (_, i) => row(100 + i, 100 - i));
    const first = waitListView({
      rows: [...pickWaiting(rows, { kind: "all" }, t)],
      all: 5,
      filter: { kind: "all" },
      label: "الكل",
      page: 0,
      t,
      waitText,
      escape: esc,
    });
    expect(first.text).toContain("⏳ <b>المحادثات المنتظرة</b> — 5");
    expect(first.text).toContain("1. 🔴 <b>عميل 2</b> — منذ 2 س — عند: سامي");
    expect(first.text).toContain("4. 🟠 <b>عميل 3</b> — منذ 9 د — عند: بلا موظف");
    expect(first.text).toContain("عند: حساب مشترك");
    const paged = waitListView({ rows: many, all: 17, filter: { kind: "all" }, label: "الكل", page: 1, t, waitText, escape: esc });
    expect(paged.text).toContain("16. ");
    expect(paged.text).toContain("صفحة 2 من 2");
    expect(paged.buttons.flat().map((b) => (b as { callback_data?: string }).callback_data)).toContain("aw:all:0");
    const none = waitListView({ rows: [], all: 5, filter: { kind: "none" }, label: "بلا موظف", page: 0, t, waitText, escape: esc });
    expect(none.text).toContain("— 0 من 5");
    expect(none.text).toContain("لا محادثة تنتظر الرد هنا الآن ✅");
  });
});

describe("a conversation read by the administration", () => {
  const lines = [
    { id: 1, at: 1, text: "كم السعر؟", fromClient: true, sender: "أبو فهد", isPrivate: false },
    { id: 2, at: 2, text: "العميل حساس للسعر، لا تعطه خصماً", fromClient: false, sender: "رشا", isPrivate: true },
    { id: 3, at: 3, text: "أهلاً بك", fromClient: false, sender: "سامي", isPrivate: false },
  ];

  it("marks a private note as one, and names everyone else", () => {
    const text = managerThreadText("أبو فهد", lines, new Set(), () => "14:05", esc);
    expect(text).toContain("📝 <b>ملاحظة داخلية — رشا</b> · 14:05\nالعميل حساس للسعر");
    expect(text).toContain("👤 <b>العميل — أبو فهد</b>");
    expect(text).toContain("🟢 <b>سامي</b>");
  });

  it("the nudge carries the client's name and the wait only — never a line of the conversation", () => {
    for (const content of [nudgeContent("أبو فهد", 125, waitText), teamNudgeContent("أبو فهد", 125, waitText)]) {
      expect(content).toContain("أبو فهد");
      expect(content).toContain("2 س 5 د");
      for (const l of lines) expect(content).not.toContain(l.text);
    }
  });
});

describe("one nudge per colleague and conversation every fifteen minutes", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  it("refuses inside the window, in words, and allows after it", () => {
    expect(nudgedRecently(null, now)).toBeNull();
    expect(nudgedRecently(now - 5 * 60_000, now)).toBe(5);
    expect(nudgedRecently(now - 20_000, now)).toBe(0);
    expect(nudgedRecently(now - 15 * 60_000, now)).toBeNull();
    expect(nudgedText(5)).toBe("نُبِّه قبل 5 دقيقة — يمكن التنبيه مرة كل 15 دقيقة.");
    expect(nudgedText(0)).toContain("نُبِّه قبل أقل من دقيقة");
  });
});
