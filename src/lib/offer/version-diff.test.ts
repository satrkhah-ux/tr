import { describe, expect, it } from "vitest";
import { offerChanges } from "./version-diff";

type Doc = Parameters<typeof offerChanges>[0];
type Hotel = Doc["hotels"][number];

const hotel = (city: string, name: string | null, over: Partial<Hotel> = {}): Hotel =>
  ({
    city_name: city,
    hotel_name: name,
    stars: null,
    room_type: "أجنحة رويال أوشن",
    board_type: "BB",
    rooms_count: 1,
    nights: 3,
    check_in: "2026-10-31",
    check_out: "2026-11-03",
    sell_price: null,
    sell_currency: null,
    cancellation_policy: null,
    excluded_surcharges: [],
    valid_until: null,
    image_url: null,
    facilities: [],
    ...over,
  }) as Hotel;

// AD-4-8573-20261015 as issued: Puncak 3 nights, Bali 4, no hotel named — and
// so no city either (the document resolves a stay's city from its hotel)
const v1: Doc = {
  hotels: [
    hotel("بونشاك", null, { city_name: null }),
    hotel("بالي", null, { city_name: null, nights: 4, check_in: "2026-11-03", check_out: "2026-11-07" }),
  ],
  flights: [],
  arrival_date: "2026-10-31",
  departure_date: "2026-11-07",
  adults: 2,
  children: 0,
  infants: 0,
  total: 3995.82,
  currency: "SAR",
};

describe("offerChanges — «ما تغيّر» between two published versions", () => {
  it("is empty when nothing changed", () => {
    expect(offerChanges(v1, v1)).toEqual([]);
  });

  it("names each city's hotel going from «—» to the one chosen, and the new price", () => {
    const v2: Doc = {
      ...v1,
      hotels: [hotel("بونشاك", "فندق بونشاك ريزورت"), { ...v1.hotels[1], city_name: "بالي", hotel_name: "فندق بالي" }],
      total: 5200,
    };
    expect(offerChanges(v1, v2)).toEqual([
      { kind: "hotel", where: "بونشاك", before: "—", after: "فندق بونشاك ريزورت" },
      { kind: "hotel", where: "بالي", before: "—", after: "فندق بالي" },
      { kind: "price", where: null, before: "3,995.82 SAR", after: "5,200 SAR" },
    ]);
  });

  it("says the rooms, the board, the dates and the travellers that moved", () => {
    const v2: Doc = {
      ...v1,
      hotels: [hotel("بونشاك", null, { rooms_count: 2, board_type: "HB" }), v1.hotels[1]],
      arrival_date: "2026-11-01",
      adults: 3,
    };
    const kinds = offerChanges(v1, v2).map((c) => `${c.kind}:${c.before}→${c.after}`);
    expect(kinds).toEqual(["board:BB→HB", "rooms:1→2", "dates:2026-10-31 → 2026-11-07→2026-11-01 → 2026-11-07", "travellers:2 + 0 + 0→3 + 0 + 0"]);
  });

  it("says a stay added in the new version once — its hotel arriving from «—»", () => {
    const v2: Doc = { ...v1, hotels: [...v1.hotels, hotel("جاكرتا", "فندق جاكرتا", { check_in: "2026-11-07", check_out: "2026-11-08" })] };
    expect(offerChanges(v1, v2)).toEqual([{ kind: "hotel", where: "جاكرتا", before: "—", after: "فندق جاكرتا" }]);
  });
});
