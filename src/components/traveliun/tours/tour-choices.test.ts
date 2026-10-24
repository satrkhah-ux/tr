import { describe, expect, it } from "vitest";
import { chosenTour, tourChoices, type TourCatalog } from "./TourRow";

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

  it("says «بدون سعر» at the end of the list, shows a long tour short, and lists one tour once however it was written — by name (2026-10-22, 2026-10-24)", () => {
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
      ["مرتفعات آيدر - شلالات اسكيت اوغلو", "500 SAR"],
      ["ميدان طرابزون", "450 SAR"],
      ["جولة اوزنغول", "بدون سعر"],
    ]);
    // what is picked is the tour's own name, whole
    expect(list[2].value).toBe(long);
  });
});

describe("tourChoices — one entry per tour, priced for the tours car (the evaluator's Phuket list, 2026-10-24)", () => {
  const fleet = [
    { name: "سيارة صغيرة", name_en: null, pax: 2, luggage: null },
    { name: "سيارة متوسطة", name_en: null, pax: 4, luggage: null },
    { name: "ميني فان", name_en: null, pax: 5, luggage: null },
    { name: "باص 40 مقعد", name_en: null, pax: 40, luggage: null },
  ];
  /** a city's programmes carry only the 0096 placeholder; its real tours are the old list's, one row per car — «باص كبير» is no fleet car */
  const phuket = (tripCar = "سيارة صغيرة", real = true): TourCatalog => ({
    city: "فوكيت",
    programs: [
      { id: "p1", city_name: "فوكيت", title: "الجولة الأولى", description: "خليج بان ناه - شلال بانغ باي", is_free_day: false, sort_order: 1 },
      { id: "p2", city_name: "فوكيت", title: "الجولة الثانية", description: "حديقة الحيوان - البلدة القديمة", is_free_day: false, sort_order: 2 },
    ],
    prices: [
      { name: "الجولة الأولى", price: 100, currency: "SAR", car_type: "سيارة صغيرة", program_id: "p1", provisional: true },
      // the placeholder's tour has the name the old list files real per-car rows under: those are its price
      { name: "الجولة الثانية", price: 100, currency: "SAR", car_type: "سيارة صغيرة", program_id: "p2", provisional: true },
      ...(real
        ? [
            { name: "الجولة الثانية (سيارة صغيرة)", price: 260, currency: "SAR" },
            { name: "الجولة الثانية (سيارة متوسطة)", price: 300, currency: "SAR" },
            { name: "زيارة خليج بان ناه (سيارة صغيرة)", price: 175, currency: "SAR" },
            { name: "زيارة خليج بان ناه (سيارة متوسطة)", price: 190, currency: "SAR" },
            { name: "زيارة خليج بان ناه (باص كبير)", price: 250, currency: "SAR" },
            { name: "زيارة خليج بان ناه (باص 40 مقعد)", price: 1000, currency: "SAR" },
            { name: "جزيرة كرابي (سيارة متوسطة)", price: 380, currency: "SAR" },
            { name: "جزيرة كرابي (باص كبير)", price: 450, currency: "SAR" },
          ]
        : []),
    ],
    sarPer: { SAR: 1 },
    carTypes: fleet,
    tripCar,
    showPrice: true,
  });
  const shown = (c: TourCatalog) => tourChoices(c).map((s) => [s.value, s.hint]);

  it("lists each tour once, by name, at the tours car's price — the placeholders out of the way of the real ones", () => {
    expect(shown(phuket())).toEqual([
      ["يوم حر", undefined],
      ["الجولة الثانية", "260 SAR"],
      // the small car has no row for it: the nearest car that seats as many says what it costs, and which car
      ["جزيرة كرابي", "380 SAR (سيارة متوسطة)"],
      ["زيارة خليج بان ناه", "175 SAR"],
    ]);
    // another car chosen for the tours: every price is that car's
    expect(shown(phuket("سيارة متوسطة")).find(([v]) => v === "زيارة خليج بان ناه")?.[1]).toBe("190 SAR");
    // a group too big for any priced car but the buses: the smallest bus that seats it
    expect(shown(phuket("ميني فان")).find(([v]) => v === "زيارة خليج بان ناه")?.[1]).toBe("1000 SAR (باص 40 مقعد)");
  });

  it("lists a city's placeholders, last and marked, when it has no real tour", () => {
    expect(shown(phuket("سيارة صغيرة", false))).toEqual([
      ["يوم حر", undefined],
      ["الجولة الأولى في فوكيت", "100 SAR · مؤقت"],
      ["الجولة الثانية في فوكيت", "100 SAR · مؤقت"],
    ]);
  });

  it("a tour picked stores the price the list shows — and the car it is for when the tours car has none", () => {
    const blank = { free: false, price: null };
    expect(chosenTour(phuket(), "زيارة خليج بان ناه", blank)).toMatchObject({ title: "زيارة خليج بان ناه", price: 175, car_type: undefined });
    expect(chosenTour(phuket(), "جزيرة كرابي", blank)).toMatchObject({ price: 380, car_type: "سيارة متوسطة" });
    // the same name as a placeholder: the real tour's price, never the placeholder's 100
    expect(chosenTour(phuket(), "الجولة الثانية", blank)).toMatchObject({ price: 260 });
    expect(chosenTour(phuket(), "يوم حر", { free: false, price: 175 })).toMatchObject({ free: true, price: 0 });
  });
});
