import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCityDates, emptyDraftData, type DraftData, type GeneratorLookups } from "@/lib/offer/draft-types";
import { daysFromTours, draftDaySkeleton } from "@/lib/offer/itinerary";

let pricing = true;
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: () => pricing }) }));
vi.mock("@/lib/data/itinerary-actions", () => ({
  getAssistantAvailability: async () => ({ ai: false, flightLookup: false }),
  generateItineraryDays: async () => ({ ok: false, error: "err.session" }),
  refreshItineraryWeather: async () => ({ ok: false, error: "err.session" }),
}));
vi.mock("@/lib/data/tour-programs", () => ({ getTourPrograms: async () => [], getTourPrices: async () => [] }));

const { ItineraryStage } = await import("./ItineraryStage");

/** KL two nights (20–21) with «جولة المدينة» on the 21st in two vans at 400 a van, then Langkawi two. */
function file(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 4, days: 5, adults: 9 };
  data.cities = deriveCityDates("2026-10-20", [
    { city_name: "كوالالمبور", nights: 2, check_in: null, check_out: null },
    { city_name: "لنكاوي", nights: 2, check_in: null, check_out: null },
  ]);
  data.cities[0] = { ...data.cities[0], tours: 1, tour_picks: [{ program_id: null, title: "جولة المدينة", text: "برجا بتروناس", price: 400, date: "2026-10-21", cars: 2 }] };
  data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
  data.days = draftDaySkeleton(data);
  data.days = daysFromTours(data);
  // the arrival day written, so the stage opens on the tour day
  data.days[0] = { ...data.days[0], title: "الوصول إلى كوالالمبور" };
  data.days[1] = { ...data.days[1], title: "" };
  return data;
}
const render = () =>
  renderToStaticMarkup(
    <ItineraryStage
      draftId="d1"
      data={file()}
      patch={() => {}}
      replace={() => {}}
      flush={async () => {}}
      lookups={{ carTypes: [{ name: "فان", pax: 7 }], sarPer: { SAR: 1 } } as unknown as GeneratorLookups}
    />,
  );

describe("«البرنامج اليومي والجولات» (الأمر 4)", () => {
  it("heads each city with its days, dates, tours and cars, and opens the day on its tour", () => {
    pricing = true;
    const html = render();
    expect(html).toContain("البرنامج اليومي والجولات");
    expect(html).toContain("كوالالمبور — يومان (20–21 أكتوبر) · جولة واحدة · فان × 2");
    expect(html).toContain("لنكاوي — 3 أيام (22–24 أكتوبر)");
    // the open day holds the pick the basic screen wrote: its service, car and count — and 2 × 400
    expect(html).toContain('value="جولة المدينة"');
    expect(html).toMatch(/<option value="فان" selected="">/);
    expect(html).toMatch(/<option value="2" selected="">2<\/option>/);
    expect(html).toContain("800 SAR");
  });

  it("shows no price without pricing.view", () => {
    pricing = false;
    const html = render();
    expect(html).toContain('value="جولة المدينة"');
    expect(html).not.toContain("SAR");
    expect(html).not.toContain('value="400"');
  });
});
