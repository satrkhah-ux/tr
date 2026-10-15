import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DriverDay } from "@/lib/data/public-links";

// the page reads its day through the token (service role) — here, the day is given
vi.mock("@/lib/data/public-links", () => ({ getDriverDay: vi.fn() }));
vi.mock("@/components/traveliun/operations/DriverStepButtons", () => ({ DriverStepButtons: () => null }));

import { getDriverDay } from "@/lib/data/public-links";
import DriverDayPage from "@/app/driver-day/[token]/page";

/**
 * «رابط السائق» on a tour day (generator v4 order 5): the driver sees the
 * day's tour — what it is, where it goes — and the car it goes in with how
 * many of them, as the sale wrote it on the booking («فان × 2»).
 */
describe("the driver's day — a tour", () => {
  it("shows the tour, its programme, and its car × count", async () => {
    const day: DriverDay = {
      date: "2026-10-21",
      driver: "أحمد",
      contact: "0569222111",
      pickups: [
        {
          id: "b1",
          kind: "tour",
          serial: "AD-6-3056-20261012",
          lead: "عبدالله",
          title: "جولة: جولة المدينة",
          time: "09:00",
          flight: "",
          meet: "",
          landing: "",
          hotel: { name: "فندق الشروق", name_en: null, map: "https://www.google.com/maps" },
          pax: "9",
          car: "فان × 2",
          plate: "",
          program: "برجا بتروناس وساحة الاستقلال",
          step: null,
        },
      ],
    };
    vi.mocked(getDriverDay).mockResolvedValue(day);

    const html = renderToStaticMarkup(await DriverDayPage({ params: Promise.resolve({ token: "t".repeat(32) }) }));
    const at = ["جولة / Tour", "جولة: جولة المدينة", "برجا بتروناس وساحة الاستقلال", "فان × 2"].map((s) => html.indexOf(s));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("09:00");
  });
});
