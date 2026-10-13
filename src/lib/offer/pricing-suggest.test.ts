import { describe, expect, it } from "vitest";
import {
  deriveTransportRows,
  emptyDraftData,
  emptyTransportPlan,
  normalizeDraftHotel,
  withRooms,
  type DraftData,
  type DraftHotelSourcing,
  type DraftPricingItem,
} from "./draft-types";

/** A supplier quote prices the STAY; the rooms under it carry none. */
const SUPPLIER_RATE: DraftHotelSourcing = {
  supplier_id: "tbo", supplier_name: "TBO", rate_key: "k", net_base: 600,
  net_source_currency: "USD", fx_rate: 3.75, fx_date: "2026-09-01", ref_sell_base: null,
  sell_base: 900, markup_amount: 300, markup_pct: 50, margin_pct: 33,
  min_margin_pct: null, cancellation_policy: "", excluded_surcharges: [],
} as unknown as DraftHotelSourcing;
import {
  findAirportTransfer,
  findRoomPrice,
  findServicePrice,
  findTourPrice,
  findTransferPrice,
  mergeSuggestions,
  resolveAirportCity,
  syncSuggestions,
  normalizeName,
  suggestPricing,
  type PointTransfer,
  type PricingReference,
} from "./pricing-suggest";

/**
 * The pricing sheet is built from the agency's own lists, and a bad match is
 * not a cosmetic bug — it is a wrong number on a quote a client accepts. These
 * pin the three ways the matching can lie: finding nothing when the answer is
 * there, finding the wrong vehicle, and overwriting a price a human set.
 */

const LABELS = { hotel: "فندق", airline: "الناقل" };
const EMPTY: PricingReference = { transfers: [], services: [], rooms: [], fleet: [] };

describe("normalizeName", () => {
  it("reads the spellings the two systems actually use as the same place", () => {
    expect(normalizeName("إسطنبول")).toBe(normalizeName("اسطنبول"));
    expect(normalizeName("عُمان")).toBe(normalizeName("عمان"));
    expect(normalizeName("  السعودية ")).toBe(normalizeName("السعوديه"));
  });
});

