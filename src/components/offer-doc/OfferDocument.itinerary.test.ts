import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO, type ItineraryDayLine } from "@/lib/offer/dto";
import { AR } from "./labels";
import { deriveCityDates, emptyDraftData, normalizeDraftHotel } from "@/lib/offer/draft-types";
import { daysFromTours, draftDaySkeleton } from "@/lib/offer/itinerary";
import { draftToPreviewOffer } from "@/lib/offer/preview-dto";

/**
 * The printed «البرنامج اليومي». Two things must hold no matter what:
 * the section disappears entirely when no day was written, and a weather
 * reading ALWAYS states whether it is a forecast or a climate average — a
 * five-year average must never reach a client looking like a forecast.
 */
function day(over: Partial<ItineraryDayLine> & { day_number: number }): ItineraryDayLine {
  return {
    date: "2026-08-01",
    city_name: "كوالالمبور",
    title: "الوصول وجولة في المدينة",
    activities: ["الاستقبال في المطار", "تسجيل الدخول في الفندق"],
    temp_max: 32,
    temp_min: 24,
    rain_chance: 60,
    weather_code: 80,
    weather_source: "forecast",
    ...over,
  };
}

function offerWith(days: ItineraryDayLine[]): InternalOfferDTO {
  return {
    serial: "AD-9-1000-20260801",
    destination: "ماليزيا",
    customer_name: "عميل",
    customer_phone: null,
    employee_name: null,
    arrival_date: "2026-08-01",
    departure_date: "2026-08-08",
    duration: "7 ليالٍ",
    offer_date: "2026-07-20",
    issue_date: "2026-07-20",
    validity_date: "2026-08-01",
    adults: 2,
    children: 0,
    infants: 0,
    total: 9000,
    currency: "SAR",
    hotels: [],
    flights: [],
    transport: [],
    visas: [],
    includes: [],
    excludes: [],
    terms: [],
    climate: [],
    days,
    pricing: computeOfferPricing([], { SAR: 1 }, "SAR"),
  };
}

function renderClient(days: ItineraryDayLine[]): string {
  return renderToStaticMarkup(
    createElement(OfferDocument, { variant: "client", offer: toClientOfferDTO(offerWith(days)) }),
  );
}

/**
 * Just the day's weather line. The section's explanatory footnote also mentions
 * "توقّع" and "معدّل مناخي", so asserting against the whole document would pass
 * (or fail) for the wrong reason — the label under test is the one on the DAY.
 */
function weatherLine(html: string): string | null {
  const match = html.match(/<span class="od-sub">([\s\S]*?)<\/span>/);
  return match ? match[1] : null;
}

describe("OfferDocument — daily program", () => {
  it("prints the heading, the day title, its activities and the date", () => {
    const html = renderClient([day({ day_number: 1 })]);
    expect(html).toContain(AR.tours);
    expect(html).toContain("الوصول وجولة في المدينة");
    expect(html).toContain("الاستقبال في المطار");
    expect(html).toContain("2026-08-01");
  });

  it("omits the whole section when no day was written", () => {
    const html = renderClient([]);
    expect(html).not.toContain(AR.tours);
    expect(html).not.toContain(AR.weatherNote);
  });

  it("labels a forecast as a forecast", () => {
    const line = weatherLine(renderClient([day({ day_number: 1, weather_source: "forecast" })]));
    expect(line).toContain("32°");
    expect(line).toContain("توقّع");
    expect(line).not.toContain("معدّل مناخي");
  });

  it("labels a climate average as an average — never as a forecast", () => {
    const line = weatherLine(renderClient([day({ day_number: 1, weather_source: "normals", weather_code: null })]));
    expect(line).toContain("معدّل مناخي");
    // the season in words, not "احتمال مطر" (a probability)
    expect(line).toContain("في هذا الموسم");
    expect(line).not.toContain("احتمال مطر");
  });

  it("always prints the note explaining what the weather figures are", () => {
    expect(renderClient([day({ day_number: 1 })])).toContain(AR.weatherNote);
  });

  it("prints a day that has no weather reading at all", () => {
    const html = renderClient([
      day({ day_number: 1, weather_source: null, temp_max: null, temp_min: null, rain_chance: null, weather_code: null }),
    ]);
    expect(html).toContain("الوصول وجولة في المدينة");
    expect(weatherLine(html)).toBeNull(); // no weather box, not an empty one
  });

  it("prints a reading whose numbers are partly missing without inventing any", () => {
    const line = weatherLine(renderClient([day({ day_number: 1, rain_chance: null, weather_code: null })]));
    expect(line).toContain("32°");
    expect(line).not.toContain("null");
    expect(line).not.toContain("NaN");
  });

  it("falls back to the city name when the day has no title", () => {
    const html = renderClient([day({ day_number: 1, title: "", activities: [] })]);
    expect(html).toContain("كوالالمبور");
  });
});

