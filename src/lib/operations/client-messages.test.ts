import { describe, expect, it } from "vitest";
import { fillTemplate } from "./client-messages";

describe("the client's stage messages", () => {
  it("fills a manager's template with the case's words, and leaves unknown braces alone", () => {
    const out = fillTemplate("مرحباً {name}، رحلتكم إلى {destination} ({serial}): {link} {other}", {
      name: "أحمد",
      destination: "ماليزيا",
      serial: "AD-6-3056",
      link: "https://pkg.traveliun.com/trip/x",
      rate_link: "",
    });
    expect(out).toBe("مرحباً أحمد، رحلتكم إلى ماليزيا (AD-6-3056): https://pkg.traveliun.com/trip/x {other}");
  });
});
