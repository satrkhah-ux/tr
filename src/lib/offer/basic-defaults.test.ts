import { describe, expect, it } from "vitest";
import { carForGroup, resizeGroupCars, usualRoom } from "./basic";
import { emptyDraftData } from "./draft-types";
import { pricesForCity } from "./pricing-suggest";
import { normAr } from "@/lib/catalog/norm";

describe("Basic defaults (the owner's review, 2026-10-18)", () => {
  it("names the room a group usually takes", () => {
    expect(usualRoom({ adults: 2, children: 0, rooms: 1 }).room_type_name).toBe("غرفة مزدوجة");
    expect(usualRoom({ adults: 1, children: 0, rooms: 1 }).room_type_name).toBe("غرفة مفردة");
    expect(usualRoom({ adults: 2, children: 1, rooms: 1 }).room_type_name).toBe("غرفة ثلاثية");
    expect(usualRoom({ adults: 4, children: 0, rooms: 2 }).room_type_name).toBe("غرفة مزدوجة");
    expect(usualRoom({ adults: 6, children: 0, rooms: 1 }).room_type_name).toBe("غرفة عائلية");
  });

  it("lists a city's own tours, not the other city's", () => {
    const list = [
      { name: "جولة البسفور", price: 260, currency: "SAR", city: "اسطنبول" },
      { name: "جولة في طرابزون والمول", price: 110, currency: "SAR" },
      { name: "جولة مرتفعات أوزنجول", price: 100, currency: "SAR", city: "طرابزون" },
      { name: "يوم في المول", price: 90, currency: "SAR" },
    ];
    const file = ["إسطنبول", "طرابزون"];
    expect(pricesForCity(list, "إسطنبول", file, normAr).map((t) => t.price)).toEqual([260, 90]);
    expect(pricesForCity(list, "طرابزون", file, normAr).map((t) => t.price)).toEqual([110, 100, 90]);
  });

  it("seats the group in a car the country prices, and moves the cars it chose before the country was known", () => {
    const fleet = [
      { name: "سيارة صغيرة", pax: 2 },
      { name: "سيارة متوسطة", pax: 4 },
      { name: "فيتو", pax: 8 },
      { name: "فان مرسيدس", pax: 8 },
    ];
    const turkey = fleet.filter((c) => ["فيتو", "فان مرسيدس"].includes(c.name));
    expect(carForGroup(fleet, 2)?.car_type).toBe("سيارة صغيرة");
    expect(carForGroup(turkey, 2)?.car_type).toBe("فيتو");
    const plan = emptyDraftData().transport_plan;
    const auto = { ...plan, airport: { ...plan.airport, car_type: "سيارة صغيرة", cars: 1 }, tours: { ...plan.tours, car_type: "سيارة متوسطة", cars: 1 } };
    const moved = resizeGroupCars(auto, carForGroup(fleet, 2), carForGroup(turkey, 2));
    expect(moved.airport.car_type).toBe("فيتو");
    // the agent's own choice stays
    expect(moved.tours.car_type).toBe("سيارة متوسطة");
  });
});
