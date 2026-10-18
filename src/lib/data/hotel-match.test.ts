import { describe, expect, it } from "vitest";
import { pickCatalogHotel } from "./hotel-match";
import { HOTEL_ID_KEY } from "@/lib/operations/voucher-dto";

// two hotels of one name in two cities, as the catalogue holds them (owner's order B7)
const rows = [
  { id: "h-kl", arabic_name: "هيلتون", city_id: "kl" },
  { id: "h-dxb", arabic_name: "هيلتون", city_id: "dxb" },
  { id: "h-one", arabic_name: "فندق اريادوتا بالي", city_id: "dps" },
];
const cities: Record<string, string> = { kl: "كوالا لمبور", dxb: "دبي", dps: "بالي" };
const cityName = (id: string | null) => (id ? (cities[id] ?? "") : "");

describe("the /hotels row a booking is", () => {
  it("is its own catalogue hotel first, whatever its title says", () => {
    expect(pickCatalogHotel(rows, { title: "Hilton", city_name: "", detail: { [HOTEL_ID_KEY]: "h-dxb" } }, cityName)?.id).toBe("h-dxb");
  });

  it("by name, the one in the booking's city — spaces and hamza aside — never the namesake elsewhere", () => {
    expect(pickCatalogHotel(rows, { title: "هيلتون", city_name: "كوالالمبور" }, cityName)?.id).toBe("h-kl");
    expect(pickCatalogHotel(rows, { title: "هيلتون", city_name: "", detail: { المدينة: "دبي" } }, cityName)?.id).toBe("h-dxb");
    expect(pickCatalogHotel(rows, { title: "هيلتون", city_name: "باريس" }, cityName)).toBeNull();
    // two of that name and no city to choose by: none, rather than the wrong address
    expect(pickCatalogHotel(rows, { title: "هيلتون", city_name: "" }, cityName)).toBeNull();
  });

  it("a name only one hotel carries is that hotel — unless the booking's city says another", () => {
    expect(pickCatalogHotel(rows, { title: "فندق اريادوتا بالي", city_name: "" }, cityName)?.id).toBe("h-one");
    expect(pickCatalogHotel(rows, { title: "فندق اريادوتا بالي", city_name: "بالي" }, cityName)?.id).toBe("h-one");
    expect(pickCatalogHotel(rows, { title: "فندق اريادوتا بالي", city_name: "جاكرتا" }, cityName)).toBeNull();
  });
});
