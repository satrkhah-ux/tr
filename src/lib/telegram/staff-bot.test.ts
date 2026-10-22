import { describe, expect, it } from "vitest";
import { riyadhDayStart, secondsText, waitText } from "./staff-numbers";
import { assignmentText } from "./staff-events";
import { ruleTips, teamAverages, type Facts } from "./staff-report";

describe("«تنبيهاتي» numbers", () => {
  it("starts the day at 00:00 Riyadh (21:00 UTC the day before)", () => {
    // 2026-10-22 01:30 Riyadh = 2026-10-21 22:30 UTC → the day began 2026-10-21 21:00 UTC
    expect(riyadhDayStart(Date.parse("2026-10-21T22:30:00Z"))).toBe(Date.parse("2026-10-21T21:00:00Z") / 1000);
    // 2026-10-22 20:59 UTC is still 23:59 of the 22nd in Riyadh
    expect(riyadhDayStart(Date.parse("2026-10-22T20:59:00Z"))).toBe(Date.parse("2026-10-21T21:00:00Z") / 1000);
  });

  it("says waits in minutes, hours and days", () => {
    expect(waitText(7)).toBe("7 د");
    expect(waitText(60)).toBe("1 س");
    expect(waitText(125)).toBe("2 س 5 د");
    expect(waitText(3000)).toBe("2 ي");
    expect(secondsText(null)).toBe("—");
    expect(secondsText(20)).toBe("1 د");
  });
});

describe("«تنبيهاتي» assignment card", () => {
  it("escapes what the client typed and drops empty lines", () => {
    const text = assignmentText({ id: 5, name: "<b>x</b>", phone: "+966500000000", team: null, preview: "سعر <جورجيا>" });
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(text).toContain("«سعر &lt;جورجيا&gt;»");
    expect(text).not.toContain("🏷️");
  });
});

const day = (over: Partial<Facts["numbers"]> = {}, report: Partial<NonNullable<Facts["numbers"]["today"]["report"]>> = {}): Facts => ({
  numbers: {
    open: 10,
    waiting: 0,
    neverAnswered: 0,
    oldestWaitMin: null,
    total: 50,
    closed: 40,
    today: { assigned: 3, report: { id: 13, conversations: 6, resolved: 4, firstResponseSec: 120, replySec: 90, ...report } },
    ...over,
  },
  team: { firstResponseSec: 300, replySec: 200 },
  issued: 1,
  botReplies: 0,
});

describe("«تنبيهاتي» tips stand on the employee's numbers", () => {
  it("puts the unanswered and the waiting first, with their counts", () => {
    const tips = ruleTips(day({ neverAnswered: 2, waiting: 3, oldestWaitMin: 95 }));
    expect(tips[0]).toContain("2 محادثة لم يُرد عليها");
    expect(tips[1]).toContain("3 عميل ينتظر ردك، أقدمهم منذ 1 س 35 د");
  });

  it("compares speed with the team only when clearly slower", () => {
    expect(ruleTips(day({}, { firstResponseSec: 900 })).join(" ")).toContain("15 د مقابل 5 د للفريق");
    expect(ruleTips(day({}, { firstResponseSec: 330 })).join(" ")).not.toContain("للفريق");
  });

  it("praises a clean day instead of inventing a problem, and never says more than three", () => {
    expect(ruleTips(day())).toHaveLength(1);
    expect(ruleTips(day())[0]).toContain("ممتاز");
    expect(ruleTips(day({ neverAnswered: 1, waiting: 1, open: 40 }, { firstResponseSec: 900, replySec: 900, resolved: 0 }))).toHaveLength(3);
  });

  it("averages the team over agents who worked today only", () => {
    const team = teamAverages(
      new Map([
        [1, { id: 1, conversations: 4, resolved: 1, firstResponseSec: 100, replySec: null }],
        [2, { id: 2, conversations: 2, resolved: 0, firstResponseSec: 300, replySec: 60 }],
        [3, { id: 3, conversations: 0, resolved: 0, firstResponseSec: null, replySec: null }],
      ]),
    );
    expect(team).toEqual({ firstResponseSec: 200, replySec: 60 });
  });
});
