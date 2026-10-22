import { describe, expect, it } from "vitest";
import { addStay, deriveTransportRows, emptyDraftData, emptyFlight, normalizeDraftData, type DraftData, type DraftFlight } from "@/lib/offer/draft-types";
import { BOARD_AR } from "@/components/offer-doc/labels";
import { addCity, withTours } from "@/lib/offer/basic";
import {
  ARRIVAL_DAY_TOUR,
  DEPARTURE_DAY_TOUR,
  FAREWELL_UNSOLD,
  FLIGHT_NEEDED,
  LATER,
  newBookings,
  NOTICE,
  offerHotelCity,
  offerHotelFor,
  oldPullStays,
  planBookingsFromDraft,
  ticketTitle,
  type ExistingBooking,
} from "./seed-plan";
import { carText, DRV } from "./drivers";
import { HOTEL_ID_KEY } from "./voucher-dto";

/** The trial's case: Malaysia 20–27 Nov, KL 4 + Langkawi 3, 2 + 2, a domestic flight there and back. */
function malaysia(): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-11-20", nights: 7, adults: 2, children: 2, meal_plan: "breakfast" };
  data.scope = { ...data.scope, transport: true, hotels: true };
  data.flights = [];
  data = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 4, tours: 2, hotel: { id: "h1", name: "بولمان سيتي سنتر" }, room: "ديلوكس", rooms: 2, price: 1600 }, "SAR") };
  data = { ...data, ...addCity(data, { name: "لنكاوي", nights: 3, tours: 1, hotel: { id: "h2", name: "منتجع بيرجايا" }, room: "ديلوكس مطلة على البحر", rooms: 2, price: 2100 }, "SAR") };
  const leg = (order: DraftFlight["leg_order"], no: string, from: string, fromCity: string, to: string, toCity: string, dep: string, arr: string): DraftFlight => ({
    ...emptyFlight(order),
    flight_no: no,
    from_airport: from,
    to_airport: to,
    from_city: fromCity,
    to_city: toCity,
    departure_at: dep,
    arrival_at: arr,
  });
  data.flights = [
    leg("outbound", "SV834", "مطار الملك خالد (RUH)", "الرياض", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "2026-11-20T01:00", "2026-11-20T14:30"),
    leg("internal", "MH1430", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "مطار لنكاوي (LGK)", "لنكاوي", "2026-11-24T10:00", "2026-11-24T11:05"),
    leg("internal", "MH1431", "مطار لنكاوي (LGK)", "لنكاوي", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "2026-11-27T09:00", "2026-11-27T10:05"),
    leg("inbound", "SV835", "مطار كوالالمبور الدولي (KUL)", "كوالالمبور", "مطار الملك خالد (RUH)", "الرياض", "2026-11-27T16:00", "2026-11-27T20:00"),
  ];
  data.transport_plan = {
    ...data.transport_plan,
    airport: { ...data.transport_plan.airport, car_type: "ميني فان" },
    tours: { ...data.transport_plan.tours, enabled: true, car_type: "ميني فان" },
    intercity: { ...data.transport_plan.intercity, enabled: true, modes: ["car", "flight"], mode: "car", hop_modes: { "كوالالمبور>لنكاوي": "flight" } },
  };
  data.cities = data.cities.map((c) => ({ ...c, tour_picks: withTours(c, c.tours ?? 0).map((p, i) => ({ ...p, title: `جولة ${c.city_name} ${i + 1}`, price: 300 })) }));
  data.services = { ...data.services, includes: ["الفنادق", "شريحة اتصال × 2"] };
  data.transport = deriveTransportRows(data.transport_plan, data.cities);
  return data;
}

