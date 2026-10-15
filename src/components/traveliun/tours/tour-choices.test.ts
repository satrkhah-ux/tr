import { describe, expect, it } from "vitest";
import { tourChoices, type TourCatalog } from "./TourRow";

const catalog = (showPrice: boolean): TourCatalog => ({
  city: "كوالالمبور",
  programs: [
    { id: "p1", city_name: "كوالالمبور", title: "جولة المدينة", description: "", is_free_day: false, sort_order: 1 },
    { id: "p2", city_name: "كوالالمبور", title: "يوم حر في المول", description: "", is_free_day: true, sort_order: 2 },
  ],
  prices: [
    { name: "جولة المدينة", price: 300, currency: "SAR", car_type: "سيدان", program_id: "p1" },
    { name: "رحلة الشلالات", price: 380, currency: "SAR", car_type: "سيدان", program_id: null },
    { name: "رحلة الشلالات", price: 600, currency: "SAR", car_type: "فان", program_id: null },
    // another city's programme: not this city's to offer
    { name: "جولة الجزر", price: 500, currency: "SAR", car_type: "سيدان", program_id: "lgk-1" },
  ],
  sarPer: { SAR: 1 },
  carTypes: [],
  tripCar: "سيدان",
  showPrice,
});

describe("tourChoices — what a tour field opens", () => {
  it("offers «يوم حر», the city's programmes, then the price list — each tour once, no other city's", () => {
    expect(tourChoices(catalog(false))).toEqual([{ value: "يوم حر" }, { value: "جولة المدينة" }, { value: "رحلة الشلالات" }]);
  });

  it("shows a listed tour's price for the trip's car only to who sees prices — a programme's too", () => {
    expect(tourChoices(catalog(true))).toEqual([
      { value: "يوم حر" },
      { value: "جولة المدينة", hint: "300 SAR" },
      { value: "رحلة الشلالات", hint: "380 SAR" },
    ]);
  });
});
