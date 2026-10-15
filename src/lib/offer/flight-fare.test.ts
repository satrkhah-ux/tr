import { describe, expect, it } from "vitest";
import { emptyDraftData, emptyFlightBooking, normalizeDraftData, type FlightBooking } from "./draft-types";
import { fareBreakdown, flightBookingTotal, withFare, withFlightTotals, withTypedTotal } from "./flight-fare";

/** «للفرد»: the acceptance file — 2 adults, a child and an infant at 1,500 / 1,200 / 300. */
const PAX = { adults: 2, children: 1, infants: 1 };
function perPerson(): FlightBooking {
  return withFare({ ...emptyFlightBooking(), intl_price: 9999 }, PAX, "intl", {
    price_mode: "per_person",
    adult_price: 1500,
    child_price: 1200,
    infant_price: 300,
  });
}

describe("flightBookingTotal", () => {
  it("adds the tickets up and writes the total where every reader looks", () => {
    const b = perPerson();
    expect(flightBookingTotal(b, PAX, "intl")).toBe(4500);
    expect(b.intl_price).toBe(4500);
    // the domestic booking is its own: still a total, untouched
    expect(b.dom_fare.price_mode).toBe("total");
    expect(b.dom_price).toBeNull();
  });

  it("works the total out again when the travellers change", () => {
    const three = { ...PAX, adults: 3 };
    const b = withFlightTotals(perPerson(), three);
    expect(b.intl_price).toBe(6000);
    // nothing moved → the same booking, so a screen does not redraw for nothing
    expect(withFlightTotals(b, three)).toBe(b);
  });

  it("back to «إجمالي» keeps the figure the tickets came to", () => {
    const b = withFare(withFlightTotals(perPerson(), { ...PAX, adults: 3 }), { ...PAX, adults: 3 }, "intl", { price_mode: "total" });
    expect([b.intl_fare.price_mode, b.intl_price]).toEqual(["total", 6000]);
    // and a total no longer follows the travellers
    expect(withFlightTotals(b, PAX).intl_price).toBe(6000);
  });

  it("prices a child at the adult's fare until told otherwise, and an infant at nothing", () => {
    const b = withFare(emptyFlightBooking(), PAX, "dom", { price_mode: "per_person", adult_price: 400 });
    expect(b.dom_price).toBe(1200);
    expect(fareBreakdown(b, PAX, "dom")).toBe("2 بالغ × 400 + طفل × 400");
  });

  it("is unpriced in «للفرد» until the adult's ticket is typed", () => {
    const b = withFare({ ...emptyFlightBooking(), intl_price: 3000 }, PAX, "intl", { price_mode: "per_person" });
    expect(flightBookingTotal(b, PAX, "intl")).toBeNull();
  });

  it("a total typed on the pricing sheet switches the booking to «إجمالي» at that figure", () => {
    const b = withTypedTotal(perPerson(), "intl", 5000);
    expect([b.intl_fare.price_mode, b.intl_price, flightBookingTotal(b, PAX, "intl")]).toEqual(["total", 5000, 5000]);
    // the tickets typed are kept, for when the agent goes back to «للفرد»
    expect(b.intl_fare.adult_price).toBe(1500);
  });

  it("says how the total was reached, the way the pricing line reads", () => {
    expect(fareBreakdown(perPerson(), { adults: 3, children: 1, infants: 0 }, "intl")).toBe("3 بالغ × 1,500 + طفل × 1,200");
    expect(fareBreakdown(perPerson(), PAX, "intl")).toBe("2 بالغ × 1,500 + طفل × 1,200 + رضيع × 300");
    expect(fareBreakdown(withTypedTotal(perPerson(), "intl", 10), PAX, "intl")).toBeNull();
  });
});

describe("normalizeDraftData: the flight fare", () => {
  it("opens an older file as «إجمالي» with its own number", () => {
    const data = normalizeDraftData({ ...emptyDraftData(), flight_booking: { mode: "round", cabin: "اقتصادية", intl_price: 4200, dom_price: 800 } } as never);
    expect(data.flight_booking.intl_fare.price_mode).toBe("total");
    expect(data.flight_booking.dom_fare.price_mode).toBe("total");
    expect([data.flight_booking.intl_price, data.flight_booking.dom_price]).toEqual([4200, 800]);
  });

  it("re-works a «للفرد» total that was saved before the travellers changed", () => {
    const stale = { ...perPerson(), intl_price: 4500 };
    const data = normalizeDraftData({ ...emptyDraftData(), trip: { ...emptyDraftData().trip, ...PAX, adults: 3 }, flight_booking: stale } as never);
    expect(data.flight_booking.intl_price).toBe(6000);
  });
});