describe("the pull from the offer", () => {
  const rows = planBookingsFromDraft(malaysia(), "شروط الشركة");
  const by = (ref: string) => rows.find((r) => r.origin_ref === ref);

  it("books each flight ticket once — out and back together, the domestic legs together", () => {
    const flights = rows.filter((r) => r.kind === "flight");
    expect(flights.map((r) => r.origin_ref)).toEqual(["flight:intl", "flight:dom"]);
    expect(Object.keys(by("flight:intl")!.detail)).toEqual(expect.arrayContaining(["الذهاب", "العودة"]));
    expect(Object.keys(by("flight:dom")!.detail)).toEqual(expect.arrayContaining(["رحلة 1", "رحلة 2"]));
    // the landing rides on the line, so the reception can follow it (drivers.ts)
    expect(by("flight:intl")!.detail["الذهاب"]).toBe("SV834 · RUH → KUL · 2026-11-20 01:00 · الوصول 2026-11-20 14:30");
    // the route is said once: in the title, not again as the flight's «city» («title — city» read it twice)
    expect([by("flight:dom")!.title, by("flight:dom")!.city_name]).toEqual(["طيران داخلي KUL → LGK · LGK → KUL", ""]);
    expect(by("flight:intl")!.city_name).toBe("");
  });

  it("times every transfer from the flight it meets, the day-of-move ones included", () => {
    const transfer = (title: string) => rows.find((r) => r.kind === "transport" && r.title === title)!;
    // met 45 minutes after SV834 lands; seen off 2 h before MH1431 (domestic), from Langkawi
    expect([transfer("المطار ← فندق كوالالمبور").start_date, transfer("المطار ← فندق كوالالمبور").detail["الوقت"]]).toEqual(["2026-11-20", "15:15"]);
    expect([transfer("فندق لنكاوي ← المطار").start_date, transfer("فندق لنكاوي ← المطار").detail["الوقت"]]).toEqual(["2026-11-27", "07:00"]);
    expect(transfer("فندق كوالالمبور ← المطار").detail["الوقت"]).toBe("08:00");
    expect(transfer("المطار ← فندق لنكاوي").detail["الوقت"]).toBe("11:50");
    expect(transfer("المطار ← فندق كوالالمبور").detail["نقطة الالتقاء"]).toContain("KUL");
  });

  it("pulls the tours on their days, the stays with their rooms, the SIM cards — and nothing twice", () => {
    const tours = rows.filter((r) => r.origin_ref.startsWith("tour:"));
    expect(tours).toHaveLength(3);
    expect(tours.every((t) => t.start_date)).toBe(true);
    expect(rows.filter((r) => r.kind === "hotel").map((r) => [r.title, r.city_name, r.detail["عدد الغرف"]])).toEqual([
      ["بولمان سيتي سنتر", "كوالالمبور", "2"],
      ["منتجع بيرجايا", "لنكاوي", "2"],
    ]);
    expect(by("sim")?.title).toBe("شريحة اتصال × 2");
    expect(new Set(rows.map((r) => r.origin_ref)).size).toBe(rows.length);
  });

  it("books a tour in its car and how many, at the price per car × the cars (الأمر 3)", () => {
    const data = malaysia();
    data.cities = data.cities.map((c, i) =>
      i === 0 ? { ...c, tour_picks: c.tour_picks!.map((p, k) => (k === 0 ? { ...p, car_type: "فان", cars: 2 } : p)) } : c,
    );
    const tours = planBookingsFromDraft(data, "شروط الشركة").filter((r) => r.origin_ref.startsWith("tour:كوالالمبور"));
    expect(tours.map((t) => [t.detail["السيارة"], t.detail[DRV.cars], carText(t.detail), t.quoted_net])).toEqual([
      ["فان", "2", "فان × 2", 600],
      // a pick from before the count: the trip's tour car, once
      ["ميني فان", "1", "ميني فان", 300],
    ]);
  });

  it("keeps the count when operations type a car model over the seeded car", () => {
    const data = malaysia();
    data.cities = data.cities.map((c, i) =>
      i === 0 ? { ...c, tour_picks: c.tour_picks!.map((p, k) => (k === 0 ? { ...p, car_type: "فان", cars: 2 } : p)) } : c,
    );
    const tour = planBookingsFromDraft(data, "شروط الشركة").find((r) => r.origin_ref.startsWith("tour:كوالالمبور"))!;
    expect(carText({ ...tour.detail, [DRV.car]: "Hyundai Staria" })).toBe("Hyundai Staria × 2");
  });

  it("books «جولة قبل المغادرة» on the day home — and only the marked one", () => {
    const data = malaysia();
    // لنكاوي (24–26 Nov, home on the 27th): one tour put on the day home, one date left there from before
    data.cities = data.cities.map((c, i) =>
      i === 1
        ? {
            ...c,
            tours: 2,
            tour_picks: [
              { program_id: null, title: "جولة الجزر", text: "", price: 300, date: "2026-11-27", departure: true },
              { program_id: null, title: "جولة قديمة", text: "", price: 300, date: "2026-11-27" },
            ],
          }
        : c,
    );
    const tours = planBookingsFromDraft(data, "شروط الشركة").filter((r) => r.origin_ref.startsWith("tour:لنكاوي"));
    expect(tours.map((t) => [t.title, t.start_date])).toEqual([
      ["جولة: جولة قديمة", "2026-11-25"],
      ["جولة: جولة الجزر", "2026-11-27"],
    ]);
  });
});

