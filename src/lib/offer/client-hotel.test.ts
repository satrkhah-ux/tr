import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clientHotelDates,
  clientHotelPlace,
  emptyDraftData,
  emptyFlight,
  normalizeDraftData,
  soldHotels,
  transportRef,
  type ClientHotel,
  type DraftData,
  type DraftFlight,
  type DraftScope,
} from "./draft-types";
import { addCity, basicDays, setClientBooked, setClientHotel, withHotelLines, withTours } from "./basic";
import { suggestPricing, type PricingReference } from "./pricing-suggest";
import { citiesWithoutHotel, validateDraft } from "./draft-validation";
import { clientStayLine, TOUR_CAR_LINE } from "./itinerary";
import { draftToPreviewOffer } from "./preview-dto";
import { ownerExample, withRequiredAnswers } from "./draft-test-helpers";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { AR } from "@/components/offer-doc/labels";

/**
 * Order 7 (the owner, 2026-10-25): «في حال فقط جولات يتم ادخال الفندق يدويا حسب حجز العميل قد يكون حجز الفندق من
 * شركة اخرى او تطبيق». The client's own hotel is the pickup point and a line of the programme — never priced,
 * never a stay we sold. Each of the owner's four test files keeps working.
 */

const REF: PricingReference = { tours: [], transfers: [], services: [], rooms: [], fleet: [] };
const LABELS = { hotel: "الفندق", airline: "شركة الطيران" };
const HILTON: Partial<ClientHotel> = { name: "هيلتون كوالالمبور", address: "Jalan Stesen Sentral 3", source: "app" };

const leg = (order: DraftFlight["leg_order"], from: [string, string], to: [string, string], dep: string, arr: string): DraftFlight => ({
  ...emptyFlight(order),
  flight_no: order === "outbound" ? "SV834" : "SV835",
  from_airport: from[0],
  from_city: from[1],
  to_airport: to[0],
  to_city: to[1],
  departure_at: dep,
  arrival_at: arr,
});

/** A file as Basic builds it: KL 3 nights then Langkawi 2 by road, a tour in each, 10–15 Nov. */
function basicFile(scope: Partial<DraftScope>, opts: { flights?: boolean; tours?: boolean } = {}): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-11-10", nights: 5, days: 6, adults: 2, meal_plan: "breakfast" };
  data.scope = { ...data.scope, flights_intl: Boolean(opts.flights), flights_domestic: false, visas: false, ...scope };
  const tours = opts.tours === false ? 0 : 1;
  data = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 3, tours, hotel: { id: "h-kl", name: "بولمان" }, price: 900 }, "SAR") };
  data = { ...data, ...addCity(data, { name: "لنكاوي", nights: 2, tours, hotel: { id: "h-lgk", name: "بيرجايا" }, price: 800 }, "SAR") };
  const car = { enabled: true, car_type: "فان", cars: 1, note: "" };
  data.transport_plan = { airport: car, tours: { ...car, enabled: tours > 0 }, intercity: { ...car, mode: "car", modes: ["car"] } };
  data.cities = data.cities.map((c) => ({ ...c, tour_picks: withTours(c, c.tours ?? 0).map((p) => ({ ...p, title: `جولة ${c.city_name}`, price: 300 })) }));
  if (opts.flights) {
    data.flights = [
      leg("outbound", ["مطار الملك خالد (RUH)", "الرياض"], ["مطار كوالالمبور الدولي (KUL)", "كوالالمبور"], "2026-11-10T01:00", "2026-11-10T14:30"),
      leg("inbound", ["مطار لنكاوي (LGK)", "لنكاوي"], ["مطار الملك خالد (RUH)", "الرياض"], "2026-11-15T16:00", "2026-11-15T20:00"),
    ];
    data.flight_booking = { ...data.flight_booking, intl_price: 4000 };
  }
  return settle(data);
}

/** What Basic's commit does after a change: the derived rows again, the programme written from the file. */
function settle(data: DraftData): DraftData {
  const n = normalizeDraftData(JSON.parse(JSON.stringify(data)));
  return { ...n, days: basicDays(n) };
}

