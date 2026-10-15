import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCityDates, emptyDraftData, type DraftData, type GeneratorLookups } from "@/lib/offer/draft-types";
import { basicDays, type BasicCity } from "@/lib/offer/basic";

let pricing = true;
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: (p: string) => p === "pricing.view" && pricing }) }));

const { BasicCityCard } = await import("./BasicCityCard");

/** One city: KL two nights (20–21 Oct), home on the 22nd — «جولة المدينة» on the 21st in two vans at 400 a van. */
function file(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 2, days: 3, adults: 9 };
  data.cities = deriveCityDates("2026-10-20", [{ city_name: "كوالالمبور", nights: 2, check_in: null, check_out: null }]);
  data.cities[0] = { ...data.cities[0], tours: 1, tour_picks: [{ program_id: null, title: "جولة المدينة", text: "", price: 400, date: "2026-10-21", cars: 2 }] };
  data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
  data.days = basicDays(data);
  return data;
}

const render = () => {
  const data = file();
  return renderToStaticMarkup(
    <BasicCityCard
      index={0}
      city={data.cities[0] as BasicCity}
      dayFrom={1}
      data={data}
      lookups={{ carTypes: [{ name: "فان", pax: 7 }], sarPer: { SAR: 1 }, airports: [], airlines: [] } as unknown as GeneratorLookups}
      programs={[]}
      tourPrices={[]}
      hotelsOn={false}
      toursOn
      transportOn={false}
      isFirst
      isLast
      onNights={() => {}}
      onPicks={() => {}}
      onLines={() => {}}
      onSlice={() => {}}
      onCar={() => {}}
      onRemove={() => {}}
      collapsed={false}
      onDone={() => {}}
      onExpand={() => {}}
    />,
  );
};

describe("Basic's tours tab", () => {
  it("shows the price per car and the total with pricing.view", () => {
    pricing = true;
    const html = render();
    expect(html).toContain('value="400"');
    expect(html).toContain("800 SAR");
    expect(html).toContain("الإجمالي: 800");
  });

  it("hides them without pricing.view — the tour, its car and how many stay", () => {
    pricing = false;
    const html = render();
    expect(html).toContain('value="جولة المدينة"');
    expect(html).toMatch(/<option value="2" selected="">2<\/option>/);
    expect(html).not.toContain("SAR");
    expect(html).not.toContain('value="400"');
    expect(html).not.toContain("الإجمالي");
    expect(html).toContain("عدد الجولات: 1");
  });

  it("offers a tour on the arrival day and, on the last city, on the day home", () => {
    pricing = true;
    const html = render();
    expect(html).toContain("جولة بعد الوصول");
    expect(html).toContain("جولة قبل المغادرة");
  });
});
