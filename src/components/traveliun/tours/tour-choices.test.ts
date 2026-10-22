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

  it("lists a tour the old list filed once per car (in its name) once — priced for the trip's car, else the nearest car, named", () => {
    const old: TourCatalog = {
      ...catalog(true),
      programs: [],
      prices: [
        { name: "جولة البسفور (فيتو)", price: 100, currency: "SAR" },
        { name: "جولة البسفور (فان مرسيدس)", price: 150, currency: "SAR" },
        { name: "جولة البسفور (سيارة سبرانتر)", price: 150, currency: "SAR" },
        { name: "حديقة سوي تين (Suoi Tien)", price: 90, currency: "SAR" },
      ],
      carTypes: [
        { name: "سيارة صغيرة", name_en: null, pax: 2, luggage: null },
        { name: "فيتو", name_en: null, pax: 8, luggage: null },
        { name: "فان مرسيدس", name_en: null, pax: 8, luggage: null },
        { name: "سيارة سبرانتر", name_en: null, pax: 12, luggage: null },
      ],
    };
    expect(tourChoices({ ...old, tripCar: "فان مرسيدس" })).toEqual([
      { value: "يوم حر" },
      { value: "جولة البسفور", hint: "150 SAR" },
      // brackets that are not a car stay part of the name
      { value: "حديقة سوي تين (Suoi Tien)", hint: "90 SAR" },
    ]);
    expect(tourChoices({ ...old, tripCar: "سيارة صغيرة" })[1]).toEqual({ value: "جولة البسفور", hint: "100 SAR (فيتو)" });
  });

  it("says a foreign price in the file's riyals first", () => {
    const usd: TourCatalog = {
      ...catalog(true),
      programs: [],
      prices: [{ name: "جولة البسفور (فان مرسيدس)", price: 150, currency: "USD" }],
      sarPer: { SAR: 1, USD: 3.75 },
      carTypes: [{ name: "سيارة صغيرة", name_en: null, pax: 2, luggage: null }, { name: "فان مرسيدس", name_en: null, pax: 8, luggage: null }],
      tripCar: "سيارة صغيرة",
    };
    expect(tourChoices(usd)[1]).toEqual({ value: "جولة البسفور", hint: "≈ 563 ر.س (150 USD · فان مرسيدس)" });
  });

  it("says «بدون سعر» at the end of the list, shows a long tour short, and lists one tour once however it was written (2026-10-22)", () => {
    const long = "جولة يوم كامل بسيارة مرسيدس Vito - زيارة ميدان طرابزون زيارة مول الفورم - متحف آيا صوفيا";
    const list = tourChoices({
      ...catalog(true),
      programs: [],
      prices: [
        { name: "جولة اوزنغول", price: 0, currency: "SAR", car_type: "سيدان", program_id: null },
        { name: long, price: 450, currency: "SAR", car_type: "سيدان", program_id: null },
        { name: "مرتفعات آيدر - شلالات اسكيت اوغلو", price: 500, currency: "SAR", car_type: "سيدان", program_id: null },
        { name: "مرتفعات آيدر شلالات اسكيت اوغلو ثم التوصيل الى طرابزون", price: 500, currency: "SAR", car_type: "سيدان", program_id: null },
      ],
    });
    expect(list.map((s) => [s.label ?? s.value, s.hint])).toEqual([
      ["يوم حر", undefined],
      ["ميدان طرابزون", "450 SAR"],
      ["مرتفعات آيدر - شلالات اسكيت اوغلو", "500 SAR"],
      ["جولة اوزنغول", "بدون سعر"],
    ]);
    // what is picked is the tour's own name, whole
    expect(list[1].value).toBe(long);
  });
});
