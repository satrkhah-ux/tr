import { describe, expect, it } from "vitest";
import { emptyDraftData, hopKey, normalizeDraftData, type DraftData } from "./draft-types";
import { cityPoints, greatCircleKm, implausibleOverlandHops } from "./overland";

// the catalogue's own coordinates (cities.lat / lng)
const points = cityPoints([
  {
    id: "id",
    name: "اندونيسيا",
    iso2: "ID",
    timezone: null,
    cities: [
      { id: "1", name: "بونشاك", hotels: [], lat: -7.4487, lng: 107.126 },
      { id: "2", name: "بالي", hotels: [], lat: -8.33333, lng: 115 },
      { id: "3", name: "جاكرتا", hotels: [], lat: -6.21462, lng: 106.84513 },
      { id: "4", name: "باندونج", hotels: [], lat: -6.9175, lng: 107.6191 },
    ],
  },
]);

function trip(names: string[]): DraftData {
  const data = emptyDraftData();
  data.scope = { ...data.scope, transport: true };
  data.cities = names.map((city_name) => ({ city_name, nights: 3, check_in: null, check_out: null }));
  data.transport_plan = {
    ...data.transport_plan,
    intercity: { ...data.transport_plan.intercity, enabled: true, mode: "car", car_type: "سيارة صغيرة" },
  };
  return data;
}

describe("implausibleOverlandHops — a road hop nobody would drive", () => {
  it("measures the great circle (Jakarta → the catalogue's Bali ≈ 930 km)", () => {
    expect(Math.round(greatCircleKm(points.get("جاكرتا")!, points.get("بالي")!) / 10) * 10).toBe(930);
  });

  it("flags Puncak → Bali by car: across the sea and far past a day's drive", () => {
    const [hop] = implausibleOverlandHops(trip(["بونشاك", "بالي"]), points);
    expect(hop).toMatchObject({ from: "بونشاك", to: "بالي", sea: true });
    expect(hop.km).toBeGreaterThan(1000);
  });

  it("is quiet on a sane road hop (Jakarta → Bandung)", () => {
    expect(implausibleOverlandHops(trip(["جاكرتا", "باندونج"]), points)).toEqual([]);
  });

  it("is quiet once the hop is flown — by its mode or by a domestic flight landing there", () => {
    const flown = trip(["بونشاك", "بالي"]);
    flown.transport_plan.intercity = { ...flown.transport_plan.intercity, modes: ["car", "flight"], hop_modes: { [hopKey("بونشاك", "بالي")]: "flight" } };
    expect(implausibleOverlandHops(flown, points)).toEqual([]);

    const ticketed = trip(["بونشاك", "بالي"]);
    ticketed.flights = normalizeDraftData({ flights: [{ leg_order: "internal", from_city: "جاكرتا", to_city: "بالي" }] }).flights;
    expect(implausibleOverlandHops(ticketed, points)).toEqual([]);
  });

  it("says nothing when the intercity move is not ours to arrange", () => {
    const off = trip(["بونشاك", "بالي"]);
    off.scope = { ...off.scope, transport: false };
    expect(implausibleOverlandHops(off, points)).toEqual([]);
  });

  it("still flags an island hop when a coordinate is missing", () => {
    const [hop] = implausibleOverlandHops(trip(["سورابايا", "بالي"]), points);
    expect(hop).toMatchObject({ km: null, sea: true });
  });
});
