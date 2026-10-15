import { describe, expect, it } from "vitest";
import { addStay, deriveTransportRows, emptyDraftData, emptyFlight, type DraftData, type DraftFlight } from "@/lib/offer/draft-types";
import { addCity, withTours } from "@/lib/offer/basic";
import { planBookingsFromDraft } from "./seed-plan";

/** The trial's case: Malaysia 20–27 Nov, KL 4 + Langkawi 3, 2 + 2, a domestic flight there and back. */
function malaysia(): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-11-20", nights: 7, adults: 2, children: 2, meal_plan: "breakfast" };
  data.scope = { ...data.scope, transport: true, hotels: true };
  data.flights = [];
  data = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 4, tours: 2, hotel: { id: "h1", name: "بولمان سيتي سنتر" }, room: "ديلوكس", rooms: 2, price: 1600 }, "SAR") };
  data = { ...data, ...addCity(data, { name: "لنكاوي", nights: 3, tours: 1, hotel: { id: "h2", name: "منتجع بيرجايا" }, room: "ديلوكس مطلة على البحر", rooms: 2, price: 2100 }, "SAR") };
  const leg = (order: DraftFlight["leg_order"], no: string, from: string, fromCity: string, to: string, toCity: string, dep: string, arr: string): DraftFlight => ({
    ...emptyFlight(order),
    flight_no: no,
    from_airport: from,
    to_airport: to,
    from_city: fromCity,
    to_city: toCity,
    departure_at: dep,
    arrival_at: arr,
  });
  data.flights = [
    leg("outbound", "SV834", "مطار الملك خالد (RUH)", "الرياض", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "2026-11-20T01:00", "2026-11-20T14:30"),
    leg("internal", "MH1430", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "مطار لنكاوي (LGK)", "لنكاوي", "2026-11-24T10:00", "2026-11-24T11:05"),
    leg("internal", "MH1431", "مطار لنكاوي (LGK)", "لنكاوي", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "2026-11-27T09:00", "2026-11-27T10:05"),
    leg("inbound", "SV835", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "مطار الملك خالد (RUH)", "الرياض", "2026-11-27T16:00", "2026-11-27T20:00"),
  ];
  data.transport_plan = {
    ...data.transport_plan,
    airport: { ...data.transport_plan.airport, car_type: "ميني فان" },
    tours: { ...data.transport_plan.tours, enabled: true, car_type: "ميني فان" },
    intercity: { ...data.transport_plan.intercity, enabled: true, modes: ["car", "flight"], mode: "car", hop_modes: { "كوالالمبور>لنكاوي": "flight" } },
  };
  data.cities = data.cities.map((c) => ({ ...c, tour_picks: withTours(c, c.tours ?? 0).map((p, i) => ({ ...p, title: `جولة ${c.city_name} ${i + 1}`, price: 300 })) }));
  data.services = { ...data.services, includes: ["الفنادق", "شريحة اتصال × 2"] };
  data.transport = deriveTransportRows(data.transport_plan, data.cities);
  return data;
}

