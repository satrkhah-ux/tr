import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCityDates, emptyDraftData, type DraftData, type GeneratorLookups } from "@/lib/offer/draft-types";
import { basicDays, type BasicCity } from "@/lib/offer/basic";
import { ownerExample } from "@/lib/offer/draft-test-helpers";

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

const render = (data = file(), index = 0, transportOn = false) => {
  return renderToStaticMarkup(
    <BasicCityCard
      index={index}
      city={data.cities[index] as BasicCity}
      dayFrom={1}
      data={data}
      lookups={{ carTypes: [{ name: "فان", pax: 7 }], sarPer: { SAR: 1 }, airports: [], airlines: [] } as unknown as GeneratorLookups}
      programs={[]}
      tourPrices={[]}
      hotelsOn={transportOn}
      toursOn
      transportOn={transportOn}
      isFirst={index === 0}
      isLast={index === data.cities.length - 1}
      onNights={() => {}}
      onPicks={() => {}}
      onLines={() => {}}
      onSlice={() => {}}
      onCar={() => {}}
      onRemove={() => {}}
      onMove={() => {}}
      dragFrom={null}
      onDragFrom={() => {}}
      onReplace={() => {}}
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

describe("Basic's services table — the owner's example", () => {
  // the stays complete, so the card opens on the services
  const example = () => {
    const data = ownerExample();
    return { ...data, hotels: data.hotels.map((h) => ({ ...h, rooms: h.rooms.map((r) => ({ ...r, room_type_name: "غرفة مزدوجة", board_type: "BB" as const, price: 1000 })) })) };
  };
  // rows written as the row's words (the input's value), once each
  const count = (html: string, text: string) => html.split(`value="${text}"`).length - 1;

  it("Selangor: one reception from KUL, the tour that day, a free day, one farewell to KUL — and its hotel under the header", () => {
    pricing = true;
    const html = render(example(), 0, true);
    expect(count(html, "الاستقبال من مطار كوالالمبور الدولي والتوصيل إلى فندق صن واي بيراميد في سيلانجور")).toBe(1);
    expect(count(html, "التوصيل من فندق سيلانجور إلى مطار كوالالمبور الدولي")).toBe(1);
    expect(html).toContain('value="جولة في مدينة الأضواء"');
    expect(html).toContain("يوم حر");
    expect(html).toContain("الفندق: صن واي بيراميد");
    expect(html).toContain("الثلاثاء، 20 أكتوبر");
    // the columns, the type of each row, and a row to add
    expect(html).toContain("نوع الخدمة");
    expect(html).toMatch(/<option value="reception" selected="">استقبال<\/option>/);
    expect(html).toMatch(/<option value="farewell" selected="">توديع<\/option>/);
    expect(html).toMatch(/<option value="tour" selected="">جولة<\/option>/);
    expect(html).toContain("إضافة خدمة");
    // the old lines above the table are gone: the welcome text lives on the programme tab
    expect(html).not.toContain("نص الاستقبال");
  });

  it("Langkawi: met at its own airport, seen off from it", () => {
    pricing = true;
    const html = render(example(), 1, true);
    expect(count(html, "الاستقبال من مطار لنكاوي الدولي والتوصيل إلى الفندق")).toBe(1);
    expect(count(html, "التوصيل من فندق لنكاوي إلى مطار لنكاوي الدولي")).toBe(1);
    expect(html).toContain("الوصول 16:05");
  });
});
