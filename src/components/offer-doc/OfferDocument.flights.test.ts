import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO } from "@/lib/offer/dto";
import type { InternalFlightLine } from "@/lib/offer/dto";
import { AR } from "./labels";

/**
 * The printed document must separate INTERNATIONAL legs (outbound/inbound) from
 * DOMESTIC ones (`internal` — a hop inside the destination country). Domestic
 * flights exist for only some destinations, so that section must disappear
 * entirely when there are none — never print an empty heading.
 */
function flight(over: Partial<InternalFlightLine>): InternalFlightLine {
  return {
    airline: "الخطوط السعودية",
    flight_no: "SV820",
    from_airport: "جدة (JED)",
    to_airport: "كوالالمبور (KUL)",
    departure_at: "2026-08-01T02:00",
    arrival_at: "2026-08-01T15:30",
    cabin_class: "الاقتصادية",
    baggage_allowance: "30kg",
    leg_order: "outbound",
    sell_price: null,
    sell_currency: null,
    buy_price: null,
    buy_currency: null,
    ...over,
  };
}

function offerWith(flights: InternalFlightLine[]): InternalOfferDTO {
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
    flights,
    transport: [],
    visas: [],
    includes: [],
    excludes: [],
    terms: [],
    climate: [],
    pricing: computeOfferPricing([], { SAR: 1 }, "SAR"),
  };
}

function renderClient(flights: InternalFlightLine[]): string {
  const client = toClientOfferDTO(offerWith(flights));
  return renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: client }));
}

describe("OfferDocument — flight sections", () => {
  it("prints BOTH headings when the trip has international and domestic legs", () => {
    const html = renderClient([
      flight({ leg_order: "outbound" }),
      flight({ leg_order: "inbound" }),
      flight({ leg_order: "internal", from_airport: "كوالالمبور (KUL)", to_airport: "لنكاوي (LGK)" }),
    ]);
    expect(html).toContain(AR.flightsIntl);
    expect(html).toContain(AR.flightsDomestic);
    // the domestic route still renders inside its own section
    expect(html).toContain("لنكاوي (LGK)");
  });

  it("omits the domestic section entirely when there are no internal legs", () => {
    const html = renderClient([flight({ leg_order: "outbound" }), flight({ leg_order: "inbound" })]);
    expect(html).not.toContain(AR.flightsDomestic);
    // with no domestic block the section keeps the plain "الطيران" heading
    expect(html).toContain(AR.flights);
  });

  it("prints only the domestic section when the trip has internal legs alone", () => {
    const html = renderClient([flight({ leg_order: "internal" })]);
    expect(html).toContain(AR.flightsDomestic);
    expect(html).not.toContain(AR.flightsIntl);
  });

  it("renders no flight table at all when there are no flights", () => {
    const html = renderClient([]);
    expect(html).not.toContain(AR.flightsDomestic);
    expect(html).not.toContain(AR.flightLeg);
  });
});
