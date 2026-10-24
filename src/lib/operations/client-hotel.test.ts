import { describe, expect, it } from "vitest";
import { emptyDraftData, normalizeDraftData, type ClientHotel, type DraftData, type DraftScope } from "@/lib/offer/draft-types";
import { addCity, setClientBooked, setClientHotel, withTours } from "@/lib/offer/basic";
import { CLIENT_HOTEL, planBookingsFromDraft } from "./seed-plan";
import { DRV } from "./drivers";
import { clientStays, hotelsMessage, programmeMessage, type ProgrammeInput } from "./driver-programme";

/**
 * Order 7 in operations: a hotel the client booked himself is never a booking of ours — no stay, no voucher —
 * but every drive and tour that goes there carries it, and the driver is told where it is.
 */

const HILTON: Partial<ClientHotel> = { name: "هيلتون كوالالمبور", address: "Jalan Stesen Sentral 3", phone: "+60 3 2264 2264", source: "app" };

/** KL 3 nights then Langkawi 2 by road, a tour in each, 10–15 Nov — as Basic builds it. */
function file(scope: Partial<DraftScope>): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-11-10", nights: 5, days: 6, adults: 2, meal_plan: "breakfast" };
  data.scope = { ...data.scope, flights_intl: false, flights_domestic: false, visas: false, transport: true, ...scope };
  data = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 3, tours: 1, hotel: { id: "h-kl", name: "بولمان" }, price: 900 }, "SAR") };
  data = { ...data, ...addCity(data, { name: "لنكاوي", nights: 2, tours: 1, hotel: { id: "h-lgk", name: "بيرجايا" }, price: 800 }, "SAR") };
  const car = { enabled: true, car_type: "فان", cars: 1, note: "" };
  data.transport_plan = { airport: car, tours: car, intercity: { ...car, mode: "car", modes: ["car"] } };
  data.cities = data.cities.map((c) => ({ ...c, tour_picks: withTours(c, c.tours ?? 0).map((p) => ({ ...p, title: `جولة ${c.city_name}`, price: 300 })) }));
  return data;
}
const settle = (data: DraftData) => normalizeDraftData(JSON.parse(JSON.stringify(data)));