describe("a booking per stay — two hotels in one city (order 1)", () => {
  const hotelRows = (data: DraftData) =>
    planBookingsFromDraft(data, "شروط الشركة")
      .filter((r) => r.kind === "hotel")
      .map((r) => [r.title, r.start_date, r.end_date, r.detail["عدد الغرف"]]);

  it("books A then B in كوالالمبور, each on its own dates (acceptance أ)", () => {
    const data = malaysia();
    // بولمان three nights, then a second hotel for the fourth
    const three = data.hotels.map((h) => (h.hotel_name === "بولمان سيتي سنتر" ? { ...h, nights: 3 } : h));
    const added = addStay(data.cities, three, 0, "after");
    data.hotels = added.hotels.map((h) => (h.id === added.id ? { ...h, hotel_name: "تريدرز" } : h));
    expect(hotelRows(data)).toEqual([
      ["بولمان سيتي سنتر", "2026-11-20", "2026-11-23", "2"],
      ["تريدرز", "2026-11-23", "2026-11-24", "2"],
      ["منتجع بيرجايا", "2026-11-24", "2026-11-27", "2"],
    ]);
  });

  it("books two hotels on the same dates as two bookings, each with its own rooms (acceptance ب)", () => {
    const data = malaysia();
    const added = addStay(data.cities, data.hotels, 0, "same");
    data.hotels = added.hotels.map((h) => (h.id === added.id ? { ...h, hotel_name: "تريدرز" } : h));
    expect(hotelRows(data)).toEqual([
      ["بولمان سيتي سنتر", "2026-11-20", "2026-11-24", "2"],
      ["تريدرز", "2026-11-20", "2026-11-24", "1"],
      ["منتجع بيرجايا", "2026-11-24", "2026-11-27", "2"],
    ]);
    expect(new Set(planBookingsFromDraft(data, "").filter((r) => r.kind === "hotel").map((r) => r.origin_ref)).size).toBe(3);
  });
});

/**
 * AD-4-8573 as it was issued (offer_renders v1 source_draft, 2026-10-15): a full-generator file —
 * Puncak 3 + Bali 4, hotels not yet chosen, no flights, tours planned but no per-city count.
 * The pull brought 3 transfers; the agent typed the two hotels, the two tour cars and the farewell date.
 */
function puncakBali(): DraftData {
  const room = { price: 1200, board_type: "BB", room_type_id: null, room_type_name: "أجنحة رويال أوشن المطلة على المحيط" };
  const day = (date: string, city: string, title: string) => ({ date, city_name: city, title, activities: [`${title}.`], weather: null, ai_generated: true });
  return normalizeDraftData({
    trip: { ...emptyDraftData().trip, adults: 2, nights: 7, country: "اندونيسيا", arrival_date: "2026-10-31", departure_date: "2026-11-07" },
    scope: { visas: false, hotels: true, services: true, transport: true, flights_intl: false, flights_domestic: false },
    cities: [
      { key: "بونشاك#1", nights: 3, check_in: "2026-10-31", check_out: "2026-11-03", city_name: "بونشاك", from_flight: false },
      { key: "بالي#1", nights: 4, check_in: "2026-11-03", check_out: "2026-11-07", city_name: "بالي" },
    ],
    hotels: [
      { id: "stay-imushfdi", rooms: [room], nights: 0, hotel_id: null, city_name: "بونشاك", hotel_name: "", rooms_count: 1, manual_currency: "SAR" },
      { id: "stay-12w5hh0y", rooms: [{ ...room, price: 1800 }], nights: 0, hotel_id: null, city_name: "بالي", hotel_name: "", rooms_count: 1, manual_currency: "SAR" },
    ],
    flights: [],
    transport: [
      { date: "2026-10-31", note: "", car_type: "سيارة صغيرة", to_place: "فندق بونشاك", from_place: "المطار" },
      { date: null, note: "", car_type: "سيارة صغيرة", to_place: "المطار", from_place: "فندق بالي" },
      { date: null, note: "", car_type: "سيارة صغيرة", to_place: "بونشاك", from_place: "الجولات السياحية" },
      { date: "2026-11-03", note: "", car_type: "سيارة صغيرة", to_place: "بالي", from_place: "بونشاك" },
    ],
    transport_plan: {
      tours: { cars: 1, note: "", enabled: true, car_type: "سيارة صغيرة" },
      airport: { cars: 1, note: "", enabled: true, car_type: "سيارة صغيرة" },
      intercity: { cars: 1, mode: "car", note: "", modes: ["car"], enabled: true, car_type: "سيارة صغيرة", hop_modes: {} },
    },
    days: [
      day("2026-10-31", "بونشاك", "يوم الوصول في بونشاك"),
      day("2026-11-01", "بونشاك", "استكشاف بونشاك"),
      day("2026-11-02", "بونشاك", "مغامرات في بونشاك"),
      day("2026-11-03", "بالي", "الانتقال إلى بالي"),
      day("2026-11-04", "بالي", "استكشاف معابد بالي"),
      day("2026-11-05", "بالي", "يوم الشاطئ في بالي"),
      day("2026-11-06", "بالي", "استرخاء واستكشاف بالي"),
      day("2026-11-07", "بالي", "استعداد للمغادرة"),
    ],
  } as unknown as Record<string, unknown>);
}