const withClient = (data: DraftData, index: number, hotel: Partial<ClientHotel> = HILTON) => settle({ ...data, cities: setClientHotel(data.cities, index, hotel) });
const everything = (data: DraftData) => JSON.stringify([data.transport, data.days, data.pricing]);

describe("the client's own hotel — the pieces", () => {
  it("names a pickup point without saying «فندق» twice, and nothing without a name", () => {
    expect(clientHotelPlace({ client_hotel: { name: "فندق الماسة" } })).toBe("فندق الماسة (حجز العميل)");
    expect(clientHotelPlace({ client_hotel: { name: " هيلتون " } })).toBe("فندق هيلتون (حجز العميل)");
    expect(clientHotelPlace({ client_hotel: { name: "  " } })).toBeNull();
    expect(clientHotelPlace({})).toBeNull();
  });

  it("keeps the hotel's own days inside the city's, else follows the city", () => {
    const city = { check_in: "2026-11-10", check_out: "2026-11-13" };
    expect(clientHotelDates({ ...city, client_hotel: { name: "x" } })).toEqual(city);
    expect(clientHotelDates({ ...city, client_hotel: { name: "x", check_in: "2026-11-11" } })).toEqual({ check_in: "2026-11-11", check_out: "2026-11-13" });
    // the trip moved: days outside the city are let go
    expect(clientHotelDates({ ...city, client_hotel: { name: "x", check_in: "2026-11-01", check_out: "2026-11-20" } })).toEqual(city);
    expect(clientHotelDates({ ...city, client_hotel: { name: "x", check_in: "2026-11-12", check_out: "2026-11-11" } })).toEqual(city);
  });

  it("reads a client hotel back from the jsonb, and drops one that is not an object", () => {
    const raw = JSON.parse(JSON.stringify(basicFile({ hotels: false })));
    raw.cities[0].client_hotel = { name: "هيلتون", source: "company" };
    raw.cities[1].client_hotel = "junk";
    const data = normalizeDraftData(raw);
    expect(data.cities[0].client_hotel).toEqual({ name: "هيلتون", source: "company" });
    expect(data.cities[1].client_hotel).toBeUndefined();
  });
});

