import { describe, expect, it } from "vitest";
import { usualRoom } from "./basic";
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
});