describe("the pull brings everything — AD-4-8573 (order 3)", () => {
  const rows = planBookingsFromDraft(puncakBali(), "شروط الشركة");

  it("books both stays though the offer went out before the hotels were chosen — rooms, board and dates kept", () => {
    expect(rows.filter((r) => r.kind === "hotel").map((r) => [r.title, r.city_name, r.start_date, r.end_date, r.detail["الغرفة"]])).toEqual([
      ["فندق بونشاك — يُحدَّد لاحقاً", "بونشاك", "2026-10-31", "2026-11-03", `أجنحة رويال أوشن المطلة على المحيط — ${BOARD_AR.BB}`],
      ["فندق بالي — يُحدَّد لاحقاً", "بالي", "2026-11-03", "2026-11-07", `أجنحة رويال أوشن المطلة على المحيط — ${BOARD_AR.BB}`],
    ]);
  });

  it("dates every transfer — the farewell on the trip's last day", () => {
    expect(rows.filter((r) => r.kind === "transport").map((r) => [r.title, r.start_date])).toEqual([
      ["المطار ← فندق بونشاك", "2026-10-31"],
      ["فندق بالي ← المطار", "2026-11-07"],
      ["بونشاك ← بالي", "2026-11-03"],
    ]);
  });

  it("books the programme's tour days in the tours car — 2 in Puncak, 3 in Bali, never the arrival day", () => {
    const tours = rows.filter((r) => r.origin_ref.startsWith("tour:"));
    expect(tours.map((t) => [t.city_name, t.start_date, t.title, carText(t.detail)])).toEqual([
      ["بونشاك", "2026-11-01", "جولة: استكشاف بونشاك", "سيارة صغيرة"],
      ["بونشاك", "2026-11-02", "جولة: مغامرات في بونشاك", "سيارة صغيرة"],
      ["بالي", "2026-11-04", "جولة: استكشاف معابد بالي", "سيارة صغيرة"],
      ["بالي", "2026-11-05", "جولة: يوم الشاطئ في بالي", "سيارة صغيرة"],
      ["بالي", "2026-11-06", "جولة: استرخاء واستكشاف بالي", "سيارة صغيرة"],
    ]);
  });

  it("leaves a «يوم حر» of the programme without a tour", () => {
    const data = puncakBali();
    data.days = data.days.map((d) => (d.date === "2026-11-05" ? { ...d, title: "يوم حر" } : d));
    expect(planBookingsFromDraft(data, "").filter((r) => r.origin_ref.startsWith("tour:بالي")).map((t) => t.start_date)).toEqual(["2026-11-04", "2026-11-06"]);
  });
});