/**
 * Generator v4 order 5: the programme city by city. A heading per visit — the
 * city, its dates, its hotel or hotels — then its days; the arrival day's
 * reception before its tour; the tour's car on a line of its own; a free day
 * set apart; no price anywhere in it.
 */
describe("OfferDocument — the programme city by city", () => {
  const KL = "كوالالمبور";
  const BKK = "بانكوك";
  const at = (date: string, city: string, over: Partial<ItineraryDayLine> = {}) =>
    day({ day_number: Number(date.slice(8)), date, city_name: city, weather_source: null, ...over });
  const hotel = (city: string, name: string, check_in: string, check_out: string) => ({
    city_name: city, hotel_name: name, stars: 5, room_type: null, board_type: null, rooms_count: 1, nights: 2,
    check_in, check_out, sell_price: 4321, sell_currency: "SAR", buy_price: 3000, buy_currency: "SAR",
    cancellation_policy: null, excluded_surcharges: [], valid_until: null, image_url: null, facilities: [],
    supplier_id: null, supplier_name: null, rate_key: null, net_base: null, net_source_currency: null,
    fx_rate: null, fx_date: null, ref_sell_base: null, markup_amount: null, markup_pct: null,
  });
  const render = (days: ItineraryDayLine[], hotels: ReturnType<typeof hotel>[]) =>
    renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: toClientOfferDTO({ ...offerWith(days), hotels }) }));
  const headings = (html: string) => [...html.matchAll(/class="od-city-head">([\s\S]*?)<\/th>/g)].map((m) => m[1]);

  it("heads each city with its dates and hotels — two on the same dates both named — then its days", () => {
    const html = render(
      [at("2026-10-20", KL), at("2026-10-21", KL), at("2026-10-22", BKK), at("2026-10-23", BKK), at("2026-10-24", BKK)],
      [
        hotel(KL, "فندق الشروق", "2026-10-20", "2026-10-22"),
        hotel(KL, "فندق الغروب", "2026-10-20", "2026-10-22"),
        hotel(BKK, "فندق النهر", "2026-10-22", "2026-10-23"),
        hotel(BKK, "فندق الحديقة", "2026-10-23", "2026-10-24"),
      ],
    );
    const [kl, bkk, ...rest] = headings(html);
    expect(rest).toEqual([]);
    expect(kl).toContain(KL);
    expect(kl).toContain("20 – 21 أكتوبر 2026");
    expect(kl).toContain("فندق الشروق");
    expect(kl).toContain("فندق الغروب");
    expect(kl).not.toContain("فندق النهر");
    expect(bkk).toContain("22 – 24 أكتوبر 2026");
    expect(bkk).toContain("فندق النهر");
    expect(bkk).toContain("فندق الحديقة");
    // the heading comes before its own days, and Bangkok's after Kuala Lumpur's
    expect(html.indexOf(kl)).toBeLessThan(html.indexOf("2026-10-20"));
    expect(html.indexOf("2026-10-21")).toBeLessThan(html.indexOf(bkk));
    // no price in the programme
    expect(kl + bkk).not.toContain("4321");
  });

  it("gives a city the trip returns to a heading per visit, each with only that visit's hotel", () => {
    const html = render(
      [at("2026-10-20", KL), at("2026-10-21", BKK), at("2026-10-22", KL), at("2026-10-23", KL)],
      [hotel(KL, "فندق الذهاب", "2026-10-20", "2026-10-21"), hotel(BKK, "فندق النهر", "2026-10-21", "2026-10-22"), hotel(KL, "فندق العودة", "2026-10-22", "2026-10-23")],
    );
    const [first, , last] = headings(html);
    expect(first).toContain("فندق الذهاب");
    expect(first).not.toContain("فندق العودة");
    expect(last).toContain("فندق العودة");
    expect(last).not.toContain("فندق الذهاب");
  });

  it("prints the arrival day's reception first, then its tour, then the tour's car on its own line", () => {
    const html = render(
      [
        at("2026-10-20", KL, {
          title: "الوصول إلى كوالالمبور",
          transport_note: "استقبال من المطار إلى الفندق — فان × 2",
          activities: ["الاستقبال من المطار من قبل موظف ترافليون والتوجه إلى الفندق", "جولة المدينة: برجا بتروناس", "التنقل بـفان × 2"],
        }),
      ],
      [],
    );
    const order = ["استقبال من المطار إلى الفندق — فان × 2", "الاستقبال من المطار من قبل موظف", "جولة المدينة: برجا بتروناس", "التنقل بـفان × 2"].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<span class="od-sub od-day-move">التنقل بـفان × 2</span>');
  });

  it("keeps a day without a tour as it was: what happens, then how the group moves", () => {
    const html = render([at("2026-10-24", KL, { title: "المغادرة", activities: ["تسجيل الخروج"], transport_note: "توديع من الفندق إلى المطار — فان" })], []);
    expect(html.indexOf("تسجيل الخروج")).toBeLessThan(html.indexOf("توديع من الفندق"));
  });

  it("sets a free day apart", () => {
    const html = render([at("2026-10-20", KL, { title: "الجولة" }), at("2026-10-21", KL, { title: "يوم حر", activities: [] })], []);
    expect(html.match(/class="od-day od-day-free"/g)).toHaveLength(1);
    expect(html.match(/class="od-day"/g)).toHaveLength(1);
  });

  it("prints a travel day with no city under no heading", () => {
    const html = render([at("2026-10-19", "", { title: "السفر إلى ماليزيا" }), at("2026-10-20", KL)], []);
    expect(headings(html)).toHaveLength(1);
    expect(html).toContain("السفر إلى ماليزيا");
  });
});

