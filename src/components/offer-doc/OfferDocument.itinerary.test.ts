import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO, type ItineraryDayLine } from "@/lib/offer/dto";
import { AR } from "./labels";

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
    // "أيام ممطرة" (historically wet days), not "احتمال مطر" (a probability)
    expect(line).toContain("أيام ممطرة");
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