describe("pulling again never makes a twin (order 3)", () => {
  const plan = planBookingsFromDraft(puncakBali(), "");
  const row = (p: Partial<ExistingBooking>): ExistingBooking => ({ origin_ref: null, kind: "hotel", city_name: "", start_date: null, end_date: null, status: "confirmed", ...p });

  it("adds nothing the second time", () => {
    const { fresh } = newBookings(plan, []);
    expect(fresh).toHaveLength(plan.length);
    expect(newBookings(plan, fresh.map((p) => row({ ...p, status: "pending" })))).toEqual({ fresh: [], links: [] });
  });

  it("adds nothing over what the agent typed by hand on AD-4-8573 — the farewell pulled undated included", () => {
    // operation 9e73003a as it stands: 3 pulled transfers (the farewell's ref undated), 2 hotels and 2 tour cars typed
    const held = [
      row({ kind: "hotel", city_name: "بونشاك", start_date: "2026-10-31", end_date: "2026-11-03" }),
      row({ kind: "hotel", city_name: "بالي", start_date: "2026-11-03", end_date: "2026-11-07" }),
      row({ origin_ref: "transfer:المطار>فندق بونشاك>2026-10-31", kind: "transport", city_name: "بونشاك", start_date: "2026-10-31" }),
      row({ origin_ref: "transfer:فندق بالي>المطار>", kind: "transport", city_name: "بالي", start_date: "2026-11-07" }),
      row({ origin_ref: "transfer:بونشاك>بالي>2026-11-03", kind: "transport", city_name: "بونشاك", start_date: "2026-11-03" }),
      row({ kind: "transport", city_name: "بونشاك", start_date: "2026-11-01", end_date: "2026-11-02" }),
      row({ kind: "transport", city_name: "بالي", start_date: "2026-11-04", end_date: "2026-11-06" }),
    ];
    expect(newBookings(plan, held).fresh).toEqual([]);
  });

  it("links the hotels typed by hand to the stays of the re-issued offer instead of adding them again", () => {
    // AD-4-8573 issued again with its hotels named — the two bookings operations typed carry no origin_ref
    const data = puncakBali();
    const names = ["فندق ومنتجع جراند استون بونشاك", "نوفوتيل بالي نوسا دوا - فندق"];
    data.hotels = data.hotels.map((h, i) => ({ ...h, hotel_name: names[i] }));
    const reissued = planBookingsFromDraft(data, "");
    const held = [
      row({ id: "pnk", title: "فندق ومنتجع جراند استون بونشاك - غرفة مزدوجة شامل الإفطار", city_name: "بونشاك", start_date: "2026-10-31", end_date: "2026-11-03" }),
      row({ id: "bali", title: "نوفوتيل بالي نوسا دوا - غرفة مزدوجة شامل الإفطار", city_name: "بالي", start_date: "2026-11-03", end_date: "2026-11-07" }),
      row({ id: "dep", origin_ref: "transfer:فندق بالي>المطار>", kind: "transport", title: "فندق بالي ← المطار", city_name: "بالي", start_date: "2026-11-07" }),
      row({ id: "cars", kind: "transport", title: "سيارة الجولات", city_name: "بالي", start_date: "2026-11-04", end_date: "2026-11-06" }),
    ];
    const { fresh, links } = newBookings(reissued, held);
    expect(fresh.filter((r) => r.kind === "hotel")).toEqual([]);
    expect([...links].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "bali", origin_ref: "stay:stay-12w5hh0y" },
      { id: "dep", origin_ref: "transfer:فندق بالي>المطار>2026-11-07" },
      { id: "pnk", origin_ref: "stay:stay-imushfdi" },
    ]);
    // a tour car stands for three tours — never linked to one of them
    expect(fresh.filter((r) => r.origin_ref.startsWith("tour:بالي"))).toEqual([]);
  });

  it("adds what is missing — a hand-typed row covers one booking, a cancelled one none", () => {
    const held = [
      row({ kind: "hotel", city_name: "بونشاك", start_date: "2026-10-31" }),
      row({ kind: "hotel", city_name: "بالي", start_date: "2026-11-03", status: "cancelled" }),
      row({ kind: "transport", city_name: "بونشاك", start_date: "2026-11-01" }),
    ];
    const added = newBookings(plan, held).fresh.map((p) => p.origin_ref);
    expect(added).toContain("stay:stay-12w5hh0y");
    expect(added).not.toContain("stay:stay-imushfdi");
    // the one-day car covers the tour on its day only
    expect(added.filter((r) => r.startsWith("tour:بونشاك"))).toEqual(["tour:بونشاك:1"]);
  });

  it("books both hotels of a city on the same dates when only one was typed — the one typed by its name", () => {
    const data = malaysia();
    const added = addStay(data.cities, data.hotels, 0, "same");
    data.hotels = added.hotels.map((h) => (h.id === added.id ? { ...h, hotel_name: "تريدرز" } : h));
    const stays = planBookingsFromDraft(data, "").filter((r) => r.kind === "hotel");
    const { fresh, links } = newBookings(stays, [row({ id: "typed", title: "تريدرز كوالالمبور", city_name: "كوالالمبور", start_date: "2026-11-20" })]);
    expect(fresh.map((r) => r.title)).toEqual(["بولمان سيتي سنتر", "منتجع بيرجايا"]);
    expect(links).toEqual([{ id: "typed", origin_ref: stays[1].origin_ref }]);
  });

  it("never takes a hotel of another day or city for it", () => {
    const { fresh, links } = newBookings(plan.filter((r) => r.kind === "hotel"), [
      row({ id: "x", title: "فندق بونشاك", city_name: "بونشاك", start_date: "2026-11-01" }),
      row({ id: "y", title: "فندق بالي", city_name: "جاكرتا", start_date: "2026-11-03" }),
    ]);
    expect(fresh).toHaveLength(2);
    expect(links).toEqual([]);
  });
});

/**
 * AD-2-3599 as it was issued (offer_renders v1 source_draft, 2026-10-17): Bali 11 nights, the
 * international flight planned but not ticketed (no number, no landing), a tour put on the
 * arrival day, the farewell taken off the city's card and «جولة قبل المغادرة» on the day home.
 */
function bali(over: { flights?: Partial<DraftFlight>[]; airport?: boolean } = {}): DraftData {
  const room = { price: 900, board_type: "BB", room_type_id: null, room_type_name: "غرفة ديلوكس" };
  const flights = [
    { ...emptyFlight("outbound"), from_airport: "مطار الملك عبدالعزيز الدولي (JED)", to_airport: "مطار بالي نجوراه راي (DPS)", from_city: "جدة", to_city: "بالي", departure_at: "2026-10-07T00:00" },
    { ...emptyFlight("inbound"), from_airport: "مطار بالي نجوراه راي (DPS)", to_airport: "مطار الملك عبدالعزيز الدولي (JED)", from_city: "بالي", to_city: "جدة", departure_at: "2026-10-18T00:00" },
  ].map((f, i) => ({ ...f, ...(over.flights?.[i] ?? {}) }));
  const leg = { cars: 1, note: "", enabled: true, car_type: "سيارة صغيرة" };
  return normalizeDraftData({
    trip: { ...emptyDraftData().trip, adults: 2, nights: 11, country: "اندونيسيا", arrival_date: "2026-10-07", departure_date: "2026-10-18" },
    scope: { visas: true, hotels: true, services: true, transport: true, flights_intl: true, flights_domestic: false },
    cities: [
      {
        key: "بالي#1",
        nights: 11,
        check_in: "2026-10-07",
        check_out: "2026-10-18",
        city_name: "بالي",
        tours: 3,
        tour_picks: [
          { program_id: null, title: "الجولة الأولى في بالي", text: "", price: 122, date: "2026-10-07", cars: 1 },
          { program_id: null, title: "الجولة الثالثة في بالي", text: "", price: 120, date: "2026-10-08", cars: 1 },
          { program_id: null, title: "الجولة الخامسة في بالي", text: "", price: 1122, date: "2026-10-14", cars: 1, departure: true },
        ],
        services: [{ id: "in", price: 122 }, { id: "out", removed: true }],
      },
    ],
    hotels: [{ id: "stay-fx928rg2", rooms: [room], nights: 0, hotel_id: "51e1ab4b", city_name: "بالي", hotel_name: "فندق اريادوتا بالي", rooms_count: 1, manual_currency: "SAR" }],
    flights,
    transport_plan: { tours: leg, airport: { ...leg, enabled: over.airport ?? true }, intercity: { ...leg, enabled: false, mode: "car", modes: ["car"], hop_modes: {} } },
  } as unknown as Record<string, unknown>);
}

