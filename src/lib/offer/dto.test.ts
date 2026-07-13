import { describe, it, expect } from "vitest";
import { computeOfferPricing } from "./pricing";
import { toClientOfferDTO, type ClientOfferDTO, type InternalOfferDTO } from "./dto";

const pricing = computeOfferPricing(
  [{ item_type: "hotel", quantity: 1, buy_price: 100, buy_currency: "SAR", sell_price: 150, sell_currency: "SAR" }],
  { SAR: 1 },
  "SAR",
);

const internal: InternalOfferDTO = {
  serial: "AD-1-1000-20260601",
  destination: "ماليزيا",
  customer_name: "نايف الجهني",
  customer_phone: "0555123456",
  employee_name: "الإدارة",
  arrival_date: "2026-06-01",
  departure_date: "2026-06-06",
  duration: "5 ليالٍ",
  offer_date: "2026-06-01",
  issue_date: "2026-05-20",
  validity_date: "2026-05-27",
  adults: 2,
  children: 0,
  infants: 0,
  total: 1500,
  currency: "SAR",
  hotels: [
    {
      city_name: "كوالالمبور",
      hotel_name: "فندق",
      stars: 5,
      room_type: "ديلوكس",
      board_type: "BB",
      rooms_count: 1,
      nights: 5,
      check_in: "2026-06-01",
      check_out: "2026-06-06",
      sell_price: 150,
      sell_currency: "SAR",
      buy_price: 100,
      buy_currency: "SAR",
      // client-safe
      cancellation_policy: "إلغاء مجاني حتى 48 ساعة قبل الوصول",
      excluded_surcharges: [{ name: "رسوم المنتجع", amount: 20, currency: "USD" }],
      valid_until: "2026-07-20",
      image_url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      facilities: ["pool", "wifi"],
      // INTERNAL supplier sourcing (must be stripped for the client)
      supplier_id: "tbo",
      supplier_name: "TBO Holidays",
      rate_key: "RK-SECRET-9",
      net_base: 412.5,
      net_source_currency: "USD",
      fx_rate: 3.75,
      fx_date: "2026-07-01",
      ref_sell_base: 480,
      markup_amount: 82.5,
      markup_pct: 20,
    },
  ],
  flights: [
    {
      airline: "SV",
      flight_no: "SV123",
      from_airport: "RUH",
      to_airport: "KUL",
      departure_at: null,
      arrival_at: null,
      cabin_class: "Y",
      baggage_allowance: "30kg",
      leg_order: "outbound",
      sell_price: 900,
      sell_currency: "SAR",
      buy_price: 800,
      buy_currency: "SAR",
    },
  ],
  transport: [],
  visas: [],
  includes: ["الفنادق"],
  excludes: [],
  terms: ["قابل للتعديل"],
  climate: [],
  pricing,
};

describe("toClientOfferDTO", () => {
  it("deep-strips every internal pricing + supplier-sourcing field at runtime", () => {
    const client = toClientOfferDTO(internal);
    const json = JSON.stringify(client);
    for (const forbidden of [
      // cost / profit / margin
      "buy_price", "buy_currency", "total_buy", "base_buy", "profit", "margin_pct",
      // supplier identity + net + fx + floor + markup (prompt requirement #4)
      "supplier_id", "supplier_name", "rate_key", "net_base", "net_source_currency",
      "fx_rate", "fx_date", "ref_sell_base", "markup_amount", "markup_pct",
    ]) {
      expect(json).not.toContain(forbidden);
    }
    // the actual secret VALUES must also be gone (not just the key names)
    expect(json).not.toContain("TBO Holidays");
    expect(json).not.toContain("RK-SECRET-9");
    expect(json).not.toContain("412.5"); // the net

    // client-safe fields survive
    expect(json).toContain("sell_price");
    expect(json).toContain("total_sell");
    expect(client.destination).toBe("ماليزيا");
    expect(client.hotels[0]?.room_type).toBe("ديلوكس");
    // the client DOES see cancellation policy + excluded-at-hotel surcharges
    expect(client.hotels[0]?.cancellation_policy).toContain("إلغاء مجاني");
    expect(client.hotels[0]?.excluded_surcharges).toEqual([{ name: "رسوم المنتجع", amount: 20, currency: "USD" }]);
    expect(client.hotels[0]?.valid_until).toBe("2026-07-20");
    // the client also sees the hotel image + facilities (content, not cost)
    expect(client.hotels[0]?.image_url).toContain("data:image");
    expect(client.hotels[0]?.facilities).toEqual(["pool", "wifi"]);
  });

  it("type-level proof: the client type cannot carry internal pricing keys", () => {
    // Each alias is `true` ONLY because the key is absent; if it leaked the
    // alias would be `never` and `const … : never = true` would fail to compile.
    type NoBuyOnHotel = ClientOfferDTO["hotels"][number] extends { buy_price: unknown } ? never : true;
    type NoProfit = ClientOfferDTO["pricing"] extends { profit: unknown } ? never : true;
    type NoMargin = ClientOfferDTO["pricing"] extends { margin_pct: unknown } ? never : true;
    const p1: NoBuyOnHotel = true;
    const p2: NoProfit = true;
    const p3: NoMargin = true;
    expect([p1, p2, p3]).toEqual([true, true, true]);
  });
});