describe("the pull from the offer", () => {
  const rows = planBookingsFromDraft(malaysia(), "شروط الشركة");
  const by = (ref: string) => rows.find((r) => r.origin_ref === ref);

  it("books each flight ticket once — out and back together, the domestic legs together", () => {
    const flights = rows.filter((r) => r.kind === "flight");
    expect(flights.map((r) => r.origin_ref)).toEqual(["flight:intl", "flight:dom"]);
    expect(Object.keys(by("flight:intl")!.detail)).toEqual(expect.arrayContaining(["الذهاب", "العودة"]));
    expect(Object.keys(by("flight:dom")!.detail)).toEqual(expect.arrayContaining(["رحلة 1", "رحلة 2"]));
    // the landing rides on the line, so the reception can follow it (drivers.ts)
    expect(by("flight:intl")!.detail["الذهاب"]).toBe("SV834 · RUH → KUL · 2026-11-20 01:00 · الوصول 2026-11-20 14:30");
  });

  it("times every transfer from the flight it meets, the day-of-move ones included", () => {
    const transfer = (title: string) => rows.find((r) => r.kind === "transport" && r.title === title)!;
    // met 45 minutes after SV834 lands; seen off 2 h before MH1431 (domestic), from Langkawi
    expect([transfer("المطار ← فندق كوالالمبور").start_date, transfer("المطار ← فندق كوالالمبور").detail["الوقت"]]).toEqual(["2026-11-20", "15:15"]);
    expect([transfer("فندق لنكاوي ← المطار").start_date, transfer("فندق لنكاوي ← المطار").detail["الوقت"]]).toEqual(["2026-11-27", "07:00"]);
    expect(transfer("فندق كوالالمبور ← المطار").detail["الوقت"]).toBe("08:00");
    expect(transfer("المطار ← فندق لنكاوي").detail["الوقت"]).toBe("11:50");
    expect(transfer("المطار ← فندق كوالالمبور").detail["نقطة الالتقاء"]).toContain("KUL");
  });

  it("pulls the tours on their days, the stays with their rooms, the SIM cards — and nothing twice", () => {
    const tours = rows.filter((r) => r.origin_ref.startsWith("tour:"));
    expect(tours).toHaveLength(3);
    expect(tours.every((t) => t.start_date)).toBe(true);
    expect(rows.filter((r) => r.kind === "hotel").map((r) => [r.title, r.city_name, r.detail["عدد الغرف"]])).toEqual([
      ["بولمان سيتي سنتر", "كوالالمبور", "2"],
      ["منتجع بيرجايا", "لنكاوي", "2"],
    ]);
    expect(by("sim")?.title).toBe("شريحة اتصال × 2");
    expect(new Set(rows.map((r) => r.origin_ref)).size).toBe(rows.length);
  });

  it("books a tour in its car and how many, at the price per car × the cars (الأمر 3)", () => {
    const data = malaysia();
    data.cities = data.cities.map((c, i) =>
      i === 0 ? { ...c, tour_picks: c.tour_picks!.map((p, k) => (k === 0 ? { ...p, car_type: "فان", cars: 2 } : p)) } : c,
    );
    const tours = planBookingsFromDraft(data, "شروط الشركة").filter((r) => r.origin_ref.startsWith("tour:كوالالمبور"));
    expect(tours.map((t) => [t.detail["السيارة"], t.quoted_net])).toEqual([
      ["فان × 2", 600],
      // a pick from before the count: the trip's tour car, once
      ["ميني فان", 300],
    ]);
  });
});

describe("a booking per stay — two hotels in one city (order 1)", () => {
  const hotelRows = (data: DraftData) =>
    planBookingsFromDraft(data, "شروط الشركة")
      .filter((r) => r.kind === "hotel")
      .map((r) => [r.title, r.start_date, r.end_date, r.detail["عدد الغرف"]]);

  it("books A then B in كوالالمبور, each on its own dates (acceptance أ)", () => {
    const data = malaysia();
    // بولمان three nights, then a second hotel for the fourth
    const three = data.hotels.map((h) => (h.hotel_name === "بولمان سيتي سنتر" ? { ...h, nights: 3 } : h));
    const added = addStay(data.cities, three, 0, "after");
    data.hotels = added.hotels.map((h) => (h.id === added.id ? { ...h, hotel_name: "تريدرز" } : h));
    expect(hotelRows(data)).toEqual([
      ["بولمان سيتي سنتر", "2026-11-20", "2026-11-23", "2"],
      ["تريدرز", "2026-11-23", "2026-11-24", "2"],
      ["منتجع بيرجايا", "2026-11-24", "2026-11-27", "2"],
    ]);
  });

  it("books two hotels on the same dates as two bookings, each with its own rooms (acceptance ب)", () => {
    const data = malaysia();
    const added = addStay(data.cities, data.hotels, 0, "same");
    data.hotels = added.hotels.map((h) => (h.id === added.id ? { ...h, hotel_name: "تريدرز" } : h));
    expect(hotelRows(data)).toEqual([
      ["بولمان سيتي سنتر", "2026-11-20", "2026-11-24", "2"],
      ["تريدرز", "2026-11-20", "2026-11-24", "1"],
      ["منتجع بيرجايا", "2026-11-24", "2026-11-27", "2"],
    ]);
    expect(new Set(planBookingsFromDraft(data, "").filter((r) => r.kind === "hotel").map((r) => r.origin_ref)).size).toBe(3);
  });
});