describe("the pull on AD-2-3599 — the owner's evaluation (2026-10-18)", () => {
  const transfers = (data: DraftData) => planBookingsFromDraft(data, "").filter((r) => r.kind === "transport");

  it("books the drive to the airport though the farewell was taken off the card — and says so", () => {
    const rows = transfers(bali());
    expect(rows.map((r) => [r.title, r.start_date])).toEqual([
      ["المطار ← فندق بالي", "2026-10-07"],
      ["فندق بالي ← المطار", "2026-10-18"],
    ]);
    expect(rows[1].detail[NOTICE]).toBe(FAREWELL_UNSOLD);
    expect(rows[1].detail["الوقت"]).toBe(LATER);
    expect(rows[0].detail[NOTICE]).toBeUndefined();
  });

  it("adds no farewell of its own where the offer has one, nor where it books no airport drives or no flight home", () => {
    const own = planBookingsFromDraft(malaysia(), "").filter((r) => r.kind === "transport" && r.title.endsWith("← المطار"));
    expect(own.map((r) => r.detail[NOTICE])).toEqual([undefined, undefined]);
    expect(transfers(bali({ airport: false }))).toEqual([]);
    const home = bali();
    home.flights = home.flights.filter((f) => f.leg_order !== "inbound");
    expect(transfers(home).map((r) => r.title)).toEqual(["المطار ← فندق بالي"]);
  });

  it("never sets a tour off at 09:00 on the day the group lands — «يُحدَّد لاحقاً» and a notice while the landing is unknown", () => {
    const tours = planBookingsFromDraft(bali(), "").filter((r) => r.origin_ref.startsWith("tour:"));
    expect(tours.map((t) => [t.start_date, t.detail[DRV.start], t.detail[NOTICE] ?? null])).toEqual([
      ["2026-10-07", LATER, ARRIVAL_DAY_TOUR],
      ["2026-10-08", "09:00", null],
      // «جولة قبل المغادرة» on the day home: no 09:00 either while the take-off is unknown
      ["2026-10-18", LATER, DEPARTURE_DAY_TOUR],
    ]);
  });

  it("ends a tour on the day home four hours before a known take-off — earlier than 09:00 if it must, else «يُحدَّد لاحقاً»", () => {
    const home = (departure_at: string) => {
      const data = bali({ flights: [{}, { flight_no: "GA880", departure_at }] });
      return planBookingsFromDraft(data, "").filter((r) => r.origin_ref.startsWith("tour:")).at(-1)!;
    };
    const late = home("2026-10-18T22:00");
    expect([late.start_date, late.detail[DRV.start], late.detail[NOTICE]]).toEqual(["2026-10-18", "09:00", DEPARTURE_DAY_TOUR]);
    // 15:30 take-off: back by 11:30, so off at 07:30
    expect(home("2026-10-18T15:30").detail[DRV.start]).toBe("07:30");
    // 13:00: it would have to leave at 05:00
    expect(home("2026-10-18T13:00").detail[DRV.start]).toBe(LATER);
  });

  it("sets it off three hours after a known landing", () => {
    const data = bali({ flights: [{ flight_no: "GA881", departure_at: "2026-10-07T01:10", arrival_at: "2026-10-07T14:30" }] });
    const first = planBookingsFromDraft(data, "").find((r) => r.origin_ref.startsWith("tour:"))!;
    expect([first.start_date, first.detail[DRV.start], first.detail[NOTICE]]).toEqual(["2026-10-07", "17:30", ARRIVAL_DAY_TOUR]);
    // landing too late for the day: left for operations to time
    const late = bali({ flights: [{ flight_no: "GA881", departure_at: "2026-10-07T10:00", arrival_at: "2026-10-07T22:40" }] });
    expect(planBookingsFromDraft(late, "").find((r) => r.origin_ref.startsWith("tour:"))!.detail[DRV.start]).toBe(LATER);
  });

  it("carries the catalogue hotel on the stay, so its address is its own and not a namesake's", () => {
    const stay = planBookingsFromDraft(bali(), "").find((r) => r.kind === "hotel")!;
    expect(stay.detail[HOTEL_ID_KEY]).toBe("51e1ab4b");
  });
});

