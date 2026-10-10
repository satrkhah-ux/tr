import { describe, expect, it } from "vitest";
import { deriveTransportRows, emptyTransportPlan, type TransportPlan } from "./draft-types";
import { transportNoteForDay } from "./itinerary";
import type { DraftDay } from "./draft-types";

/**
 * «المواصلات» is answered once, about vehicles, and read twice: as rows on the
 * document and as a line on each day of the programme. These check that the two
 * readings say the same thing — and that they say the RIGHT thing on the day the
 * group changes city, which is the case a single «نوع السيارة» could not express.
 */

const cities = [
  { city_name: "إسطنبول", check_in: "2026-09-01" },
  { city_name: "طرابزون", check_in: "2026-09-04" },
];

const plan = (over: Partial<TransportPlan> = {}): TransportPlan => ({ ...emptyTransportPlan(), ...over });

const day = (n: number, city: string): DraftDay => ({
  day_number: n,
  date: null,
  city_name: city,
  title: "",
  activities: [],
  weather: null,
  ai_generated: false,
});

describe("deriveTransportRows", () => {
  it("gives the airport its own vehicle in both directions", () => {
    const rows = deriveTransportRows(
      plan({ airport: { enabled: true, car_type: "جي إم سي ٧ ركاب", cars: 1, note: "" }, tours: { enabled: false, car_type: "", cars: 1, note: "" } }),
      cities,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].to_place).toBe("فندق إسطنبول");
    expect(rows[1].to_place).toBe("المطار");
    expect(rows.every((r) => r.car_type === "جي إم سي ٧ ركاب")).toBe(true);
  });

  it("lets tours use a different, smaller car", () => {
    // The whole point: heavy luggage at the airport, a sedan for the day tours.
    const rows = deriveTransportRows(
      plan({
        airport: { enabled: true, car_type: "فان", cars: 1, note: "" },
        tours: { enabled: true, car_type: "سيدان", cars: 1, note: "" },
      }),
      cities,
    );
    expect(rows.find((r) => r.from_place === "الجولات السياحية")?.car_type).toBe("سيدان");
    expect(rows.find((r) => r.from_place === "المطار")?.car_type).toBe("فان");
  });

  it("makes one row per city HOP, not one for the whole trip", () => {
    const rows = deriveTransportRows(
      plan({
        airport: { enabled: false, car_type: "", cars: 1, note: "" },
        tours: { enabled: false, car_type: "", cars: 1, note: "" },
        intercity: { enabled: true, mode: "train", car_type: "", cars: 1, note: "" },
      }),
      cities,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_place: "إسطنبول", to_place: "طرابزون", car_type: "قطار" });
  });

  it("says nothing at all when the whole subject is off", () => {
    expect(
      deriveTransportRows(
        plan({
          airport: { enabled: false, car_type: "", cars: 1, note: "" },
          tours: { enabled: false, car_type: "", cars: 1, note: "" },
        }),
        cities,
      ),
    ).toEqual([]);
  });
});

describe("transportNoteForDay", () => {
  const days = [day(1, "إسطنبول"), day(2, "إسطنبول"), day(3, "طرابزون"), day(4, "طرابزون")];
  const full = plan({
    airport: { enabled: true, car_type: "فان", cars: 1, note: "" },
    tours: { enabled: true, car_type: "سيدان", cars: 1, note: "" },
    intercity: { enabled: true, mode: "flight", car_type: "", cars: 1, note: "" },
  });

  it("meets the client at the airport on day one", () => {
    expect(transportNoteForDay(full, days, 0)).toContain("استقبال من المطار");
  });

  it("sends them back on the last day", () => {
    expect(transportNoteForDay(full, days, 3)).toContain("توديع");
  });

  it("names the tour car on a touring day", () => {
    expect(transportNoteForDay(full, days, 1)).toBe("سيارة الجولات — سيدان");
  });

  it("on a moving day says the move, not the tour", () => {
    // A day the group changes city is a travel day. Printing both would put two
    // vehicles on one line and invite the client to ask which is which.
    const note = transportNoteForDay(full, days, 2);
    expect(note).toBe("الانتقال إلى طرابزون — طيران داخلي");
    expect(note).not.toContain("الجولات");
  });

  it("is silent when there is nothing to say", () => {
    expect(transportNoteForDay(emptyTransportPlan(), [day(1, "إسطنبول")], 5)).toBeNull();
  });
});

describe("the car count", () => {
  /**
   * Nine travellers are two vans. «فان» on its own both priced and promised
   * one, and the second was argued about at the kerb — so the count rides
   * inside the vehicle text, which every reader already prints.
   */
  const twoVans = plan({
    airport: { enabled: true, car_type: "فان", cars: 2, note: "" },
    tours: { enabled: false, car_type: "", cars: 1, note: "" },
  });

  it("reaches both airport rows", () => {
    const rows = deriveTransportRows(twoVans, cities);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.car_type === "فان × 2")).toBe(true);
  });

  it("reaches the day note too, so the two readings agree", () => {
    expect(transportNoteForDay(twoVans, [day(1, "إسطنبول")], 0)).toBe(
      "استقبال من المطار إلى الفندق — فان × 2",
    );
  });

  it("says nothing extra for a single vehicle", () => {
    const one = plan({ airport: { enabled: true, car_type: "فان", cars: 1, note: "" } });
    expect(deriveTransportRows(one, cities)[0].car_type).toBe("فان");
  });
});