describe("findTransferPrice", () => {
  // Shaped like the real list: the airport by its full name, the city by its own.
  const list = [
    { from_city: "مطار اسطنبول الدولي", to_city: "إسطنبول", car_type: "سيارة صغيرة", price: 120, currency: "USD" },
    { from_city: "مطار اسطنبول الدولي", to_city: "إسطنبول", car_type: "باص 40 مقعد", price: 400, currency: "USD" },
    { from_city: "مطار اسطنبول الدولي", to_city: "إسطنبول", car_type: "فان", price: 200, currency: "USD" },
  ];
  const fleet = [
    { name: "باص 40 مقعد", pax: 40 },
    { name: "سيارة صغيرة", pax: 3 },
    { name: "سيارة متوسطة", pax: 5 }, // seats five, but has no price on this road
    { name: "فان", pax: 8 },
  ];

  it("uses the arrival row for the way back when the list knows the road one way", () => {
    expect(findTransferPrice(list, "اسطنبول", "مطار إسطنبول الدولي", "سيارة صغيرة")?.price).toBe(120);
  });

  it("takes the exact direction before the reverse — some roads are priced per direction", () => {
    const road = [
      { from_city: "جوهور بارو", to_city: "جنتنج", car_type: "باص 16 راكب", price: 1000, currency: "MYR" },
      { from_city: "جنتنج", to_city: "جوهور بارو", car_type: "باص 16 راكب", price: 1100, currency: "MYR" },
    ];
    expect(findTransferPrice(road, "جوهور بارو", "جنتنج", "باص 16 راكب")?.price).toBe(1000);
    expect(findTransferPrice(road, "جنتنج", "جوهور بارو", "باص 16 راكب")?.price).toBe(1100);
  });

  it("refuses to price a bus at a car's rate", () => {
    // The dangerous near-miss: the route matches, the vehicle does not. A
    // guess here is a car's price on a coach.
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "إسطنبول", "ميني فان")).toBeNull();
  });

  it("ignores the «× 2» the count appends — the list price is per vehicle", () => {
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "إسطنبول", "باص 40 مقعد × 3")?.price).toBe(400);
  });

  it("with no vehicle chosen, prices the smallest vehicle that seats the group AND has a row", () => {
    // five travellers: the car seats three, the medium car has no price here
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "إسطنبول", null, 5, fleet)?.car_type).toBe("فان");
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "إسطنبول", "", 2, fleet)?.price).toBe(120);
    // nothing seats fifty: no price, not the biggest car's
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "إسطنبول", null, 50, fleet)).toBeNull();
    // and without the fleet it does not guess at all
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "إسطنبول", null, 2, [])).toBeNull();
  });

  it("takes the newer of two rows for one road, and the last legacy row on a timestamp tie", () => {
    const row = { from_city: "مطار اسطنبول الدولي", to_city: "إسطنبول", car_type: "سيارة صغيرة", currency: "USD" };
    const dated = [
      { ...row, price: 150, created_at: "2025-01-01T00:00:00+00:00" },
      { ...row, price: 100, created_at: "2026-02-01T00:00:00+00:00" },
    ];
    expect(findTransferPrice(dated, "مطار اسطنبول الدولي", "إسطنبول", "سيارة صغيرة")?.price).toBe(100);
    // the legacy import: one timestamp for everything, the retired prices kept —
    // higher (45 over the current 40) and in another currency (200 MYR)
    const at = "2026-09-01T10:00:00+00:00";
    const legacy = [
      { ...row, price: 45, created_at: at, legacy_id: 310 },
      { ...row, price: 200, currency: "MYR", created_at: at, legacy_id: 512 },
      { ...row, price: 40, created_at: at, legacy_id: 1404 },
      { ...row, price: 30, created_at: at, legacy_id: 77 },
    ];
    expect(findTransferPrice(legacy, "مطار اسطنبول الدولي", "إسطنبول", "سيارة صغيرة")).toMatchObject({
      price: 40,
      currency: "USD",
    });
  });

  it("says nothing rather than something, for a road it does not know", () => {
    expect(findTransferPrice(list, "مطار اسطنبول الدولي", "طرابزون", "سيارة صغيرة")).toBeNull();
  });
});

/** Malaysia, as the list holds it: three airports, and a city two of them serve. */
const MY = [
  { from_city: "مطار كوالالمبور الدولي", to_city: "كوالالمبور", car_type: "سيارة صغيرة", price: 130, currency: "MYR" },
  { from_city: "مطار كوالالمبور الدولي", to_city: "بينانج", car_type: "سيارة صغيرة", price: 900, currency: "MYR" },
  { from_city: "مطار بينانج الدولي", to_city: "بينانج", car_type: "سيارة صغيرة", price: 100, currency: "MYR" },
  { from_city: "مطار كوالالمبور الدولي", to_city: "جنتنج", car_type: "سيارة صغيرة", price: 300, currency: "MYR" },
  { from_city: "مطار سوبانج", to_city: "جنتنج", car_type: "سيارة صغيرة", price: 280, currency: "MYR" },
  { from_city: "ايبوه", to_city: "كوالالمبور", car_type: "سيارة صغيرة", price: 600, currency: "MYR" },
  // a move from one hotel to another in the same city — NOT a tour
  { from_city: "ايبوه", to_city: "ايبوه", car_type: "سيارة صغيرة", price: 200, currency: "MYR" },
];
const MY_FLEET = [{ name: "سيارة صغيرة", pax: 3 }];

/** Turkey: the airports table and the list spell the same airports differently. */
const TR = [
  { from_city: "مطار اسطنبول الدولي", to_city: "اسطنبول", car_type: "فيتو", price: 40, currency: "USD" },
  { from_city: "مطار صبيحة جوكشين الدولي", to_city: "اسطنبول", car_type: "فيتو", price: 45, currency: "USD" },
];

