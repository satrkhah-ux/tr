import { describe, expect, it } from "vitest";
import { riyadhDayStart, secondsText, waitText } from "./staff-numbers";
import { assignmentText } from "./staff-events";

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
