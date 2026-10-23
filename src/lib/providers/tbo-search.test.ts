import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHotelSupplier, tboPaxRooms, tboStars } from "./hotel-supplier";

/**
 * Search, against the shapes in TBOH Hotel API Specifications v2.1: Search
 * answers with hotel CODES only — the names and stars live on TBOHotelCodeList.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const OK = { Code: 200, Description: "Success" };

function stub() {
  const bodies: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = String(url).split("/").pop() ?? "";
      bodies[method] = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (method === "CityList") return json({ Status: OK, CityList: [{ Code: "115936", Name: "Dubai" }, { Code: "1", Name: "Abu Dhabi" }] });
      if (method === "TBOHotelCodeList")
        return json({
          Status: OK,
          Hotels: [
            { HotelCode: "11", HotelName: "Grand Plaza Dubai", HotelRating: "FourStar" },
            { HotelCode: "12", HotelName: "Sea View Hotel", HotelRating: "ThreeStar" },
          ],
        });
      return json({
        Status: OK,
        HotelResult: [{ HotelCode: "11", Currency: "USD", Rooms: [{ Name: ["Deluxe Room"], BookingCode: "11!TB!1", TotalFare: 240.5, MealType: "Breakfast_For_2", IsRefundable: true }] }],
      });
    }),
  );
  return bodies;
}

const tbo = () => buildHotelSupplier("tbo", { base_url: "", username: "u", password: "p" }, null, "live");
const QUERY = { city: "Dubai", country_code: "AE", check_in: "2026-12-01", check_out: "2026-12-03", adults: 2, children: 1, children_ages: [5], rooms: 1 };

describe("tbo search", () => {
  it("names and stars come from the code list", async () => {
    stub();
    const [hotel] = await tbo().searchHotels(QUERY);
    expect(hotel.name_ar).toBe("Grand Plaza Dubai");
    expect(hotel.star_rating).toBe(4);
    expect(hotel.rates[0].hotel_name).toBe("Grand Plaza Dubai");
  });

  it("a hotel name narrows the codes sent, and no unknown filter is sent", async () => {
    const bodies = stub();
    await tbo().searchHotels({ ...QUERY, hotel_name: "sea view" });
    const sent = bodies.search as { HotelCodes: string; Filters: Record<string, unknown>; PaxRooms: unknown };
    expect(sent.HotelCodes).toBe("12");
    expect(Object.keys(sent.Filters).sort()).toEqual(["MealType", "NoOfRooms", "Refundable"]);
    expect(sent.PaxRooms).toEqual([{ Adults: 2, Children: 1, ChildrenAges: [5] }]);
  });

  it("lists the country's cities", async () => {
    stub();
    expect(await tbo().listCities?.("ae")).toEqual([{ code: "115936", name: "Dubai" }, { code: "1", name: "Abu Dhabi" }]);
  });
});

describe("helpers", () => {
  it("reads every star spelling", () => {
    expect([tboStars("FiveStar"), tboStars(3), tboStars("2"), tboStars("All"), tboStars(null)]).toEqual([5, 3, 2, null, null]);
  });

  it("shares the whole party out room by room, each child with its own age", () => {
    // the draft's totals: 4 adults and 2 children (2 and 6) in two rooms — not 8 adults and 4 children
    expect(tboPaxRooms({ rooms: 2, adults: 4, children: 2, children_ages: [2, 6] })).toEqual([
      { Adults: 2, Children: 1, ChildrenAges: [2] },
      { Adults: 2, Children: 1, ChildrenAges: [6] },
    ]);
    expect(tboPaxRooms({ rooms: 2, adults: 5, children: 1, children_ages: [] })).toEqual([
      { Adults: 3, Children: 1, ChildrenAges: [8] },
      { Adults: 2, Children: 0, ChildrenAges: [] },
    ]);
    expect(tboPaxRooms({ rooms: 1, adults: 1, children: 0 })).toEqual([{ Adults: 1, Children: 0, ChildrenAges: [] }]);
  });
});