describe("findAirportTransfer", () => {
  it("resolves «المطار» to the city's airport, and the departure uses the same row reversed", () => {
    expect(findAirportTransfer(MY, "كوالالمبور", false, [], "سيارة صغيرة")?.price).toBe(130);
    expect(findAirportTransfer(MY, "كوالالمبور", true, [], "سيارة صغيرة")?.price).toBe(130);
  });

  it("gives up when two airports serve the city and nothing says which", () => {
    expect(findAirportTransfer(MY, "جنتنج", false, [], "سيارة صغيرة")).toBeNull();
  });

  it("lets the flights decide the airport, and a transit airport drop out", () => {
    expect(findAirportTransfer(MY, "جنتنج", false, ["مطار سوبانج (SZB)"], "سيارة صغيرة")?.price).toBe(280);
    expect(findAirportTransfer(MY, "بينانج", false, ["مطار بينانج الدولي (PEN)"], "سيارة صغيرة")?.price).toBe(100);
    // DOH is in the flights but has no road to the city
    const flown = ["مطار حمد الدولي (DOH)", "مطار كوالالمبور الدولي (KUL)"];
    expect(findAirportTransfer(MY, "كوالالمبور", false, flown, "سيارة صغيرة")?.price).toBe(130);
  });

  it("without flights, takes the airport named after the city", () => {
    expect(findAirportTransfer(MY, "بينانج", false, [], "سيارة صغيرة")?.price).toBe(100);
  });

  it("matches a flight's airport to the list's longer spelling of it", () => {
    const flown = ["مطار الملك خالد الدولي (RUH)", "مطار إسطنبول (IST)"];
    expect(findAirportTransfer(TR, "اسطنبول", false, flown, "فيتو")?.price).toBe(40);
  });

  it("never prices a flown airport it cannot place as the city's namesake airport", () => {
    // «كوكجن» against «جوكشين»: no match, and IST's 40 is NOT the Sabiha price
    const flown = ["مطار الملك خالد الدولي (RUH)", "مطار صبيحة كوكجن (SAW)"];
    expect(findAirportTransfer(TR, "اسطنبول", false, flown, "فيتو")).toBeNull();
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

  it("prices a «خدمات الدولة» line in the service's own currency, at the old system's last row", () => {
    const data = emptyDraftData();
    data.scope = { ...data.scope, services: true };
    // the line «خدمات الدولة» added: the service's exact arabic_name
    data.services = { ...data.services, includes: ["استقبال بالورد"] };
    // Thailand's three «استقبال بالورد» rows as the database returns them:
    // one import timestamp, in no useful order — legacy 36 is the current price.
    const at = "2026-10-10T21:43:02.949Z";
    const row = { service_type: "استقبال", arabic_name: "استقبال بالورد", buy_currency: "THB", sell_currency: "THB", created_at: at };
    const services = [
      { ...row, buy_price: 800, sell_price: 1000, legacy_id: 20 },
      { ...row, buy_price: 1600, sell_price: 2000, legacy_id: 36 },
      { ...row, buy_price: 1200, sell_price: 1500, legacy_id: 29 },
    ];
    const [line] = suggestPricing(data, { ...EMPTY, services }, LABELS);
    expect(line).toMatchObject({ item_type: "service", sell_price: 2000, sell_currency: "THB", buy_currency: "THB", source: "list" });
    // a row the admin added later (no legacy id) beats every imported one
    const added = { ...row, buy_price: 1700, sell_price: 2200, legacy_id: null, created_at: "2026-11-01T09:00:00.000Z" };
    expect(findServicePrice([...services, added], "استقبال بالورد")?.sell_price).toBe(2200);
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
    // a legacy line: one figure, no per-room prices → price × rooms
    const rooms = [{ hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "BB", price: 500, currency: "SAR" }];
    const [hotel] = suggestPricing(data, { ...EMPTY, rooms }, LABELS);
    expect(hotel.sell_price).toBe(777 * 2);
    // a typed price is what the room cost us: it counts in «إجمالي الشراء»
    expect(hotel.buy_price).toBe(777 * 2);
    expect(hotel.quantity).toBe(1);
    expect(hotel.source).toBe("typed");
  });

  it("adds the rooms up — a double and a triple are two different prices", () => {
    const data = draftWithOneStay();
    data.hotels[0] = withRooms(data.hotels[0], [
      { room_type_id: null, room_type_name: "مزدوجة", board_type: "BB", price: 500 },
      { room_type_id: null, room_type_name: "ثلاثية", board_type: "BB", price: 700 },
    ]);
    const [hotel] = suggestPricing(data, EMPTY, LABELS);
    expect(hotel.sell_price).toBe(1200);
    expect(hotel.quantity).toBe(1);
  });

  it("never adds a supplier's stay price to the rooms underneath it", () => {
    const data = draftWithOneStay();
    data.hotels[0] = withRooms(
      { ...data.hotels[0], sourcing: SUPPLIER_RATE },
      [{ room_type_id: null, room_type_name: "مزدوجة", board_type: "BB", price: 500 }],
    );
    const [hotel] = suggestPricing(data, EMPTY, LABELS);
    expect(hotel.sell_price).toBe(900);
    expect(hotel.buy_price).toBe(600);
  });

  it("falls back to the remembered price when nothing was typed", () => {
    const rooms = [{ hotel_id: "h1", hotel_name: "", room_type_name: "استاندر", board_type: "BB", price: 500, currency: "SAR" }];
    const [hotel] = suggestPricing(draftWithOneStay(), { ...EMPTY, rooms }, LABELS);
    // remembered is ONE room's price, and the stay has two
    expect(hotel.sell_price).toBe(1000);
    expect(hotel.buy_price).toBe(1000);
    expect(hotel.source).toBe("remembered");
  });

  it("leaves the line unpriced, and says so, when nothing knows the answer", () => {
    const [hotel] = suggestPricing(draftWithOneStay(), EMPTY, LABELS);
    expect(hotel.sell_price).toBeNull();
    expect(hotel.source).toBe("none");
  });

  it("prices a flight booking as one figure, and the stay as one priced thing", () => {
    const data = draftWithOneStay({ manual_price: 100 });
    data.flights = [
      {
        airline: "الخطوط التركية", airline_iata: "TK", flight_no: "123", from_airport: "", to_airport: "",
        departure_at: null, arrival_at: null, from_tz: null, to_tz: null, date_user_set: false,
        cabin_class: "", baggage_allowance: "", baggage_kg: null, baggage_pieces: null,
        cabin_baggage_kg: null, leg_order: "outbound",
      },
    ];
    data.flight_booking = { ...data.flight_booking, intl_price: 4200, intl_currency: "SAR" };
    const items = suggestPricing(data, EMPTY, LABELS);
    expect(items.find((i) => i.item_type === "hotel")?.quantity).toBe(1); // the rooms are summed
    // the booking price already covers every traveller and every leg
    expect(items.find((i) => i.item_type === "flight")).toMatchObject({ quantity: 1, buy_price: 4200, sell_price: 4200, ref: "flight:intl", source: "typed" });
  });
});

/** The Malaysia draft: arrive in Ipoh, leave from Kuala Lumpur, two travellers, no vehicle chosen. */
function malaysiaDraft(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", adults: 2, children: 0 };
  data.cities = [
    { city_name: "ايبوه", nights: 2, check_in: null, check_out: null },
    { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null },
  ];
  data.transport = deriveTransportRows(emptyTransportPlan(), data.cities);
  return data;
}

/** The same draft with the airport vehicle chosen. */
function withAirportCar(data: DraftData, car_type: string, cars = 1): DraftData {
  const plan = { ...emptyTransportPlan(), airport: { enabled: true, car_type, cars, note: "" } };
  return { ...data, transport: deriveTransportRows(plan, data.cities) };
}

const flight = (from_airport: string, to_airport: string): DraftData["flights"][number] => ({
  airline: "الخطوط السعودية", airline_iata: "SV", flight_no: "1", from_airport, to_airport,
  departure_at: null, arrival_at: null, from_tz: null, to_tz: null, date_user_set: false,
  cabin_class: "", baggage_allowance: "", baggage_kg: null, baggage_pieces: null,
  cabin_baggage_kg: null, leg_order: "outbound",
});

describe("suggestPricing — transport", () => {
  const transport = () =>
    suggestPricing(malaysiaDraft(), { ...EMPTY, transfers: MY, fleet: MY_FLEET }, LABELS).filter(
      (i) => i.item_type === "transport",
    );

  it("prices the departure from the airport row, buy AND sell, in the list's currency", () => {
    const leave = transport().find((i) => i.description.startsWith("فندق كوالالمبور"));
    expect(leave?.buy_price).toBe(130);
    expect(leave?.sell_price).toBe(130);
    expect(leave?.sell_currency).toBe("MYR");
    expect(leave?.source).toBe("list");
  });

  it("leaves a road the list does not know unpriced — null, never 0", () => {
    const arrive = transport().find((i) => i.description.startsWith("المطار"));
    expect(arrive?.sell_price).toBeNull();
    expect(arrive?.buy_price).toBeNull();
  });

  it("has no tours line at all — a tour's own price includes its car", () => {
    expect(transport().find((i) => i.description.startsWith("الجولات السياحية"))).toBeUndefined();
  });

  it("never quotes a 0 — the old system's blank — as a price", () => {
    const zero = [
      { from_city: "مطار كوالالمبور الدولي", to_city: "كوالالمبور", car_type: "سيارة صغيرة", price: 0, currency: "MYR" },
      { from_city: "مطار كوالالمبور الدولي", to_city: "كوالالمبور", car_type: "فان", price: 200, currency: "MYR" },
    ];
    const fleet = [{ name: "سيارة صغيرة", pax: 3 }, { name: "فان", pax: 8 }];
    const leave = (data: DraftData) =>
      suggestPricing(data, { ...EMPTY, transfers: zero, fleet }, LABELS).find((i) => i.description.startsWith("فندق كوالالمبور"));
    // the small car chosen: it has no real price on this road
    expect(leave(withAirportCar(malaysiaDraft(), "سيارة صغيرة"))?.sell_price).toBeNull();
    // none chosen: the smallest vehicle with a REAL price
    expect(leave(malaysiaDraft())?.sell_price).toBe(200);
  });

  it("prices the way in from where the flights land, the way out from where they leave", () => {
    const data = malaysiaDraft();
    data.cities = [{ city_name: "اسطنبول", nights: 3, check_in: null, check_out: null }];
    data.transport = deriveTransportRows(emptyTransportPlan(), data.cities);
    data.flights = [
      flight("مطار الملك خالد الدولي (RUH)", "مطار صبيحة جوكشين الدولي (SAW)"),
      flight("مطار اسطنبول الدولي (IST)", "مطار الملك خالد الدولي (RUH)"),
    ];
    const items = suggestPricing(data, { ...EMPTY, transfers: TR, fleet: [{ name: "فيتو", pax: 8 }] }, LABELS);
    expect(items.find((i) => i.description.startsWith("المطار"))?.sell_price).toBe(45); // SAW
    expect(items.find((i) => i.description.startsWith("فندق اسطنبول"))?.sell_price).toBe(40); // IST
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

  it("fills a line with no price on either side, and leaves a priced one alone", () => {
    const line = (description: string, sell: number | null): DraftPricingItem => ({
      item_type: "transport", description, quantity: 1,
      buy_price: null, buy_currency: "SAR", sell_price: sell, sell_currency: "SAR",
    });
    const existing = [line("فندق كوالالمبور ← المطار", null), line("المطار ← فندق ايبوه", 500)];
    const suggested = suggestPricing(malaysiaDraft(), { ...EMPTY, transfers: MY, fleet: MY_FLEET }, LABELS).filter(
      (i) => i.item_type === "transport",
    );
    const merged = mergeSuggestions(existing, suggested);
    expect(merged.filled).toBe(1);
    expect(merged.items[0]).toMatchObject({ buy_price: 130, sell_price: 130, sell_currency: "MYR" });
    expect(merged.items[1].sell_price).toBe(500);
    expect(merged.added).toBe(0); // no tours line: a tour's price includes its car
    expect(merged.priced).toBe(1);
  });

  it("fills each stay from its own ref, even when two stays read the same", () => {
    // one hotel stayed in twice: one description, two stays, two prices
    const stay = (ref: string, sell: number | null): DraftPricingItem => ({
      item_type: "hotel", description: "إسطنبول — هيلتون", ref, quantity: 1,
      buy_price: null, buy_currency: "SAR", sell_price: sell, sell_currency: "SAR",
    });
    const merged = mergeSuggestions(
      [stay("s1", null), stay("s2", null)],
      [{ ...stay("s1", 2000), source: "typed" }, { ...stay("s2", 4500), source: "typed" }],
    );
    expect(merged.items.map((i) => i.sell_price)).toEqual([2000, 4500]);
  });

  it("treats a re-planned vehicle as a new line, not a new price on the old one", () => {
    const vans = [
      ...MY,
      { from_city: "مطار كوالالمبور الدولي", to_city: "كوالالمبور", car_type: "فان", price: 250, currency: "MYR" },
    ];
    // first run: no vehicle and no fleet, so nothing priced
    const before = mergeSuggestions([], suggestPricing(malaysiaDraft(), { ...EMPTY, transfers: vans }, LABELS)).items;
    // then two vans: one van's price on a one-car line would bill half the road
    const after = suggestPricing(withAirportCar(malaysiaDraft(), "فان", 2), { ...EMPTY, transfers: vans }, LABELS);
    const leave = mergeSuggestions(before, after).items.filter((i) => i.description.startsWith("فندق كوالالمبور"));
    expect(leave).toHaveLength(2);
    expect(leave[0].sell_price).toBeNull(); // the stale line, still counted as unpriced
    expect(leave[1]).toMatchObject({ description: "فندق كوالالمبور ← المطار (فان × 2)", quantity: 2, sell_price: 250 });
  });

  it("does not fill from a buy price alone — the client figure would still be empty", () => {
    const line: DraftPricingItem = {
      item_type: "service", description: "شريحة اتصال", quantity: 1,
      buy_price: null, buy_currency: "SAR", sell_price: null, sell_currency: "SAR",
    };
    const buyOnly = { ...line, buy_price: 50, source: "list" as const };
    expect(mergeSuggestions([line], [buyOnly])).toMatchObject({ filled: 0, priced: 0 });
    // so the run after the list gains a sell price can still fill it
    expect(mergeSuggestions([line], [{ ...buyOnly, sell_price: 80 }])).toMatchObject({ filled: 1, priced: 1 });
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

describe("syncSuggestions", () => {
  const line = (over: Partial<DraftPricingItem>): DraftPricingItem => ({
    item_type: "transport",
    description: "استقبال المطار",
    quantity: 1,
    buy_price: null,
    buy_currency: "SAR",
    sell_price: null,
    sell_currency: "SAR",
    ...over,
  });
  const suggested = (over: Partial<DraftPricingItem>) => ({ ...line(over), source: "list" as const });

  it("takes today's list price on a line nobody touched", () => {
    const out = syncSuggestions([line({ sell_price: 200 })], [suggested({ sell_price: 250 })]);
    expect(out).toEqual([expect.objectContaining({ sell_price: 250, list_sell: 250 })]);
  });

  it("keeps a line the agent changed by hand, and remembers the list price for «استعادة»", () => {
    const out = syncSuggestions([line({ sell_price: 180, overridden: true })], [suggested({ sell_price: 250 })]);
    expect(out[0]).toMatchObject({ sell_price: 180, overridden: true, list_sell: 250 });
  });

  it("drops a line the draft no longer produces, but never a hand-added one", () => {
    const out = syncSuggestions(
      [line({ description: "فندق حُذف", item_type: "hotel", sell_price: 900 }), line({ description: "إكرامية", item_type: "other", manual: true, sell_price: 50 })],
      [],
    );
    expect(out.map((i) => i.description)).toEqual(["إكرامية"]);
  });
});

describe("data model 0072 — airport → city rows and per-car tours", () => {
  const point = (from: [PointTransfer["from_kind"], string, string | null], to: [PointTransfer["to_kind"], string, string | null], car: string, price: number): PointTransfer => ({
    from_kind: from[0], from_name: from[1], from_code: from[2], to_kind: to[0], to_name: to[1], to_code: to[2], car_type: car, price, currency: "MYR",
  });
  const KUL: [PointTransfer["from_kind"], string, string] = ["airport", "مطار كوالالمبور الدولي", "KUL"];
  const SZB: [PointTransfer["from_kind"], string, string] = ["airport", "مطار سوبانج", "SZB"];
  const KL: [PointTransfer["to_kind"], string, null] = ["city", "كوالالمبور", null];
  const POINTS = [
    point(KUL, KL, "سيارة صغيرة", 120),
    point(KUL, KL, "فان", 180),
    point(SZB, KL, "سيارة صغيرة", 90),
    point(["city", "لنكاوي", null], ["city", "لنكاوي", null], "سيارة صغيرة", 60),
  ];
  const fleet = [{ name: "سيارة صغيرة", pax: 3 }, { name: "فان", pax: 8 }];

  it("prices reception and farewell from the airport the flights name, for the car", () => {
    expect(resolveAirportCity(POINTS, "كوالالمبور", false, ["مطار كوالالمبور الدولي (KUL)"], "فان")?.price).toBe(180);
    // the farewell is the same road the other way
    expect(resolveAirportCity(POINTS, "كوالالمبور", true, ["مطار سوبانج (SZB)"], "سيارة صغيرة")?.price).toBe(90);
    // no car chosen: the smallest that seats the group
    expect(resolveAirportCity(POINTS, "كوالالمبور", false, ["KUL"], null, 5, fleet)?.price).toBe(180);
  });

  it("does not guess between two airports, and falls back to the city's own row", () => {
    expect(resolveAirportCity(POINTS, "كوالالمبور", false, [], "سيارة صغيرة")).toBeNull();
    expect(resolveAirportCity(POINTS, "لنكاوي", false, ["مطار لنكاوي الدولي (LGK)"], "سيارة صغيرة")?.price).toBe(60);
  });

  it("reaches the pricing sheet before the text rows", () => {
    const data = malaysiaDraft();
    data.cities = [{ city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null }];
    data.transport = deriveTransportRows(emptyTransportPlan(), data.cities);
    data.flights = [flight("مطار الملك خالد الدولي (RUH)", "مطار كوالالمبور الدولي (KUL)")];
    const items = suggestPricing(data, { ...EMPTY, transfers: MY, fleet, points: POINTS }, LABELS);
    expect(items.find((i) => i.description.startsWith("المطار"))).toMatchObject({ sell_price: 120, source: "list" });
  });

  it("prices a tour for the car it goes in — never another car's price", () => {
    const tours = [
      { name: "جولة كوالالمبور", price: 300, currency: "SAR" },
      { name: "جولة كوالالمبور", price: 300, currency: "SAR", car_type: "سيدان", program_id: "p1" },
      { name: "جولة كوالالمبور", price: 450, currency: "SAR", car_type: "فان", program_id: "p1" },
    ];
    expect(findTourPrice(tours, "جولة كوالالمبور", "فان")?.price).toBe(450);
    expect(findTourPrice(tours, "الجولة الأولى", "فان", "p1")?.price).toBe(450);
    expect(findTourPrice(tours, "جولة كوالالمبور", "باص")).toBeNull();
    expect(findTourPrice(tours, "جولة كوالالمبور")?.price).toBe(300);
    // the old per-car name still finds the grouped tour, at that car's price
    expect(findTourPrice(tours, "جولة كوالالمبور (فان)")?.price).toBe(450);
  });
});
