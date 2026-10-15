import { describe, expect, it } from "vitest";
import { addStay, deriveTransportRows, emptyDraftData, emptyFlight, normalizeDraftData, type DraftData, type DraftFlight } from "@/lib/offer/draft-types";
import { BOARD_AR } from "@/components/offer-doc/labels";
import { addCity, withTours } from "@/lib/offer/basic";
import { newBookings, planBookingsFromDraft, type ExistingBooking } from "./seed-plan";
import { carText, DRV } from "./drivers";

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
