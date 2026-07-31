import { describe, expect, it } from "vitest";
import { count, say, speechScript, textSummary } from "./script";
import type { EyeReport } from "./types";

/**
 * The daily briefing is built from the numbers, not written by a model — so the
 * thing worth testing is that the numbers survive the trip into Arabic, and that
 * the same report always produces the same sentence.
 */

function report(over: Partial<EyeReport> = {}): EyeReport {
  return {
    day: "2026-07-30",
    attendance: { expected: 3, present: 2, absent: ["ريم"], windows: [{ name: "محمد", from: "06:00", to: "14:30", minutes: 510 }] },
    response: { opened: 4, answered: 2, unanswered: 2, avgMinutes: 95, worstMinutes: 300, worstSubject: "تعديل موعد" },
    ops: { liveCases: 3, needsAction: 2, critical: 1, openBookings: 4, travelSoon: 1, urgent: [{ id: "o1", serial: "AD-1", customer: "ابتهال", worst: "السفر يقترب والحجوزات ناقصة" }] },
    sales: { issuedToday: 2, confirmedToday: 1, totalToday: 12000, currency: "SAR" },
    activity: [{ name: "محمد", count: 7 }],
    notes: [],
    ...over,
  };
}

describe("say", () => {
  it("spells numbers so a speech engine does not switch to English", () => {
    expect(say(0)).toBe("صفر");
    expect(say(7)).toBe("سبعة");
    expect(say(14)).toBe("أربعة عشر");
    expect(say(21)).toBe("واحد وعشرين");
    expect(say(40)).toBe("أربعين");
    expect(say(100)).toBe("مئة");
    expect(say(215)).toBe("مئتين وخمسة عشر");
  });

  it("gives up past 999 rather than inventing a reading", () => {
    expect(say(1200)).toBe("1200");
  });

  it("fuses the hundreds — nobody says «خمسة مئة»", () => {
    expect(say(500)).toBe("خمسمئة");
    expect(say(547)).toBe("خمسمئة وسبعة وأربعين");
    expect(say(300)).toBe("ثلاثمئة");
  });
});

describe("count", () => {
  it("uses the singular, the dual and the plural — Arabic counts the noun", () => {
    expect(count(0, "تذكرة", "تذكرتين", "تذاكر")).toBe("ما فيه تذاكر");
    expect(count(1, "تذكرة", "تذكرتين", "تذاكر")).toBe("تذكرة");
    expect(count(2, "تذكرة", "تذكرتين", "تذاكر")).toBe("تذكرتين");
    expect(count(5, "تذكرة", "تذكرتين", "تذاكر")).toBe("خمسة تذاكر");
    expect(count(15, "تذكرة", "تذكرتين", "تذاكر")).toBe("خمسة عشر تذكرة");
  });
});

describe("the spoken briefing", () => {
  it("is deterministic — the same report says the same words", () => {
    expect(speechScript(report())).toBe(speechScript(report()));
  });

  it("carries the numbers that matter", () => {
    const text = speechScript(report());
    expect(text).toContain("ريم"); // who did not open the system
    expect(text).toContain("طلبين"); // the two still waiting for a reply
    expect(text).toContain("ابتهال"); // the worst case, by name
    expect(text).toContain("السفر يقترب والحجوزات ناقصة");
  });

  it("softens the attendance claim to what it actually measures", () => {
    expect(speechScript(report())).toContain("يقيس فتح النظام");
  });

  it("says so plainly when there is nothing to report", () => {
    const quiet = report({
      attendance: { expected: 2, present: 2, absent: [], windows: [] },
      response: { opened: 0, answered: 0, unanswered: 0, avgMinutes: null, worstMinutes: null, worstSubject: null },
      ops: { liveCases: 0, needsAction: 0, critical: 0, openBookings: 0, travelSoon: 0, urgent: [] },
      sales: { issuedToday: 0, confirmedToday: 0, totalToday: null, currency: "SAR" },
      notes: [],
    });
    const text = speechScript(quiet);
    expect(text).toContain("كل شي ماشي زين");
    expect(text).toContain("ما صدر اليوم أي عرض جديد");
  });

  it("says a long delay in days — hours stop meaning anything past two", () => {
    const text = speechScript(report({ response: { opened: 1, answered: 0, unanswered: 1, avgMinutes: null, worstMinutes: 32848, worstSubject: "استفسار" } }));
    expect(text).toContain("يوم");
    expect(text).not.toContain("خمسمئة وسبعة وأربعين ساعة");
  });

  it("agrees with a single file instead of pluralising it", () => {
    const text = speechScript(report({ ops: { liveCases: 1, needsAction: 1, critical: 1, openBookings: 0, travelSoon: 0, urgent: [] } }));
    expect(text).toContain("ملف واحد شغال");
    expect(text).not.toContain("منها ملف يبي لها حركة");
  });

  it("does not claim replies that did not happen", () => {
    const text = speechScript(report({ response: { opened: 0, answered: 0, unanswered: 5, avgMinutes: null, worstMinutes: null, worstSubject: null } }));
    expect(text).toContain("ما وصلنا طلب جديد اليوم");
    expect(text).not.toContain("رددنا على صفر");
  });

  it("speaks the digits inside a note instead of handing them to the engine", () => {
    const text = speechScript(
      report({ notes: [{ code: "ticket_unanswered", severity: "critical", subject_kind: "ticket", subject_id: "t", title: "تذكرة بلا رد منذ 19 يوم", detail: "استفسار · بدر · أدمن" }] }),
    );
    expect(text).toContain("تسعة عشر يوم");
    expect(text).not.toContain("·");
  });

  it("leads the notes with the critical ones", () => {
    const text = speechScript(
      report({
        notes: [
          { code: "absent_today", severity: "info", subject_kind: "employee", subject_id: "e", title: "ملاحظة عادية" },
          { code: "ops_critical", severity: "critical", subject_kind: "operation", subject_id: "o", title: "ملف حرج" },
        ],
      }),
    );
    expect(text.indexOf("ملف حرج")).toBeLessThan(text.indexOf("تلقاها مكتوبة") + text.length);
    expect(text).toContain("ملف حرج");
  });
});

describe("the written summary", () => {
  it("keeps digits and marks severity", () => {
    const text = textSummary(
      report({
        notes: [{ code: "ticket_unanswered", severity: "critical", subject_kind: "ticket", subject_id: "t", title: "تذكرة بلا رد منذ 26 ساعة" }],
      }),
    );
    expect(text).toContain("2 من 3");
    expect(text).toContain("🔴");
    expect(text).toContain("2026-07-30");
  });
});
