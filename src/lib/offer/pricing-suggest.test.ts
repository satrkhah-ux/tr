import { describe, expect, it } from "vitest";
import { emptyDraftData, normalizeDraftHotel, type DraftData } from "./draft-types";
import {
  findRoomPrice,
  findServicePrice,
  findTransferPrice,
  mergeSuggestions,
  normalizeName,
  suggestPricing,
  type PricingReference,
} from "./pricing-suggest";

/**
 * The pricing sheet is built from the agency's own lists, and a bad match is
 * not a cosmetic bug — it is a wrong number on a quote a client accepts. These
 * pin the three ways the matching can lie: finding nothing when the answer is
 * there, finding the wrong vehicle, and overwriting a price a human set.
 */

const LABELS = { hotel: "فندق", airline: "الناقل" };
const EMPTY: PricingReference = { transfers: [], services: [], rooms: [] };

describe("normalizeName", () => {
  it("reads the spellings the two systems actually use as the same place", () => {
    expect(normalizeName("إسطنبول")).toBe(normalizeName("اسطنبول"));
    expect(normalizeName("عُمان")).toBe(normalizeName("عمان"));
    expect(normalizeName("  السعودية ")).toBe(normalizeName("السعوديه"));
  });
});

describe("findTransferPrice", () => {
  const list = [
    { from_city: "المطار", to_city: "إسطنبول", car_type: "سيارة صغيرة", price: 120, currency: "USD" },
    { from_city: "المطار", to_city: "إسطنبول", car_type: "باص 40 مقعد", price: 400, currency: "USD" },
    { from_city: "المطار", to_city: "اسطنبول", car_type: "سيارة صغيرة", price: 90, currency: "USD" },
  ];

  it("matches the route in BOTH directions — the way back is the same road", () => {
    const hit = findTransferPrice(list, "اسطنبول", "المطار", "سيارة صغيرة");
    expect(hit?.price).toBe(90);
  });

  it("refuses to price a bus at a car's rate", () => {
    // The dangerous near-miss: the route matches, the vehicle does not. A
    // guess here is 90 USD on a coach.
    expect(findTransferPrice(list, "المطار", "إسطنبول", "ميني فان")).toBeNull();
  });

  it("ignores the «× 2» the count appends — the list price is per vehicle", () => {
    expect(findTransferPrice(list, "المطار", "إسطنبول", "باص 40 مقعد × 3")?.price).toBe(400);
  });

  it("with no vehicle chosen, offers the cheapest on that road as a floor", () => {
    expect(findTransferPrice(list, "المطار", "إسطنبول", null)?.price).toBe(90);
  });

  it("says nothing rather than something, for a road it does not know", () => {
    expect(findTransferPrice(list, "المطار", "طرابزون", "سيارة صغيرة")).toBeNull();
  });
});

describe("findServicePrice and findRoomPrice", () => {
  it("finds a service by either name it is filed under", () => {
    const list = [
      { service_type: "استقبال بالورد", arabic_name: "استقبال بالورد", buy_price: 100, buy_currency: "SAR", sell_price: 200, sell_currency: "SAR" },
    ];
    expect(findServicePrice(list, "استقبال بالورد")?.sell_price).toBe(200);
    expect(findServicePrice(list, "شيء آخر")).toBeNull();
  });

  it("prefers the same board, but a room's own price beats nothing", () => {
    const rooms = [
      { hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "BB", price: 500, currency: "SAR" },
      { hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "HB", price: 650, currency: "SAR" },
    ];
    expect(findRoomPrice(rooms, "h1", "", "استاندر", "HB")?.price).toBe(650);
    expect(findRoomPrice(rooms, "h1", "", "استاندر", "FB")?.price).toBe(500);
    expect(findRoomPrice(rooms, "h1", "", "جناح", "BB")).toBeNull();
  });

  it("falls back to the hotel NAME when the line carries no id", () => {
    const rooms = [{ hotel_id: null, hotel_name: "فندق آيوتا", room_type_name: "استاندر", board_type: null, price: 300, currency: "SAR" }];
    expect(findRoomPrice(rooms, null, "فندق آيوتا", "استاندر", null)?.price).toBe(300);
  });
});