describe("tours only (scope.hotels off)", () => {
  it("sells no hotel: the line Basic made for each city is never priced, printed or validated", () => {
    const data = basicFile({ hotels: false, transport: true });
    // addCity still writes a line per city — it is just not sold
    expect(data.hotels.length).toBe(2);
    expect(soldHotels(data)).toEqual([]);
    expect(suggestPricing(data, REF, LABELS).filter((i) => i.item_type === "hotel")).toEqual([]);
    expect(draftToPreviewOffer(data).hotels).toEqual([]);
    expect(validateDraft(withRequiredAnswers(data)).blocking.filter((i) => i.stage === "hotels")).toEqual([]);
  });

  it("never prices the client's hotel or counts it in a total — the transfers keep their lines and refs", () => {
    const before = basicFile({ hotels: false, transport: true });
    const after = withClient(before, 0);
    const lines = (d: DraftData) => suggestPricing(d, REF, LABELS);
    expect(lines(after).some((i) => i.item_type === "hotel")).toBe(false);
    expect(lines(after).map((i) => [i.item_type, i.ref, i.quantity, i.sell_price])).toEqual(lines(before).map((i) => [i.item_type, i.ref, i.quantity, i.sell_price]));
    // the name is never beside a price of its own: only a transfer's words carry it, as where the car goes
    expect(lines(after).filter((i) => i.description.includes("هيلتون")).every((i) => i.item_type === "transport")).toBe(true);
  });

  it("is the pickup point of the transfers: met at the airport and taken to it, driven from it to the next city", () => {
    const data = withClient(basicFile({ hotels: false, transport: true }), 0);
    const texts = data.transport.map((t) => t.text);
    expect(texts).toContain("الاستقبال من المطار إلى فندق هيلتون كوالالمبور (حجز العميل)");
    expect(texts).toContain("الانتقال من فندق هيلتون كوالالمبور (حجز العميل) إلى لنكاوي");
    // Langkawi has none yet: its farewell is the trip's own
    expect(data.transport.find((t) => t.to_place === "المطار")?.text).toBeUndefined();
    // the places stay the keys the price lists read
    expect(data.transport.map(transportRef)).toEqual(basicFile({ hotels: false, transport: true }).transport.map(transportRef));
    const both = withClient(data, 1, { name: "فندق الشاطئ" });
    expect(both.transport.map((t) => t.text)).toContain("الانتقال من فندق هيلتون كوالالمبور (حجز العميل) إلى فندق الشاطئ (حجز العميل)");
    expect(both.transport.map((t) => t.text)).toContain("التوصيل من فندق الشاطئ (حجز العميل) إلى المطار");
  });

  it("is where the tours pick the group up, on the tour's car line", () => {
    const data = withClient(basicFile({ hotels: false, transport: true }), 0);
    const tour = data.days.find((d) => d.title === "جولة كوالالمبور")!;
    expect(tour.activities).toContain(`${TOUR_CAR_LINE}فان — الاستلام من فندق هيلتون كوالالمبور (حجز العميل)`);
    // Langkawi's tour is not picked up from Kuala Lumpur's hotel
    expect(data.days.find((d) => d.title === "جولة لنكاوي")!.activities.join(" ")).not.toContain("هيلتون");
  });

  it("prints «الإقامة: … — حجز العميل» on the day the group gets there — never a stay, stars, room or board", () => {
    const data = withClient(basicFile({ hotels: false, transport: true }), 0);
    const preview = draftToPreviewOffer(data);
    const said = preview.days.filter((d) => d.activities.includes("الإقامة: فندق هيلتون كوالالمبور — حجز العميل"));
    expect(said.map((d) => d.date)).toEqual(["2026-11-10"]);
    expect(preview.hotels).toEqual([]);
    const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: preview }));
    expect(html).toContain("الإقامة: فندق هيلتون كوالالمبور — حجز العميل");
    expect(html).not.toContain(AR.accommodation);
    expect(html).not.toContain("★");
    expect(html).not.toContain("شامل الإفطار");
  });

  it("says the hotel on its own first day when the client narrowed its dates", () => {
    const data = withClient(basicFile({ hotels: false }), 0, { ...HILTON, check_in: "2026-11-11" });
    expect(clientStayLine(data.cities, "2026-11-10")).toBeNull();
    expect(clientStayLine(data.cities, "2026-11-11")).toBe("الإقامة: فندق هيلتون كوالالمبور — حجز العميل");
  });

  it("missing, it is only a hint: the file issues exactly as it would with it", () => {
    const without = validateDraft(withRequiredAnswers(basicFile({ hotels: false, transport: true })));
    const withIt = validateDraft(withRequiredAnswers(withClient(basicFile({ hotels: false, transport: true }), 0)));
    expect(without.blocking.map((i) => i.key)).toEqual(withIt.blocking.map((i) => i.key));
    expect(without.warnings.map((i) => i.key)).toEqual(withIt.warnings.map((i) => i.key));
  });
});

