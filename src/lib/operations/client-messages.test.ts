import { describe, expect, it } from "vitest";
import { arabicDay, defaultMessageBody, fillTemplate, messagesDueToday, programmeMessage, tidyWhatsapp, WA_TEMPLATES, waParams, waPreview } from "./client-messages";

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

  it("sends the one reminder two days before — and still to a file made later, up to the travel day", () => {
    expect(due("2026-11-08")).toEqual(["trip_reminder"]);
    expect(due("2026-11-09")).toContain("trip_reminder");
    expect(due("2026-11-10")).toContain("trip_reminder");
    expect(due("2026-11-07")).not.toContain("trip_reminder");
  });

  it("keeps the finer ones on their days, for a manager who switches them back on", () => {
    expect(due("2026-11-07")).toEqual(["three_days_before"]);
    expect(due("2026-11-09")).toEqual(["trip_reminder", "day_before"]);
    expect(due("2026-11-10")).toEqual(["trip_reminder", "departure_day"]);
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
      // every {{n}} has its value, in order
      const used = [...def.body.matchAll(/\{\{(\d)\}\}/g)].map((m) => Number(m[1]));
      expect(Math.max(...used)).toBe(def.params.length);
    }
  });

  it("is laid out the way the owner asked: greeting, sentences and link apart, signature last", () => {
    expect(waPreview(WA_TEMPLATES.bookings_confirmed, waParams("bookings_confirmed", fields))).toBe(
      [
        "عميلنا أحمد،",
        "تم تأكيد حجوزات رحلتك إلى ماليزيا",
        "(رقم الملف AD-6-3056)",
        "تابع تفاصيل رحلتك من هنا:",
        "https://pkg.traveliun.com/trip/x",
        "فريق ترافليون للسفر والسياحة",
      ].join("\n\n"),
    );
  });

  it("puts the travel day in the combined reminder", () => {
    const text = waPreview(WA_TEMPLATES.trip_reminder, waParams("trip_reminder", { ...fields, date: arabicDay("2026-11-10") }));
    expect(text).toContain("نذكّرك بموعد رحلتك إلى ماليزيا يوم الثلاثاء، 10 نوفمبر");
    expect(text).toContain("(رقم الملف AD-6-3056)");
    expect(fillTemplate(defaultMessageBody("trip_reminder"), { ...fields, date: arabicDay("2026-11-10") })).toBe(text);
  });

  it("points the rating at the rating link, and gives the editable text the same words", () => {
    expect(waParams("rate_trip", fields)).toEqual(["أحمد", "ماليزيا", fields.rate_link]);
    expect(fillTemplate(defaultMessageBody("bookings_confirmed"), fields)).toBe(
      waPreview(WA_TEMPLATES.bookings_confirmed, waParams("bookings_confirmed", fields)),
    );
    expect(defaultMessageBody("rate_trip")).toContain("{rate_link}");
  });
});

describe("the issued programme's WhatsApp text", () => {
  it("is short, carries no link, and says the bookings' link comes after the client confirms", () => {
    const text = programmeMessage({ hello: "عميلنا Ahmed Alrifaie،", destination: "جورجيا", duration: "7 أيام / 6 ليالي", serial: "AD-9-7801-20261022", updated: false });
    expect(text).toBe(
      [
        "عميلنا Ahmed Alrifaie،",
        "برنامج رحلتك إلى جورجيا (7 أيام / 6 ليالي) جاهز، وتجده في الملف المرفق.",
        "رقم الملف: AD-9-7801-20261022",
        "راجعه وأخبرنا بأي تعديل، وبعد تأكيدك نرسل لك رابط متابعة حجوزاتك.",
        "فريق ترافليون للسفر والسياحة",
      ].join("\n\n"),
    );
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("promises no link to a client who already confirmed — his went then", () => {
    const text = programmeMessage({ hello: "عميلنا العزيز،", destination: "تركيا", duration: null, serial: "AD-1", updated: true, confirmed: true });
    expect(text).toContain("راجعه وأخبرنا بأي تعديل.");
    expect(text).not.toContain("بعد تأكيدك");
  });

  it("says «حدّثنا» for a newer version, and stays whole without a destination", () => {
    expect(programmeMessage({ hello: "عميلنا العزيز،", destination: "تركيا", duration: null, serial: "AD-1", updated: true })).toContain("حدّثنا برنامج رحلتك إلى تركيا، والنسخة المحدَّثة في الملف المرفق.");
    expect(programmeMessage({ hello: "عميلنا العزيز،", destination: null, duration: null, serial: "AD-1", updated: false })).toContain("برنامج رحلتك جاهز، وتجده في الملف المرفق.");
  });
});
