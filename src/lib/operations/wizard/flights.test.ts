import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { parseTicketText, ticketNumbersIn } from "@/lib/flights/ticket-parse";
import { DRV, flightLegs, retimeTransfers } from "@/lib/operations/drivers";
import { sanitizeTicket } from "@/lib/flights/ticket-parse";
import type { LookupAirport } from "@/lib/offer/draft-types";
import {
  airportCode,
  badLeg,
  checkNames,
  compareName,
  flightsReadiness,
  flightsState,
  isoAt,
  landingDay,
  plannedLegs,
  plannedLine,
  skeleton,
  toFlightLegs,
  uniqueLegs,
  ownLegs,
  withTicketLines,
} from "./flights";
import type { WizardCase } from "./types";

const booking = (p: Partial<OperationBooking>): OperationBooking =>
  ({ id: "b", kind: "flight", status: "pending", title: "", detail: {}, pnr: null, ticket_numbers: [], flight_legs: [], ...p }) as OperationBooking;
const wcase = (bookings: OperationBooking[]) => ({ bookings }) as unknown as WizardCase;

const LEG = { flight_no: "TK2810", from: "IST", to: "TZX", departs_at: "2026-10-20T08:15:00+03:00", arrives_at: "2026-10-20T10:05:00+03:00" };
const TICKETED = { status: "confirmed" as const, pnr: "M3TQ8Z", ticket_numbers: ["065-2400000003"], flight_legs: [LEG] };

describe("the step's state and «التذاكر»", () => {
  it("has nothing to do on a file without flights, and ignores a cancelled one", () => {
    expect(flightsState(wcase([booking({ kind: "hotel" }), booking({ status: "cancelled" })]))).toBe("na");
    expect(flightsReadiness(wcase([]))).toEqual([]);
  });

  it("is done when every flight is confirmed with the airline's reference — the one rule, client-booking-state flightTicketed", () => {
    const one = booking({ id: "a", ...TICKETED });
    expect(flightsState(wcase([one]))).toBe("done");
    expect(flightsReadiness(wcase([one]))).toEqual([{ step: "flights", key: "tickets", ok: true }]);
    // «تسجيل يدوي» in «عرض الكل» with «صدرت التذكرة»: done here too (the owner, 2026-10-18)
    const byHand = booking({ id: "b", status: "confirmed", confirmation_number: "6XK2QZ", is_paid: true });
    expect(flightsState(wcase([one, byHand]))).toBe("done");
    // the same with the seat only held (no ticket) is still open
    expect(flightsState(wcase([one, booking({ id: "h", status: "confirmed", confirmation_number: "6XK2QZ", is_paid: false })]))).toBe("todo");
    // not confirmed, or confirmed with nothing on it, is still open
    expect(flightsState(wcase([one, booking({ id: "c", pnr: "M3TQ8Z" })]))).toBe("todo");
    expect(flightsReadiness(wcase([one, booking({ id: "d", status: "confirmed", confirmation_number: null })]))[0].ok).toBe(false);
  });
});