describe("the owner's other test files", () => {
  it("flights + tours: met off the flight at the client's hotel, the flight priced, no hotel", () => {
    const data = withClient(basicFile({ hotels: false, transport: true }, { flights: true }), 0);
    const items = suggestPricing(data, REF, LABELS);
    expect(items.find((i) => i.ref === "flight:intl")?.sell_price).toBe(4000);
    expect(items.some((i) => i.item_type === "hotel")).toBe(false);
    expect(data.transport[0].text).toBe("الاستقبال من المطار إلى فندق هيلتون كوالالمبور (حجز العميل)");
  });

  it("hotels only: every stay priced as before, nothing of the client's anywhere", () => {
    const data = basicFile({ hotels: true, transport: false }, { tours: false });
    expect(soldHotels(data)).toBe(data.hotels);
    const hotels = suggestPricing(data, REF, LABELS).filter((i) => i.item_type === "hotel");
    expect(hotels.map((i) => i.sell_price)).toEqual([900, 800]);
    expect(draftToPreviewOffer(data).hotels.map((h) => h.hotel_name)).toEqual(["بولمان", "بيرجايا"]);
    expect(everything(data)).not.toContain("حجز العميل");
  });

  it("full package (the owner's example) and any file from before: the same file, the same lines", () => {
    const data = ownerExample();
    const again = normalizeDraftData(JSON.parse(JSON.stringify(data)));
    expect(again.cities.every((c) => !("client_hotel" in c))).toBe(true);
    expect(soldHotels(again)).toBe(again.hotels);
    expect(again.transport).toEqual(data.transport);
    expect(basicDays(again)).toEqual(basicDays(data));
    expect(everything(again)).not.toContain("حجز العميل");
    expect(draftToPreviewOffer(again).hotels.length).toBe(again.hotels.length);
    expect(citiesWithoutHotel(again)).toEqual(citiesWithoutHotel(data));
  });
});

describe("a mixed trip — we book Kuala Lumpur, the client books Langkawi", () => {
  const mixed = () => {
    const data = basicFile({ hotels: true, transport: true });
    // the sheet as it was worked out, both stays on it
    data.pricing = { ...data.pricing, items: suggestPricing(data, REF, LABELS) };
    return data;
  };

  it("drops Langkawi's line and its price, and starts the client's hotel from the name that was typed", () => {
    const data = mixed();
    const lgk = data.hotels.find((h) => h.city_name === "لنكاوي")!;
    const next = { ...data, ...setClientBooked(data, 1, true) };
    expect(next.hotels.map((h) => h.city_name)).toEqual(["كوالالمبور"]);
    expect(next.pricing.items.some((i) => i.ref === lgk.id)).toBe(false);
    expect(next.pricing.items.filter((i) => i.item_type === "hotel")).toHaveLength(1);
    expect(next.cities[1].client_hotel).toEqual({ name: "بيرجايا", hotel_id: "h-lgk" });
    // Basic's commit never gives it a line again, and nothing asks for one
    expect(withHotelLines(next, "SAR")).toBe(next.hotels);
    expect(citiesWithoutHotel(next)).toEqual([]);
  });

  it("prices, prints and books only our city; the client's is the pickup point", () => {
    const data = mixed();
    const next = settle({ ...data, ...setClientBooked(data, 1, true) });
    expect(suggestPricing(next, REF, LABELS).filter((i) => i.item_type === "hotel").map((i) => i.description)).toEqual(["كوالالمبور — بولمان"]);
    expect(draftToPreviewOffer(next).hotels.map((h) => h.hotel_name)).toEqual(["بولمان"]);
    expect(next.transport.map((t) => t.text)).toContain("التوصيل من فندق بيرجايا (حجز العميل) إلى المطار");
    expect(validateDraft(withRequiredAnswers(next)).blocking.filter((i) => i.stage === "hotels")).toEqual([]);
  });

  it("a line left on a client's city (switched on before the hotels were) is never sold", () => {
    const data = mixed();
    const stray = { ...data, cities: setClientHotel(data.cities, 1, { name: "الشاطئ" }) };
    expect(soldHotels(stray).map((h) => h.city_name)).toEqual(["كوالالمبور"]);
  });

  it("switched off, the city is ours again: Basic gives it a fresh line to fill", () => {
    const data = mixed();
    const on = { ...data, ...setClientBooked(data, 1, true) };
    const off = { ...on, ...setClientBooked(on, 1, false) };
    expect(off.cities[1].client_hotel).toBeUndefined();
    const lines = withHotelLines(off, "SAR");
    expect(lines.map((h) => [h.city_name, h.hotel_name])).toEqual([
      ["كوالالمبور", "بولمان"],
      ["لنكاوي", ""],
    ]);
    expect(lines[1].rooms.every((r) => r.price == null)).toBe(true);
  });
});
