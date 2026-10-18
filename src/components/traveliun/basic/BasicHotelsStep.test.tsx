import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCityDates, emptyDraftData, type DraftData, type GeneratorLookups } from "@/lib/offer/draft-types";
import { withHotelLines, type BasicCity } from "@/lib/offer/basic";

vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: () => true }) }));
const { BasicHotelsStep } = await import("./BasicHotelsStep");

/** Istanbul 3 nights then Trabzon 3, two people in one room. */
function file(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "تركيا", destination: "تركيا", arrival_date: "2026-11-01", nights: 6, days: 7, adults: 2, rooms: 1 };
  data.cities = deriveCityDates("2026-11-01", [
    { city_name: "اسطنبول", nights: 3, check_in: null, check_out: null },
    { city_name: "طرابزون", nights: 3, check_in: null, check_out: null },
  ]);
  data.hotels = withHotelLines(data, "SAR");
  return data;
}

const lookups = { countries: [], carTypes: [], sarPer: { SAR: 1 }, airports: [], airlines: [] } as unknown as GeneratorLookups;
const render = (data: DraftData) =>
  renderToStaticMarkup(<BasicHotelsStep cities={data.cities as BasicCity[]} firstDay={1} data={data} lookups={lookups} onLines={() => {}} onSlice={() => {}} />);

describe("«١. الفنادق» (2026-10-18)", () => {
  it("lists every city's stay on its chained dates, open while a hotel is missing", () => {
    const html = render(file());
    expect(html).toContain("١. الفنادق — كل المدن");
    expect(html).toContain("اسطنبول");
    expect(html).toContain("طرابزون");
    expect(html).toContain("2026-11-01");
    expect(html).toContain("2026-11-04");
    expect(html).toContain("غرفة مزدوجة");
  });

  it("folds to one line a stay once every hotel is complete", () => {
    const data = file();
    data.hotels = data.hotels.map((h, i) => ({ ...h, hotel_name: i === 0 ? "فندق البسفور" : "فندق طرابزون", rooms: h.rooms.map((r) => ({ ...r, board_type: "BB", price: 900 })) }));
    const html = render(data);
    expect(html).toContain("الفنادق مكتملة");
    expect(html).toContain("فندق البسفور");
    expect(html).toContain("900 SAR");
  });
});