/** Every name and reference in the fixtures is invented. */
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../flights/fixtures/${name}`, import.meta.url)), "utf8");

describe("ticket numbers", () => {
  it("reads one per passenger off an Amadeus FA line, a Saudia receipt and a Sabre TE line", () => {
    expect(ticketNumbersIn(fixture("amadeus-pnr.txt"))).toEqual(["065-2400000001"]);
    expect(ticketNumbersIn(fixture("saudia-eticket.txt"))).toEqual(["065-2400000003"]);
    expect(ticketNumbersIn(fixture("sabre-itinerary.txt"))).toEqual(["000-2400000002"]);
  });

  it("takes thirteen digits only — not a phone, a card or the next coupon", () => {
    expect(ticketNumbersIn("E-TKT 157-2412345678/79  157 2412345679\nرقم التذكرة: ١٥٧٢٤١٢٣٤٥٦٨٠")).toEqual(["157-2412345678", "157-2412345679", "157-2412345680"]);
    expect(ticketNumbersIn("Mobile +966 501234567 · 00966501234567 · card 4111111111111111")).toEqual([]);
  });
});

describe("the legs as stored", () => {
  it("adds each airport's own offset — DST included — and keeps only the wall clock where no zone is known", () => {
    expect(isoAt("2026-11-20", "01:00", "Asia/Riyadh")).toBe("2026-11-20T01:00:00+03:00");
    expect(isoAt("2026-07-01", "09:30", "Europe/London")).toBe("2026-07-01T09:30:00+01:00");
    expect(isoAt("2026-12-01", "09:30", "Europe/London")).toBe("2026-12-01T09:30:00+00:00");
    expect(isoAt("2026-11-20", "14:30", "Asia/Kolkata")).toBe("2026-11-20T14:30:00+05:30");
    expect(isoAt("2026-11-20", "14:30", null)).toBe("2026-11-20T14:30:00");
    expect(isoAt("2026-11-20", "", "Asia/Riyadh")).toBeNull();
  });

  it("lands an overnight flight the next day from the clocks — no «same day» assumption (the owner, 2026-10-22)", () => {
    const zone = (c: string) => ({ RUH: "Asia/Riyadh", IST: "Europe/Istanbul", MED: "Asia/Riyadh", KUL: "Asia/Kuala_Lumpur" })[c] ?? null;
    const [overnight] = toFlightLegs([{ flight_no: "SV 260", from_iata: "IST", to_iata: "RUH", dep_date: "2026-11-28", dep_time: "22:35", arr_date: "", arr_time: "04:20" }], zone);
    expect(overnight).toEqual({ flight_no: "SV260", from: "IST", to: "RUH", departs_at: "2026-11-28T22:35:00+03:00", arrives_at: "2026-11-29T04:20:00+03:00" });
    expect(badLeg(overnight)).toBe(false);
    // MED 23:00 → KUL 13:00 is the next day by the two zones; a short hop lands the day it left
    const leg = { flight_no: "SV836", from_iata: "MED", to_iata: "KUL", dep_date: "2026-11-05", dep_time: "23:00", arr_date: "", arr_time: "13:00" };
    expect(landingDay(leg, zone)).toBe("2026-11-06");
    expect(landingDay({ ...leg, dep_time: "01:00", arr_time: "14:30" }, zone)).toBe("2026-11-05");
    // no zone known: a landing clock earlier than the take-off is the next day
    expect(landingDay({ ...leg, from_iata: "XXX", to_iata: "YYY" }, zone)).toBe("2026-11-06");
    // a typed arrival day is the agent's
    expect(landingDay({ ...leg, arr_date: "2026-11-07" }, zone)).toBe("2026-11-07");
  });

  it("refuses a leg the drivers can't be timed from — and no 22-hour rule", () => {
    const zone = (c: string) => ({ RUH: "Asia/Riyadh", IST: "Europe/Istanbul" })[c] ?? null;
    const [fixed] = toFlightLegs([{ flight_no: "SV260", from_iata: "IST", to_iata: "RUH", dep_date: "2026-11-28", dep_time: "22:35", arr_date: "2026-11-29", arr_time: "04:20" }], zone);
    expect(badLeg(fixed)).toBe(false);
    expect(badLeg({ ...fixed, flight_no: "" })).toBe(true);
    expect(badLeg({ ...fixed, arrives_at: null })).toBe(true);
    expect(badLeg({ ...fixed, to: "" })).toBe(true); // an airport we could not name
    expect(badLeg({ ...fixed, arrives_at: "2026-11-28T20:00:00+03:00" })).toBe(true); // lands before it left
    expect(badLeg({ ...fixed, arrives_at: "2026-11-30T06:00:00+03:00" })).toBe(false); // 31 h — a long journey, not refused
    expect(badLeg({ ...fixed, arrives_at: "2026-12-02T04:20:00+03:00" })).toBe(true); // four days on: a mistyped date
  });

  it("keeps one PNR per leg through the save's sanitising — a domestic hop bought on its own", () => {
    const clean = sanitizeTicket({
      pnr: "m3tq8z",
      legs: [
        { flight_no: "TK2810", from_iata: "IST", to_iata: "TZX", dep_date: "2026-10-20", dep_time: "08:15", arr_time: "10:05", pnr: "" },
        { flight_no: "PC2811", from_iata: "TZX", to_iata: "SAW", dep_date: "2026-10-23", dep_time: "11:00", arr_time: "12:50", pnr: "x9k2pq" },
      ],
    });
    expect(clean.legs.map((l) => l.pnr)).toEqual([undefined, "X9K2PQ"]);
    const legs = toFlightLegs(clean.legs, () => "Europe/Istanbul");
    expect(legs[0]).not.toHaveProperty("pnr");
    expect(legs[1].pnr).toBe("X9K2PQ");
  });
});

describe("the offer's planned legs (the owner, 2026-10-22: «التفاصيل المدخلة لا تمت بصلة»)", () => {
  const AIRPORTS: LookupAirport[] = [
    { id: "1", name: "مطار إسطنبول", code: "IST", timezone: "Europe/Istanbul", city: "إسطنبول", country: "تركيا", name_en: "Istanbul Airport" },
    { id: "2", name: "مطار طرابزون", code: "TZX", timezone: "Europe/Istanbul", city: "طرابزون", country: "تركيا", name_en: "Trabzon Airport" },
  ];
  const detail = {
    الذهاب: "SV834 · RUH → KUL · 2026-11-20 00:00",
    "رحلة 2": "— · IST → TZX · 2026-11-24 يُحدَّد لاحقاً",
    العودة: "SV835 · KUL → RUH · 2026-11-28 01:00 · الوصول 2026-11-28 04:30",
    الدرجة: "اقتصادية",
  };

  it("starts the form from the plan: its day kept, a placeholder midnight or «يُحدَّد لاحقاً» left empty", () => {
    expect(plannedLegs(detail)).toEqual([
      { flight_no: "SV834", from_iata: "RUH", to_iata: "KUL", dep_date: "2026-11-20", dep_time: "", arr_date: "", arr_time: "" },
      { flight_no: "", from_iata: "IST", to_iata: "TZX", dep_date: "2026-11-24", dep_time: "", arr_date: "", arr_time: "" },
      { flight_no: "SV835", from_iata: "KUL", to_iata: "RUH", dep_date: "2026-11-28", dep_time: "01:00", arr_date: "2026-11-28", arr_time: "04:30" },
    ]);
  });

  it("prints a planned leg readably — the number when there is one, never a 00:00", () => {
    const [first, second, back] = plannedLegs(detail);
    expect(plannedLine(first)).toBe("SV834 · RUH → KUL · 2026-11-20 يُحدَّد لاحقاً");
    expect(plannedLine(second, (c) => `${AIRPORTS.find((a) => a.code === c)?.city} (${c})`)).toBe("إسطنبول (IST) → طرابزون (TZX) · 2026-11-24 يُحدَّد لاحقاً");
    expect(plannedLine(back)).toBe("SV835 · KUL → RUH · 2026-11-28 01:00 · الوصول 2026-11-28 04:30");
  });

  it("names an airport by its code, its name or its city — hamza folded", () => {
    expect(airportCode("ist", AIRPORTS)).toBe("IST");
    expect(airportCode("اسطنبول", AIRPORTS)).toBe("IST");
    expect(airportCode("مطار طرابزون (TZX)", AIRPORTS)).toBe("TZX");
    expect(airportCode("Trabzon Airport", AIRPORTS)).toBe("TZX");
    expect(airportCode("JED", AIRPORTS)).toBe("JED"); // a code we hold no row for still goes as typed
    expect(airportCode("مدينة لا نعرفها", AIRPORTS)).toBe("");
  });
});

describe("the ticket times the drivers (the trial case AD-2-7287: IST → TZX · TZX → IST, «يُحدَّد»)", () => {
  const seeded = {
    "رحلة 1": "— · IST → TZX · 2026-10-20 يُحدَّد لاحقاً",
    "رحلة 2": "— · TZX → IST · 2026-10-23 يُحدَّد لاحقاً",
    الدرجة: "اقتصادية",
    الركاب: "2 بالغ",
  };
  const later = "يُحدَّد لاحقاً";
  const reception = { id: "r", kind: "transport", title: "المطار ← فندق طرابزون", start_date: "2026-10-20", detail: { [DRV.time]: later, [DRV.flight]: "— IST → TZX" } };
  const farewell = { id: "f", kind: "transport", title: "فندق طرابزون ← المطار", start_date: "2026-10-23", detail: { [DRV.time]: later, [DRV.flight]: "— TZX → IST" } };
  const zone = () => "Europe/Istanbul";
  const legs = toFlightLegs(
    [
      { flight_no: "TK2810", from_iata: "IST", to_iata: "TZX", dep_date: "2026-10-20", dep_time: "08:15", arr_date: "", arr_time: "10:05" },
      { flight_no: "TK2811", from_iata: "TZX", to_iata: "IST", dep_date: "2026-10-23", dep_time: "11:00", arr_date: "", arr_time: "12:50" },
    ],
    zone,
  );

  it("rewrites the plan's leg lines under the plan's keys, the rest of the detail kept", () => {
    const detail = withTicketLines(seeded, legs, "20 كجم");
    expect(detail).toEqual({
      "رحلة 1": "TK2810 · IST → TZX · 2026-10-20 08:15 · الوصول 2026-10-20 10:05",
      "رحلة 2": "TK2811 · TZX → IST · 2026-10-23 11:00 · الوصول 2026-10-23 12:50",
      الدرجة: "اقتصادية",
      الركاب: "2 بالغ",
      الأمتعة: "20 كجم",
    });
    expect(flightLegs(detail).map((l) => l.leg.departure)).toEqual(["2026-10-20T08:15", "2026-10-23T11:00"]);
    // a flight typed by hand in the older one-leg form gives way to the ticket's line
    const typed = { من: "مطار كوالالمبور الدولي (KUL)", إلى: "مطار لنكاوي الدولي (LGK)", "الإقلاع": "2026-11-24 10:00", "رقم الرحلة": "MH1430", الدرجة: "سياحية" };
    expect(withTicketLines(typed, [legs[0]])).toEqual({ الدرجة: "سياحية", "رحلة 1": "TK2810 · IST → TZX · 2026-10-20 08:15 · الوصول 2026-10-20 10:05" });
  });

  it("fills the reception (landing + 45 min) and the drop-off (take-off − 2 h, domestic) through flight-follow's rule", () => {
    const detail = withTicketLines(seeded, legs);
    const moved = retimeTransfers({ title: "طيران داخلي IST → TZX · TZX → IST", detail }, seeded, [reception, farewell]);
    expect(moved).toEqual([
      { id: "r", start_date: "2026-10-20", detail: { [DRV.time]: "10:50", [DRV.flight]: "TK2810 IST → TZX" } },
      { id: "f", start_date: "2026-10-23", detail: { [DRV.time]: "09:00", [DRV.flight]: "TK2811 TZX → IST" } },
    ]);
  });

  it("finds the drive on a ticket that connects where the plan flew direct — never another journey's", () => {
    const plan = { الذهاب: "— · RUH → DPS · 2026-11-20 يُحدَّد لاحقاً", العودة: "— · DPS → RUH · 2026-11-27 يُحدَّد لاحقاً" };
    const ticket = toFlightLegs(
      [
        { flight_no: "SV834", from_iata: "RUH", to_iata: "KUL", dep_date: "2026-11-20", dep_time: "01:00", arr_date: "", arr_time: "14:30" },
        { flight_no: "MH851", from_iata: "KUL", to_iata: "DPS", dep_date: "2026-11-20", dep_time: "16:30", arr_date: "", arr_time: "19:25" },
        { flight_no: "MH850", from_iata: "DPS", to_iata: "KUL", dep_date: "2026-11-27", dep_time: "20:00", arr_date: "", arr_time: "23:00" },
        { flight_no: "SV835", from_iata: "KUL", to_iata: "RUH", dep_date: "2026-11-28", dep_time: "01:00", arr_date: "", arr_time: "04:30" },
      ],
      () => null,
    );
    const arrive = { id: "r", kind: "transport", title: "المطار ← فندق بالي", start_date: "2026-11-20", detail: { [DRV.time]: later, [DRV.flight]: "— RUH → DPS" } };
    const leave = { id: "f", kind: "transport", title: "فندق بالي ← المطار", start_date: "2026-11-27", detail: { [DRV.time]: later, [DRV.flight]: "— DPS → RUH" } };
    const moved = retimeTransfers({ title: "طيران دولي RUH ⇄ DPS", detail: withTicketLines(plan, ticket) }, plan, [arrive, leave]);
    expect(moved.map((m) => [m.id, m.start_date, m.detail[DRV.time], m.detail[DRV.flight]])).toEqual([
      ["r", "2026-11-20", "20:10", "MH851 KUL → DPS"],
      ["f", "2026-11-27", "17:00", "MH850 DPS → KUL"],
    ]);
    // the domestic ticket's return into IST is not the international arrival's flight
    const intlReception = { ...reception, title: "المطار ← فندق اسطنبول", detail: { [DRV.time]: later, [DRV.flight]: "— MED → IST" } };
    expect(retimeTransfers({ title: "طيران داخلي IST → TZX · TZX → IST", detail: withTicketLines(seeded, legs) }, seeded, [intlReception])).toEqual([]);
  });
});

describe("the names on the ticket against the passports", () => {
  it("matches «SURNAME/GIVEN MR» to the passport whatever the order, a title glued on or a name run together", () => {
    expect(compareName("TESTOVA/LAYLA MRS", "Layla Testova")).toBe("ok");
    expect(compareName("ALQAHTANI/MOHAMMEDMR", "MOHAMMED ABDULLAH AL QAHTANI")).toBe("ok");
    expect(compareName("AL QAHTANI/MOHAMMED", "MOHAMMED ALQAHTANI")).toBe("ok");
    expect(compareName("FAHAD TESTUSER", "TESTUSER FAHAD")).toBe("ok");
  });

  it("calls a letter off a mismatch — the airline does", () => {
    expect(compareName("ALQAHTANI/MOHAMED MR", "MOHAMMED ABDULLAH ALQAHTANI")).toBe("mismatch");
    expect(compareName("TESTOV/OMAR MR", "LAYLA TESTOVA")).toBe("mismatch");
    // one shared surname is not the person
    expect(compareName("ALQAHTANI/SARA MS", "MOHAMMED ALQAHTANI")).toBe("mismatch");
  });

  it("is only «likely» for a shorter name we hold, or an Arabic one that sounds like the ticket", () => {
    expect(compareName("BUKHARI/IBTIHAL AHMED MS", "Ibtihal Bukhari")).toBe("likely");
    expect(compareName("ALQAHTANI/MOHAMMED MR", "محمد عبدالله القحطاني")).toBe("likely");
    expect(compareName("ALZAHRANI/FATIMAH MRS", "فاطمة الزهراني")).toBe("likely");
    expect(compareName("ALOTAIBI/ABDULAZIZ MR", "عبد العزيز العتيبي")).toBe("likely");
    expect(compareName("ALQAHTANI/MOHAMMED MR", "أحمد القحطاني")).toBe("mismatch");
    expect(compareName("TESTOVA/LAYLA MRS", "ليلى تيستوفا")).toBe("likely");
    expect(compareName("TESTOVA/LAYLA MRS", "ريم تيستوفا")).toBe("mismatch");
    expect([skeleton("محمد"), skeleton("MOHAMMED"), skeleton("MUHAMMAD"), skeleton("أحمد")]).toEqual(["MHMD", "MHMD", "MHMD", "HMD"]);
  });

  it("pairs each name with one traveller — the surest first — and names the travellers the ticket left out", () => {
    const ticket = parseTicketText(fixture("amadeus-pnr.txt"), new Date("2026-10-15T00:00:00Z"));
    expect(ticket.passengers).toEqual(["LAYLA TESTOVA", "OMAR TESTOV"]);
    const travelers = [
      { id: "t1", label: "ليلى تيستوفا", names: ["ليلى تيستوفا", "LAYLA TESTOVA"] },
      { id: "t2", label: "OMAR TESTOVV", names: ["OMAR TESTOVV"] },
      { id: "t3", label: "", names: [] },
    ];
    const { names, missing } = checkNames(ticket.passengers, travelers);
    expect(names).toEqual([
      { name: "LAYLA TESTOVA", traveler_id: "t1", traveler: "ليلى تيستوفا", status: "ok" },
      { name: "OMAR TESTOV", traveler_id: null, traveler: null, status: "mismatch" },
    ]);
    expect(missing).toEqual(["OMAR TESTOVV", ""]);
  });
});

describe("each flight once (AD-5-3269, 2026-10-22)", () => {
  const leg = (flight_no: string, from: string, to: string, departs_at: string | null) => ({ flight_no, from, to, departs_at, arrives_at: null });
  it("keeps the carrier's «XY309» over the plan's «309», and a numbered leg over a blank one", () => {
    const legs = [
      leg("XY309", "RUH", "TBS", "2026-10-30T07:05:00+03:00"),
      leg("XY310", "TBS", "RUH", "2026-11-08T13:10:00+04:00"),
      leg("309", "RUH", "TBS", "2026-10-30T07:05:00+03:00"),
      leg("", "TBS", "RUH", "2026-11-08T00:00:00+04:00"),
    ];
    expect(uniqueLegs(legs).map((l) => l.flight_no)).toEqual(["XY309", "XY310"]);
    expect(uniqueLegs([leg("309", "RUH", "TBS", "2026-10-30T07:05"), leg("XY309", "RUH", "TBS", "2026-10-30T07:05")]).map((l) => l.flight_no)).toEqual(["XY309"]);
  });
  it("keeps two real flights on the same route and day", () => {
    expect(uniqueLegs([leg("SV1020", "RUH", "JED", "2026-10-30T07:00"), leg("SV1030", "RUH", "JED", "2026-10-30T19:00")])).toHaveLength(2);
  });
});

describe("our own ticket, uploaded again (2026-10-23)", () => {
  it("reads each leg from its Latin line, the arrival too — and nothing from another ticket", () => {
    const text = "TBS\n13:10\nXY309 · RUH → TBS · 2026-10-30 07:05 · ARR 2026-10-30 12:00\nC98TNC";
    expect(ownLegs(text).map((l) => [l.flight_no, l.from_iata, l.to_iata, l.dep_date, l.dep_time, l.arr_date, l.arr_time])).toEqual([["XY309", "RUH", "TBS", "2026-10-30", "07:05", "2026-10-30", "12:00"]]);
    expect(ownLegs("Flight XY309 RUH Riyadh - TBS Tbilisi 30OCT26 07:05")).toEqual([]);
  });
});
