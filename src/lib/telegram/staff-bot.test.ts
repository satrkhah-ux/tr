import { describe, expect, it } from "vitest";
import { riyadhDayStart, secondsText, speedText, waitText } from "./staff-numbers";
import { assignmentText } from "./staff-events";
import { ruleTips, teamAverages, type Facts } from "./staff-report";
import { dashboardText, light } from "./staff-screen";
import { threadText, whenText } from "./staff-replies";
import { broadcastText } from "./staff-manager";
import { closedEnough, comparisonLines, delta, letterTips, share, toWithdraw } from "./staff-letter";
import { bar, matchSellers, planMonth, sellerTargets } from "./staff-target";

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

  it("measures speed against the administration's targets, not against a slow team", () => {
    expect(ruleTips(day({}, { firstResponseSec: 900 })).join(" ")).toContain("أول رد عندك اليوم 15 د والهدف 5 د");
    expect(ruleTips(day({}, { firstResponseSec: 240 })).join(" ")).not.toContain("أول رد عندك");
    // the screenshot of 2026-10-22: a 35-minute reply beside a team mean of 1 h 28 — still slower than the 15-minute target
    const slowTeam = { ...day({}, { replySec: 2100 }), team: { firstResponseSec: 300, replySec: 5280 } };
    expect(ruleTips(slowTeam).join(" ")).toContain("ردّك أثناء المحادثة 35 د والهدف 15 د");
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

describe("«🖥️ شاشتي»", () => {
  it("lights red for a client never answered or a 30-minute wait, yellow for a short wait, green otherwise", () => {
    expect(light({ waiting: 0, neverAnswered: 1, oldestWaitMin: null }).icon).toBe("🔴");
    expect(light({ waiting: 2, neverAnswered: 0, oldestWaitMin: 45 }).icon).toBe("🔴");
    expect(light({ waiting: 1, neverAnswered: 0, oldestWaitMin: 10 }).icon).toBe("🟡");
    expect(light({ waiting: 0, neverAnswered: 0, oldestWaitMin: null }).icon).toBe("🟢");
  });

  it("says each number in plain words, judged against the target, and when it was refreshed", () => {
    const f = day({ open: 18, waiting: 3, oldestWaitMin: 12 });
    const text = dashboardText("رهف", f.numbers, f.team, { issued: 2, botReplies: 0 }, Date.parse("2026-10-22T11:05:00Z"));
    expect(text).toContain("محادثات مفتوحة لك: <b>18</b>");
    expect(text).toContain("أقدمهم منذ 12 د");
    expect(text).toContain("محادثات أُسندت إليك: <b>3</b>");
    expect(text).toContain("أول رد للعميل: <b>2 د</b> — 🟢 ضمن الهدف (5 د)");
    expect(text).toContain("ملفات أصدرتها في النظام: <b>2</b>");
    expect(text).toContain("02:05");
    expect(text).not.toContain("ردود أرسلتها من البوت");
  });

  it("marks a speed green, yellow or red by the two SLA limits", () => {
    expect(speedText(2100, [15, 120])).toBe("<b>35 د</b> — 🟡 أبطأ من الهدف (15 د)");
    expect(speedText(600, [15, 120])).toContain("🟢 ضمن الهدف");
    expect(speedText(9000, [15, 120])).toContain("🔴 متأخر كثيراً");
    expect(speedText(null, [15, 120])).toBe("— لا يوجد بعد");
  });
});

describe("a conversation in the bot says who wrote each message", () => {
  it("names the client, the colleague and Murad, each message with its time, one block each", () => {
    const now = Date.parse("2026-10-22T15:00:00Z");
    const text = threadText(
      "أبو جود",
      [
        { id: 1, at: Date.parse("2026-10-22T14:05:00Z") / 1000, text: "السلام عليكم", fromClient: true, sender: "أبو جود" },
        { id: 2, at: Date.parse("2026-10-22T14:05:30Z") / 1000, text: "وعليكم السلام", fromClient: false, sender: "احمد الرفاعي" },
        { id: 3, at: Date.parse("2026-10-22T14:07:00Z") / 1000, text: "أبشر <بالسعادة>", fromClient: false, sender: "رهف السيد" },
      ],
      new Set([2]),
      now,
    );
    const blocks = text.split("\n┈┈┈┈┈┈┈┈\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe("👤 <b>العميل — أبو جود</b> · 05:05 م\nالسلام عليكم");
    expect(blocks[1]).toContain("🤖 <b>مُراد (رد آلي)</b>");
    expect(blocks[2]).toContain("🟢 <b>رهف السيد</b> · 05:07 م\nأبشر &lt;بالسعادة&gt;");
    expect(whenText(Date.parse("2026-10-21T14:05:00Z") / 1000, now)).toContain("/");
  });
});

describe("«الخطاب الرسمي» tips", () => {
  it("stand on the employee's own numbers, never more than three", () => {
    const busy = letterTips({ total: 78, confirmed: 0, open: 78, closed: 0 });
    expect(busy).toHaveLength(3);
    expect(busy[0]).toContain("محادثاتك المفتوحة 78 (100% من محادثاتك)");
    expect(busy[2]).toContain("لا يوجد لك حجز مؤكد");
    expect(letterTips({ total: 252, confirmed: 4, open: 148, closed: 104 })[1]).toContain("العملاء الذين أكّدوا معك: 4 (2% من محادثاتك)");
  });

  it("praises a tidy list with confirmations, and says plainly when there is nothing yet", () => {
    expect(letterTips({ total: 40, confirmed: 3, open: 5, closed: 35 })[0]).toContain("منظّمة");
    expect(letterTips({ total: 0, confirmed: 0, open: 0, closed: 0 })).toEqual(["لا توجد محادثات مسندة لك بعد في تيلي تيل."]);
    expect(share(1, 0)).toBe("—");
  });
});

describe("«الخطاب الرسمي» رقم 2", () => {
  const first = { total: 252, confirmed: 4, open: 148, closed: 104 };

  it("warns only who still holds 20 or more open, down by less than a quarter", () => {
    expect(closedEnough(first, { ...first, open: 140, closed: 112 })).toBe(false);
    expect(closedEnough(first, { ...first, open: 100, closed: 160 })).toBe(true);
    expect(closedEnough({ ...first, open: 10 }, { ...first, open: 19 })).toBe(true);
    expect(closedEnough({ ...first, open: 0 }, { ...first, open: 30 })).toBe(false);
  });

  it("says what changed between the two letters", () => {
    const lines = comparisonLines(first, { total: 270, confirmed: 6, open: 90, closed: 180 });
    expect(lines[0]).toBe("أغلقت 76 محادثة خلال هذه المدة.");
    expect(lines[1]).toBe("انخفضت محادثاتك المفتوحة من 148 إلى 90.");
    expect(lines[2]).toContain("6 (كانوا 4");
    expect(comparisonLines(first, first)[0]).toBe("لم تُغلق أي محادثة خلال هذه المدة.");
    expect([delta(148, 90), delta(4, 6), delta(5, 5)]).toEqual(["−58", "+2", "0"]);
  });
});

describe("withdrawal after a warned letter 2", () => {
  it("takes only the agent's open conversations silent for 3 days where no client waits", () => {
    const now = Date.parse("2026-11-02T09:00:00Z") / 1000;
    const day = 86_400;
    const rows = [
      { id: 1, assigneeId: 71, waitingSince: 0, lastActivityAt: now - 4 * day }, // we spoke last, 4 days → taken
      { id: 2, assigneeId: 71, waitingSince: now - 5 * day, lastActivityAt: now - 5 * day }, // the client waits → never
      { id: 3, assigneeId: 71, waitingSince: 0, lastActivityAt: now - 2 * day }, // 2 days → kept
      { id: 4, assigneeId: 15, waitingSince: 0, lastActivityAt: now - 9 * day }, // someone else's
      { id: 5, assigneeId: 71, waitingSince: 0, lastActivityAt: now - 3 * day }, // exactly 3 days → taken
    ];
    expect(toWithdraw(rows, 71, now)).toEqual([1, 5]);
  });
});

describe("«🎯 هدفي» reads the plan's sellers line", () => {
  // neutral names and figures: the real plan never enters the repository
  const focus = "سطر أول\nأهداف البائعين (صافي ربح): سامي نادر 12,000 · فارس 9,500 · القحطاني 7,000 · الخدمات 4,000 = 32,500، والباقي 3,000 = 35,500\nسطر أخير";
  const people = [
    { id: "a", name: "سامي نادر" },
    { id: "b", name: "فارس العتيبي" },
    { id: "c", name: "خالد علي القحطاني" },
    { id: "d", name: "سامي الحربي" },
  ];

  it("takes each name with its amount and drops the totals", () => {
    expect(sellerTargets(focus)).toEqual([
      { name: "سامي نادر", profit: 12000 },
      { name: "فارس", profit: 9500 },
      { name: "القحطاني", profit: 7000 },
      { name: "الخدمات", profit: 4000 },
    ]);
    expect(sellerTargets("لا سطر للبائعين")).toEqual([]);
  });

  it("gives a line to the one employee holding all its words, hamza or not, and never guesses", () => {
    const { matched, unmatched } = matchSellers(sellerTargets(focus.replace("فارس", "فارِس")), people);
    expect(matched.map((m) => [m.id, m.profit])).toEqual([
      ["a", 12000],
      ["b", 9500],
      ["c", 7000],
    ]);
    expect(unmatched).toEqual(["الخدمات"]);
    expect(matchSellers([{ name: "أحمد", profit: 1 }], [{ id: "x", name: "احمد سالم" }]).matched[0].id).toBe("x");
    expect(matchSellers([{ name: "سامي", profit: 1 }], people).unmatched).toEqual(["سامي"]);
  });

  it("shows this month's plan, else the next one, and a bar that stays full past the target", () => {
    const t = (month: string) => ({ id: month, month, sales: 0, profit: 0, debtBudget: 0, focus: "", payments: "" });
    const oct24 = Date.parse("2026-10-24T09:00:00Z");
    expect(planMonth([t("2026-12"), t("2026-11")], oct24)?.month).toBe("2026-11");
    expect(planMonth([t("2026-10"), t("2026-11")], oct24)?.month).toBe("2026-10");
    // 31 Oct 22:00 UTC is already 1 November in Riyadh
    expect(planMonth([t("2026-10"), t("2026-11")], Date.parse("2026-10-31T22:00:00Z"))?.month).toBe("2026-11");
    expect(planMonth([t("2026-09")], oct24)).toBeNull();
    expect(bar(3800, 10000)).toBe("▓▓▓░░░░░░░ 38%");
    expect(bar(15000, 10000)).toBe("▓▓▓▓▓▓▓▓▓▓ 150%");
    expect(bar(0, 0)).toBe("░░░░░░░░░░ 0%");
  });
});

describe("«📢 إعلان عام»", () => {
  it("an alert to one colleague is titled as an alert", () => {
    expect(broadcastText("ردّ على العميل", "احمد", true)).toContain("🔔 <b>تنبيه من الإدارة</b>");
  });

  it("escapes the manager's text and signs it", () => {
    expect(broadcastText("اجتماع <الساعة 5>", "أدمن")).toBe("📢 <b>إعلان من الإدارة</b>\n\nاجتماع &lt;الساعة 5&gt;\n\n— أدمن");
  });
});