describe("one bad hotel line never fails the whole pull (owner's order B6)", () => {
  it("gives a line held by two stops of one city's name a ref per visit", () => {
    // KL → Langkawi → KL, its hotel line written before stops had keys: it belongs to both KL stops by name
    const data = malaysia();
    data.cities = [...data.cities, { ...data.cities[0], key: "كوالالمبور#2", nights: 1, check_in: "2026-11-27", check_out: "2026-11-28", tours: 0, tour_picks: [] }];
    data.hotels = data.hotels.map((h) => (h.city_name === "كوالالمبور" ? { ...h, city_key: undefined } : h));
    const id = data.hotels.find((h) => h.city_name === "كوالالمبور")!.id;
    const refs = planBookingsFromDraft(data, "")
      .filter((r) => r.kind === "hotel")
      .map((r) => r.origin_ref);
    expect(refs.filter((r) => r.startsWith(`stay:${id}`))).toEqual([`stay:${id}`, `stay:${id}#2`]);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("what a hand-typed booking stands for (owner's order B3–B4)", () => {
  const plan = planBookingsFromDraft(bali(), "");
  const row = (p: Partial<ExistingBooking>): ExistingBooking => ({ origin_ref: null, kind: "hotel", city_name: "", start_date: null, end_date: null, status: "pending", ...p });

  it("an empty city is no city — a hotel typed without one swallows no stay of its day", () => {
    const { fresh, links } = newBookings(plan, [row({ id: "typed", title: "فندق مضاف", start_date: "2026-10-07", end_date: "2026-10-18" })]);
    expect(fresh.map((r) => r.origin_ref)).toContain("stay:stay-fx928rg2");
    expect(links).toEqual([]);
  });

  it("the same day alone does not make two hotels one — another named hotel of the city is added, not merged", () => {
    const { fresh, links } = newBookings(plan, [row({ id: "second", title: "فندق آخر في بالي", city_name: "بالي", start_date: "2026-10-07", end_date: "2026-10-18" })]);
    expect(fresh.map((r) => r.origin_ref)).toContain("stay:stay-fx928rg2");
    expect(links).toEqual([]);
  });

  it("still links the same hotel typed by hand — by its catalogue id under another spelling, or by its name", () => {
    const byId = newBookings(plan, [row({ id: "a", title: "Ariaduta Bali", city_name: "بالي", start_date: "2026-10-07", detail: { [HOTEL_ID_KEY]: "51e1ab4b" } })]);
    expect(byId.links).toEqual([{ id: "a", origin_ref: "stay:stay-fx928rg2" }]);
    const byName = newBookings(plan, [row({ id: "b", title: "فندق اريادوتا بالي - غرفة ديلوكس", city_name: "بالي", start_date: "2026-10-07" })]);
    expect(byName.links).toEqual([{ id: "b", origin_ref: "stay:stay-fx928rg2" }]);
    // two catalogue ids are two hotels, whatever the names say
    const other = newBookings(plan, [row({ id: "c", title: "فندق اريادوتا بالي", city_name: "بالي", start_date: "2026-10-07", detail: { [HOTEL_ID_KEY]: "another" } })]);
    expect(other.links).toEqual([]);
  });

  it("compares the old pull's «hotel:» rows stay by stay: the stay it is links, the others are still pulled", () => {
    const stays = planBookingsFromDraft(malaysia(), "").filter((r) => r.kind === "hotel");
    const lines = [{ id: "oh1", hotel_id: null, hotel_name: "بولمان سيتي سنتر", check_in: "2026-11-20" }];
    const cities = [
      { id: "c1", city_name: "كوالالمبور", check_in: "2026-11-20", check_out: "2026-11-24", hotel_name: "بولمان سيتي سنتر" },
      { id: "c2", city_name: "لنكاوي", check_in: "2026-11-24", check_out: "2026-11-27", hotel_name: "منتجع بيرجايا" },
    ];
    // as the old pull wrote it: no city
    const held = oldPullStays([row({ id: "old", origin_ref: "hotel:oh1", title: "بولمان سيتي سنتر", start_date: "2026-11-20", end_date: "2026-11-24" })], lines, cities);
    expect(held[0].city_name).toBe("كوالالمبور");
    const { fresh, links } = newBookings(stays, held);
    expect(links).toEqual([{ id: "old", origin_ref: stays[0].origin_ref }]);
    expect(fresh.map((r) => r.title)).toEqual(["منتجع بيرجايا"]);
  });
});

describe("the offer's own hotel line (owner's order B2, B5)", () => {
  const cities = [
    { id: "c1", city_name: "بونشاك", check_in: "2026-10-31", check_out: "2026-11-03", hotel_name: null },
    { id: "c2", city_name: "بالي", check_in: "2026-11-03", check_out: "2026-11-07", hotel_name: "نوفوتيل بالي" },
  ];

  it("finds an offer_hotels row's city — its stop, its printed hotel, its dates", () => {
    expect(offerHotelCity({ offer_city_id: "c1", hotel_name: "x", check_in: null }, cities)).toBe("بونشاك");
    expect(offerHotelCity({ hotel_name: "نوفوتيل بالي", check_in: null }, cities)).toBe("بالي");
    expect(offerHotelCity({ hotel_name: "فندق", check_in: "2026-11-01" }, cities)).toBe("بونشاك");
    expect(offerHotelCity({ hotel_name: "فندق", check_in: "2026-12-01" }, cities)).toBe("");
  });

  it("takes the rate of the booking's OWN hotel — never the offer's first", () => {
    const lines = [
      { hotel_id: "h-a", hotel_name: "فندق أ", check_in: "2026-10-31", check_out: "2026-11-03", rate_key: "RATE-A", city: "بونشاك" },
      { hotel_id: "h-b", hotel_name: "فندق ب", check_in: "2026-11-03", check_out: "2026-11-07", rate_key: "RATE-B", city: "بالي" },
    ];
    const b = { title: "فندق ب", city_name: "بالي", start_date: "2026-11-03", end_date: "2026-11-07" };
    expect(offerHotelFor(b, lines)?.rate_key).toBe("RATE-B");
    expect(offerHotelFor({ ...b, title: "Hotel B", detail: { [HOTEL_ID_KEY]: "h-b" } }, lines)?.rate_key).toBe("RATE-B");
    // a hotel the offer never priced, or the right name on other dates: none — refused, not borrowed
    expect(offerHotelFor({ ...b, title: "فندق ج" }, lines)).toBeNull();
    expect(offerHotelFor({ ...b, start_date: "2026-11-04" }, lines)).toBeNull();
    // two lines it could be: refused as well
    expect(offerHotelFor(b, [...lines, { ...lines[1], rate_key: "RATE-B2" }])).toBeNull();
  });
});

describe("flights the package did not sell, or only planned (the evaluator, 2026-10-22)", () => {
  it("books no flight whose scope is off", () => {
    const data = malaysia();
    data.scope = { ...data.scope, flights_intl: false, flights_domestic: false };
    expect(planBookingsFromDraft(data, "").filter((r) => r.kind === "flight")).toEqual([]);
  });

  it("turns a planned-only booking into one «طيران مطلوب» with no route and no clock", () => {
    const data = malaysia();
    // the Basic default: MED to the gateway at midnight, no number
    data.flights = [
      { ...emptyFlight("outbound"), from_airport: "مطار المدينة (MED)", to_airport: "مطار إسطنبول (IST)", to_city: "إسطنبول", departure_at: "2026-11-20T00:00" },
      { ...emptyFlight("inbound"), from_airport: "مطار إسطنبول (IST)", to_airport: "مطار المدينة (MED)", from_city: "إسطنبول", departure_at: "2026-11-27T00:00" },
      { ...emptyFlight("internal"), auto: true, from_airport: "KUL", to_airport: "LGK", departure_at: "2026-11-24T00:00" },
    ];
    const rows = planBookingsFromDraft(data, "");
    const intl = rows.find((r) => r.origin_ref === "flight:intl")!;
    expect(intl.title).toBe(`طيران دولي — ${FLIGHT_NEEDED}`);
    expect([intl.start_date, intl.end_date]).toEqual(["2026-11-20", data.trip.departure_date]);
    expect(Object.keys(intl.detail)).toEqual(["الركاب"]);
    expect(rows.find((r) => r.origin_ref === "flight:dom")!.title).toBe(`طيران داخلي — ${FLIGHT_NEEDED}`);
    // no drive is timed from a planned flight
    expect(JSON.stringify(rows)).not.toMatch(/00:00|MED/);
  });

  it("keeps the real legs and says a planned one is to be set", () => {
    const data = malaysia();
    const back = data.flights.findIndex((f) => f.leg_order === "inbound");
    data.flights[back] = { ...data.flights[back], flight_no: "", departure_at: "2026-11-27T00:00", arrival_at: null };
    const intl = planBookingsFromDraft(data, "").find((r) => r.origin_ref === "flight:intl")!;
    expect(intl.detail["العودة"]).toBe(LATER);
    expect(intl.title).toBe("طيران دولي RUH → KUL");
  });
});

describe("a ticket names its booking (the evaluator, 2026-10-22)", () => {
  it("chains connected legs and breaks at a gap", () => {
    expect(ticketTitle("flight:intl", [{ from: "RUH", to: "IST" }, { from: "IST", to: "TZX" }, { from: "TZX", to: "RUH" }])).toBe("طيران دولي RUH → IST → TZX → RUH");
    expect(ticketTitle("flight:intl", [{ from: "JED", to: "IST" }, { from: "TZX", to: "JED" }])).toBe("طيران دولي JED → IST · TZX → JED");
    expect(ticketTitle("flight:dom", [{ from: "IST", to: "TZX" }])).toBe("طيران داخلي IST → TZX");
    expect(ticketTitle("flight:abc", [{ from: "IST", to: "TZX" }])).toBe("طيران IST → TZX");
  });
});