describe("the pull, with the client's own hotel", () => {
  const data = settle({ ...file({ hotels: false }), cities: setClientHotel(file({ hotels: false }).cities, 0, HILTON) });
  const rows = planBookingsFromDraft(data, "شروط الشركة");

  it("books no hotel and asks no voucher — not the client's, not the line Basic left on the city", () => {
    expect(rows.filter((r) => r.kind === "hotel")).toEqual([]);
    expect(rows.some((r) => r.origin_ref.startsWith("stay:"))).toBe(false);
  });

  it("writes it on the reception it is the drop point of: name, who booked it, address and phone", () => {
    const reception = rows.find((r) => r.title === "الاستقبال من المطار إلى فندق هيلتون كوالالمبور (حجز العميل)")!;
    expect(reception.kind).toBe("transport");
    expect(reception.detail[CLIENT_HOTEL.name]).toBe("هيلتون كوالالمبور — محجوز من خارجنا (تطبيق)");
    expect(reception.detail[CLIENT_HOTEL.address]).toBe("Jalan Stesen Sentral 3");
    expect(reception.detail[CLIENT_HOTEL.phone]).toBe("+60 3 2264 2264");
    // met at the airport, as ever
    expect(reception.detail[DRV.meet]).toMatch(/^صالة القادمين/);
  });

  it("meets the group in its lobby when the car leaves from it — the road to Langkawi and the tours", () => {
    const road = rows.find((r) => r.title === "الانتقال من فندق هيلتون كوالالمبور (حجز العميل) إلى لنكاوي")!;
    expect(road.detail[DRV.meet]).toBe("بهو فندق هيلتون كوالالمبور (حجز العميل)");
    expect(road.detail[CLIENT_HOTEL.name]).toContain("هيلتون كوالالمبور");
    const tour = rows.find((r) => r.title === "جولة: جولة كوالالمبور")!;
    expect(tour.detail[DRV.meet]).toBe("بهو فندق هيلتون كوالالمبور (حجز العميل)");
    expect(tour.detail[CLIENT_HOTEL.name]).toBe("هيلتون كوالالمبور — محجوز من خارجنا (تطبيق)");
    // Langkawi's tour and farewell are not sent to Kuala Lumpur's hotel
    const elsewhere = rows.filter((r) => r.city_name.includes("لنكاوي"));
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(elsewhere.every((r) => !r.detail[CLIENT_HOTEL.name] && !(r.detail[DRV.meet] ?? "").includes("حجز العميل"))).toBe(true);
  });

  it("a file without it pulls exactly as before", () => {
    const plain = planBookingsFromDraft(settle(file({ hotels: true })), "شروط الشركة");
    expect(plain.filter((r) => r.kind === "hotel").map((r) => r.title)).toEqual(["بولمان", "بيرجايا"]);
    expect(JSON.stringify(plain)).not.toContain("حجز العميل");
    expect(plain.every((r) => !(CLIENT_HOTEL.name in r.detail))).toBe(true);
  });

  it("a mixed trip books our hotel only", () => {
    const ours = file({ hotels: true });
    const mixed = settle({ ...ours, ...setClientBooked(ours, 1, true) });
    const plan = planBookingsFromDraft(mixed, "شروط الشركة");
    expect(plan.filter((r) => r.kind === "hotel").map((r) => [r.title, r.city_name])).toEqual([["بولمان", "كوالالمبور"]]);
    const farewell = plan.find((r) => r.title === "التوصيل من فندق بيرجايا (حجز العميل) إلى المطار")!;
    expect(farewell.detail[DRV.meet]).toBe("بهو فندق بيرجايا (حجز العميل)");
    expect(farewell.detail[CLIENT_HOTEL.name]).toBe("بيرجايا — محجوز من خارجنا");
  });
});

describe("the driver's messages", () => {
  const trips: { city: string; detail: Record<string, string> }[] = [
    { city: "كوالالمبور", detail: { [CLIENT_HOTEL.name]: "هيلتون كوالالمبور — محجوز من خارجنا (تطبيق)", [CLIENT_HOTEL.address]: "https://maps.app.goo.gl/abc" } },
    { city: "كوالالمبور", detail: { [CLIENT_HOTEL.name]: "هيلتون كوالالمبور — محجوز من خارجنا (تطبيق)" } },
    { city: "لنكاوي", detail: {} },
  ];

  it("tell him where the client's hotel is — once per city, its link as the map", () => {
    const stays = clientStays(trips);
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ name: "هيلتون كوالالمبور", city: "كوالالمبور", address: "https://maps.app.goo.gl/abc", map: "https://maps.app.goo.gl/abc" });
    const { body } = hotelsMessage({ serial: "AD-1", stays });
    expect(body).toContain("🏨 هيلتون كوالالمبور — كوالالمبور");
    expect(body).toContain("الموقع / Map: https://maps.app.goo.gl/abc");
  });

  it("name it on the reception line", () => {
    const input: ProgrammeInput = {
      serial: "AD-1",
      from: "2026-11-10",
      to: "2026-11-15",
      customer: "عميل",
      travellers: 2,
      country: "ماليزيا",
      trips: [{ kind: "reception", title: "الاستقبال من المطار إلى فندق هيلتون كوالالمبور (حجز العميل)", city: "كوالالمبور", date: "2026-11-10", time: "15:15", flight: "", car: "فان" }],
      stays: clientStays(trips),
      legs: [],
      airports: {},
      emergency: "920000000",
    };
    expect(programmeMessage(input)).toContain("10/11 · 15:15 · استقبال من المطار ← هيلتون كوالالمبور");
  });
});