/**
 * The same, from a draft — the preview path the issue path mirrors: two hotels
 * on the same dates, a tour on the arrival day in two vans, another the next
 * day. The trip's «سيارة الجولات» line is not repeated on a day whose tour
 * already says its car.
 */
describe("OfferDocument — a v4 draft's programme", () => {
  it("one car line per tour day, the reception first, both hotels in the heading", () => {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 2, days: 3, adults: 9 };
    data.cities = deriveCityDates("2026-10-20", [{ city_name: "كوالالمبور", nights: 2, check_in: null, check_out: null }]);
    data.hotels = [
      normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق الشروق", nights: 2 }),
      normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق الغروب", nights: 2, dates: "same" }),
    ];
    data.transport_plan = {
      ...data.transport_plan,
      airport: { ...data.transport_plan.airport, car_type: "فان", cars: 2 },
      tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 },
    };
    data.cities[0] = {
      ...data.cities[0],
      tours: 2,
      tour_picks: [
        { program_id: null, title: "جولة المدينة", text: "برجا بتروناس", price: 400, date: "2026-10-20", cars: 2 },
        { program_id: null, title: "جزيرة الحامل", text: "رحلة بحرية", price: 500, date: "2026-10-21", cars: 2 },
      ],
    };
    data.days = daysFromTours({ ...data, days: draftDaySkeleton(data) }, true);

    const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: draftToPreviewOffer(data) }));
    expect(html).not.toContain("سيارة الجولات");
    expect(html.match(/التنقل بـفان × 2/g)).toHaveLength(2);
    const head = html.match(/class="od-city-head">([\s\S]*?)<\/th>/)?.[1] ?? "";
    expect(head).toContain("فندق الشروق");
    expect(head).toContain("فندق الغروب");
    const reception = html.indexOf("استقبال من المطار إلى الفندق — فان × 2");
    expect(reception).toBeGreaterThan(0);
    expect(reception).toBeLessThan(html.indexOf("جولة المدينة: برجا بتروناس"));
    // the tours were priced 400 and 500 a car: no figure reaches the programme
    const programme = (html.match(/<table class="od-table od-days">[\s\S]*?<\/table>/g) ?? []).join("");
    expect(programme).toContain("جزيرة الحامل");
    expect(programme).not.toMatch(/400|500|800|1000/);
  });

  it("the day home with «جولة قبل المغادرة»: the tour and its car, then the airport and the farewell", () => {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 2, days: 3, adults: 9 };
    data.cities = deriveCityDates("2026-10-20", [{ city_name: "كوالالمبور", nights: 2, check_in: null, check_out: null }]);
    data.transport_plan = {
      ...data.transport_plan,
      airport: { ...data.transport_plan.airport, car_type: "فان", cars: 2 },
      tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 },
    };
    data.cities[0] = {
      ...data.cities[0],
      tours: 1,
      tour_picks: [{ program_id: null, title: "جولة المدينة", text: "برجا بتروناس", price: 400, date: "2026-10-22", cars: 2, departure: true }],
    };
    data.days = daysFromTours({ ...data, days: draftDaySkeleton(data) }, true);

    const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: draftToPreviewOffer(data) }));
    const order = ["جولة المدينة: برجا بتروناس", "التنقل بـفان × 2", "تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة", "توديع من الفندق إلى المطار"].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
