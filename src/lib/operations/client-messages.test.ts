import { describe, expect, it } from "vitest";
import { fillTemplate, messagesDueToday, tidyWhatsapp, WA_TEMPLATES, waParams, waPreview } from "./client-messages";

const fields = { name: "أحمد", destination: "ماليزيا", serial: "AD-6-3056", link: "https://pkg.traveliun.com/trip/x", rate_link: "https://pkg.traveliun.com/trip/x/rate" };

describe("the client's stage messages", () => {
  it("fills a manager's template with the case's words, and leaves unknown braces alone", () => {
    const out = fillTemplate("مرحباً {name}، رحلتكم إلى {destination} ({serial}) {other}", fields);
    expect(out).toBe("مرحباً أحمد، رحلتكم إلى ماليزيا (AD-6-3056) {other}");
  });

  it("puts a link alone on its line, after a blank one, and drops the sentence's full stop", () => {
    expect(tidyWhatsapp("تابع رحلتك من هنا: https://pkg.traveliun.com/trip/x.\nفريق ترافليون")).toBe(
      // the author's own line break after it stays, so the signature stands apart
      "تابع رحلتك من هنا:\n\nhttps://pkg.traveliun.com/trip/x\n\nفريق ترافليون",
    );
    expect(fillTemplate("مستنداتكم جاهزة. {link}   شكراً", fields)).toBe("مستنداتكم جاهزة.\n\nhttps://pkg.traveliun.com/trip/x\nشكراً");
  });

  it("keeps the author's own blank lines, but never three in a row", () => {
    expect(tidyWhatsapp("أ\n\n\n\nب")).toBe("أ\n\nب");
  });
});

describe("the dated messages of a trip", () => {
  // 10 → 18 Nov: eight nights
  const due = (today: string) => messagesDueToday("2026-11-10", "2026-11-18", today);

  it("goes three days before, the day before and on the travel day", () => {
    expect(due("2026-11-07")).toEqual(["three_days_before"]);
    expect(due("2026-11-09")).toEqual(["day_before"]);
    expect(due("2026-11-10")).toEqual(["departure_day"]);
    expect(due("2026-11-08")).toEqual([]);
  });

  it("welcomes the morning after the flight, and checks in mid-trip", () => {
    expect(due("2026-11-11")).toEqual(["welcome"]);
    expect(due("2026-11-14")).toEqual(["midway"]);
    expect(due("2026-11-19")).toEqual([]);
  });

  it("does not check in on a short trip", () => {
    expect(messagesDueToday("2026-11-10", "2026-11-13", "2026-11-11")).toEqual(["welcome"]);
    expect(messagesDueToday("2026-11-10", "2026-11-13", "2026-11-12")).toEqual([]);
  });
});

describe("the WhatsApp templates", () => {
  it("never starts or ends a template with a variable (Meta refuses those)", () => {
    for (const def of Object.values(WA_TEMPLATES)) {
      expect(def.body.trim().startsWith("{{")).toBe(false);
      expect(def.body.trim().endsWith("}}")).toBe(false);
      expect(def.name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("fills name, destination and the right link", () => {
    expect(waParams("rate_trip", fields)).toEqual(["أحمد", "ماليزيا", fields.rate_link]);
    expect(waPreview(WA_TEMPLATES.day_before, waParams("day_before", fields))).toContain("رحلتك إلى *ماليزيا* غداً");
  });
});
