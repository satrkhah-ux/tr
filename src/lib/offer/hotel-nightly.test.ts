import { describe, expect, it } from "vitest";
import {
  emptyDraftData,
  fromUnit,
  keepNightlyRates,
  perUnit,
  sheetStayUnits,
  stayTotal,
  withRooms,
  type DraftData,
} from "./draft-types";
import { addCity, priceAtSource } from "./basic";
import { suggestPricing, syncSuggestions } from "./pricing-suggest";
import { computeOfferPricing } from "./pricing";

/** Order 5's Malaysia file, anonymised: four stops, one double room each, whole-stay totals as saved. */
function malaysia(): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-11-11", nights: 10, days: 11, adults: 2 };
  data.flights = [];
  for (const [name, nights] of [["سيلانجور", 2], ["لنكاوي", 3], ["بينانج", 3], ["كوالالمبور", 2]] as const) {
    data = { ...data, ...addCity(data, { name, nights, tours: 0 }, "SAR") };
  }
  const totals = [320, 1000, 300, 685];
  data.hotels = keepNightlyRates(
    data.cities,
    data.hotels.map((h, i) => withRooms({ ...h, hotel_name: `فندق ${i + 1}` }, h.rooms.map((r) => ({ ...r, board_type: "BB", price: totals[i] })))),
  );
  return data;
}

const NO_LISTS = { transfers: [], services: [], rooms: [], fleet: [] };
/** The sheet as the pricing step opens it (calculate → syncSuggestions). */
const sheet = (data: DraftData) => syncSuggestions(data.pricing.items, suggestPricing(data, NO_LISTS, { hotel: "فندق", airline: "طيران" }));
const hotelItems = (data: DraftData) => sheet(data).filter((i) => i.item_type === "hotel");

describe("a hotel's price is typed a night (Order 5, item 4)", () => {
  it("opens an existing whole-stay total as its night — «× N ليالٍ» — and leaves the total as it was", () => {
    const data = malaysia();
    const items = hotelItems(data);
    expect(items.map((i) => [i.quantity, i.sell_price])).toEqual([[1, 320], [1, 1000], [1, 300], [1, 685]]);
    const shown = items.map((i) => {
      const u = sheetStayUnits(data, i)!;
      return [u.rooms, u.nights, perUnit(i.sell_price, u.rooms * u.nights)];
    });
    expect(shown).toEqual([[1, 2, 160], [1, 3, 333.33], [1, 3, 100], [1, 2, 342.5]]);
    // opening is not editing: the stored figure is untouched
    expect(keepNightlyRates(data.cities, data.hotels).map((h) => stayTotal(h))).toEqual([320, 1000, 300, 685]);
  });

  it("stores the night typed as the stay's total, counted once on the sheet and in the total", () => {
    const data = malaysia();
    const item = hotelItems(data)[1]; // لنكاوي, 3 nights
    const u = sheetStayUnits(data, item)!;
    const total = fromUnit(400, u.rooms * u.nights);
    expect(total).toBe(1200);
    // the editor's setItem: written back on the stay, then commit's nightly pass
    const hotels = keepNightlyRates(data.cities, priceAtSource(data, item, { price: total })!.hotels!);
    expect(hotels[1].rooms[0].price).toBe(1200);
    expect(hotels[1].priced_nights).toBe(3);
    const next = { ...data, hotels };
    const again = hotelItems(next)[1];
    // not 1200 × 3: the line is the stay, × 1
    expect([again.quantity, again.sell_price]).toEqual([1, 1200]);
    expect(perUnit(again.sell_price, u.rooms * u.nights)).toBe(400);
    const sum = computeOfferPricing(
      hotelItems(next).map((i) => ({ quantity: i.quantity, buy_price: i.buy_price, buy_currency: "SAR", sell_price: i.sell_price, sell_currency: "SAR" })),
      { SAR: 1 },
      "SAR",
    );
    expect(sum.total_sell).toBe(320 + 1200 + 300 + 685);
  });

  it("two rooms at one price: a room's night × the rooms × the nights", () => {
    const data = malaysia();
    data.hotels = data.hotels.map((h, i) => (i === 1 ? withRooms(h, [h.rooms[0], { ...h.rooms[0] }]) : h));
    const item = hotelItems(data)[1];
    expect(item.sell_price).toBe(2000);
    const u = sheetStayUnits(data, item)!;
    expect(u).toEqual({ rooms: 2, nights: 3 });
    expect(perUnit(item.sell_price, 6)).toBe(333.33);
    // 250 a room a night → 1500, each room 750 (250 a night on the hotel card)
    const hotels = priceAtSource(data, item, { price: fromUnit(250, 6) })!.hotels!;
    expect(hotels[1].rooms.map((r) => [r.price, perUnit(r.price, 3)])).toEqual([[750, 250], [750, 250]]);
  });

  it("rooms at different prices are one night of them all, never an average room", () => {
    const data = malaysia();
    data.hotels = data.hotels.map((h, i) => (i === 1 ? withRooms(h, [{ ...h.rooms[0], price: 300 }, { ...h.rooms[0], price: 900 }]) : h));
    const item = hotelItems(data)[1];
    expect(sheetStayUnits(data, item)).toEqual({ rooms: 1, nights: 3 });
    expect(perUnit(item.sell_price, 3)).toBe(400);
  });

  it("leaves every other line as it was", () => {
    const data = malaysia();
    expect(sheetStayUnits(data, { item_type: "flight", ref: "flight:intl", quantity: 1 })).toBeNull();
    expect(sheetStayUnits(data, { item_type: "hotel", ref: "no-such-stay", quantity: 1 })).toBeNull();
  });
});