function draftWithOneStay(over: Partial<DraftData["hotels"][number]> = {}): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "تركيا", arrival_date: "2026-09-10", days: 4, nights: 3, adults: 2, children: 1 };
  data.cities = [{ city_name: "إسطنبول", nights: 3, check_in: "2026-09-10", check_out: "2026-09-13" }];
  data.hotels = [
    normalizeDraftHotel({
      city_name: "إسطنبول",
      hotel_name: "فندق آيوتا",
      hotel_id: "h1",
      rooms_count: 2,
      room_type_name: "استاندر",
      board_type: "BB",
      ...over,
    }),
  ];
  return data;
}

describe("suggestPricing — the order of trust", () => {
  it("takes what the agent typed over what the room last cost", () => {
    const data = draftWithOneStay({ manual_price: 777, manual_currency: "SAR" });
    const rooms = [{ hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "BB", price: 500, currency: "SAR" }];
    const [hotel] = suggestPricing(data, { ...EMPTY, rooms }, LABELS);
    expect(hotel.sell_price).toBe(777);
    expect(hotel.source).toBe("typed");
  });

  it("falls back to the remembered price when nothing was typed", () => {
    const rooms = [{ hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "BB", price: 500, currency: "SAR" }];
    const [hotel] = suggestPricing(draftWithOneStay(), { ...EMPTY, rooms }, LABELS);
    expect(hotel.sell_price).toBe(500);
    expect(hotel.source).toBe("remembered");
  });

  it("leaves the line unpriced, and says so, when nothing knows the answer", () => {
    const [hotel] = suggestPricing(draftWithOneStay(), EMPTY, LABELS);
    expect(hotel.sell_price).toBeNull();
    expect(hotel.source).toBe("none");
  });

  it("counts rooms for a hotel and travellers for a fare", () => {
    const data = draftWithOneStay({ manual_price: 100 });
    data.flights = [
      {
        airline: "الخطوط التركية", airline_iata: "TK", flight_no: "123", from_airport: "", to_airport: "",
        departure_at: null, arrival_at: null, from_tz: null, to_tz: null, date_user_set: false,
        cabin_class: "", baggage_allowance: "", baggage_kg: null, baggage_pieces: null,
        cabin_baggage_kg: null, leg_order: "outbound",
      },
    ];
    const items = suggestPricing(data, EMPTY, LABELS);
    expect(items.find((i) => i.item_type === "hotel")?.quantity).toBe(2); // rooms
    expect(items.find((i) => i.item_type === "flight")?.quantity).toBe(3); // 2 adults + 1 child
  });
});

describe("mergeSuggestions", () => {
  it("adds what is missing and never touches a price already negotiated", () => {
    const existing = [
      { item_type: "hotel" as const, description: "إسطنبول — فندق آيوتا", ref: "r1", quantity: 2, buy_price: null, buy_currency: "SAR", sell_price: 999, sell_currency: "SAR" },
    ];
    const suggested = suggestPricing(draftWithOneStay({ manual_price: 100 }), EMPTY, LABELS).map((s) => ({
      ...s,
      ref: "r1",
    }));
    const merged = mergeSuggestions(existing, suggested);
    expect(merged.added).toBe(0);
    expect(merged.items[0].sell_price).toBe(999);
  });

  it("reports how many of the new lines actually arrived with a number", () => {
    const rooms = [{ hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "BB", price: 500, currency: "SAR" }];
    const merged = mergeSuggestions([], suggestPricing(draftWithOneStay(), { ...EMPTY, rooms }, LABELS));
    expect(merged.added).toBe(1);
    expect(merged.priced).toBe(1);
    // the `source` marker is a UI concern and must not reach the draft
    expect("source" in merged.items[0]).toBe(false);
  });
});
