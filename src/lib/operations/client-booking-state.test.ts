import { describe, expect, it } from "vitest";
import { clientFlight, clientHotel, hotelAtRisk, hotelFinal, preparedMessages, voucherLive, type ClientBookingRow } from "./client-booking-state";

const hotel = (over: Partial<ClientBookingRow> = {}): ClientBookingRow => ({
  id: "h1",
  kind: "hotel",
  title: "فندق هيلتون بومونتي",
  city_name: "إسطنبول",
  start_date: "2026-10-20",
  end_date: "2026-10-23",
  status: "pending",
  confirmation_number: null,
  company_ref: "AD-2-7287-20261012-H1",
  detail: { "نوع الغرفة": "ديلوكس × 2", "الإقامة": "شامل الإفطار", "عدد الليالي": "3", room_spec: "{}" },
  ...over,
});

const flight = (over: Partial<ClientBookingRow> = {}): ClientBookingRow => ({
  id: "f1",
  kind: "flight",
  title: "الرياض → إسطنبول",
  city_name: "",
  start_date: "2026-10-20",
  end_date: null,
  status: "pending",
  confirmation_number: null,
  company_ref: "AD-2-7287-20261012-F1",
  pnr: null,
  ticket_numbers: [],
  flight_legs: [],
  is_paid: false,
  detail: { "رقم الرحلة": "TK145", "من": "RUH", "إلى": "IST", "الإقلاع": "2026-10-20 08:30", "الدرجة": "اقتصادية" },
  ...over,
});

describe("a hotel on the client's link", () => {
  it("before the hotel's own confirmation: the name, the dates and OUR number — nothing called provisional, no rooms", () => {
    const h = clientHotel(hotel());
    expect(h).toMatchObject({ name: "فندق هيلتون بومونتي", check_in: "2026-10-20", check_out: "2026-10-23", ref: "AD-2-7287-20261012-H1", confirmation: null, rooms: [] });
  });

  it("«confirmed» with no number, or with our own number, is not the hotel's confirmation", () => {
    expect(hotelFinal(hotel({ status: "confirmed", confirmation_number: null }))).toBe(false);
    expect(hotelFinal(hotel({ status: "confirmed", confirmation_number: "  " }))).toBe(false);
    expect(hotelFinal(hotel({ status: "confirmed", confirmation_number: "AD-2-7287-20261012-H1" }))).toBe(false);
    expect(hotelFinal(hotel({ status: "pending", confirmation_number: "HTL-1" }))).toBe(false);
  });

  it("once it is in: the hotel's number and the rooms, our number kept", () => {
    const h = clientHotel(hotel({ status: "confirmed", confirmation_number: " HTL-7781 " }));
    expect(h.confirmation).toBe("HTL-7781");
    expect(h.ref).toBe("AD-2-7287-20261012-H1");
    expect(h.rooms).toEqual(["نوع الغرفة: ديلوكس × 2", "الإقامة: شامل الإفطار"]);
  });
});

describe("a flight on the client's link", () => {
  it("before the ticket: «سيتم تأكيد الحجز» — our number, no PNR, no flight number, no time", () => {
    const f = clientFlight(flight({ status: "pending", pnr: "X7K2QZ" }));
    expect(f).toMatchObject({ ticketed: false, pnr: null, legs: [], ref: "AD-2-7287-20261012-F1" });
  });

  it("the wizard's ticket in: the PNR and the legs as read off the ticket", () => {
    const f = clientFlight(
      flight({ status: "confirmed", confirmation_number: "X7K2QZ", pnr: "X7K2QZ", flight_legs: [{ flight_no: "TK145", from: "RUH", to: "IST", departs_at: "2026-10-20T08:30:00+03:00", arrives_at: "2026-10-20T12:40:00+03:00" }] }),
    );
    expect(f.ticketed).toBe(true);
    expect(f.pnr).toBe("X7K2QZ");
    expect(f.legs).toEqual([{ flight_no: "TK145", from: "RUH", to: "IST", departure: "2026-10-20T08:30:00+03:00", arrival: "2026-10-20T12:40:00+03:00", label: "" }]);
  });

  it("ticket numbers alone count as the ticket", () => {
    expect(clientFlight(flight({ status: "confirmed", ticket_numbers: ["0652400000001"] })).ticketed).toBe(true);
  });

  it("a flight confirmed by hand («تسجيل يدوي»): ticketed once marked «صدرت التذكرة», its number as the PNR, legs from its detail", () => {
    const f = clientFlight(flight({ status: "confirmed", confirmation_number: "PNR-6XK2QZ", is_paid: true }));
    expect(f).toMatchObject({ ticketed: true, pnr: "PNR-6XK2QZ" });
    // a held seat (its number, no ticket) stays «سيتم تأكيد الحجز»
    expect(clientFlight(flight({ status: "confirmed", confirmation_number: "PNR-6XK2QZ", is_paid: false })).ticketed).toBe(false);
    expect(f.legs[0]).toMatchObject({ flight_no: "TK145", from: "RUH", to: "IST", departure: "2026-10-20T08:30" });
  });
});

describe("the hotel voucher's gate", () => {
  const confirmed = hotel({ status: "confirmed", confirmation_number: "HTL-7781" });

  it("is handed out while the hotel's own confirmation it prints holds", () => {
    expect(voucherLive([{ confirmation_number: "HTL-7781", start_date: "2026-10-20" }], [confirmed])).toBe(true);
  });

  it("is stale once the number is taken back, replaced, or the dates moved", () => {
    const stay = [{ confirmation_number: "HTL-7781", start_date: "2026-10-20" }];
    expect(voucherLive(stay, [hotel()])).toBe(false);
    expect(voucherLive(stay, [hotel({ status: "confirmed", confirmation_number: "HTL-9999" })])).toBe(false);
    expect(voucherLive(stay, [{ ...confirmed, start_date: "2026-10-21" }])).toBe(false);
  });

  it("never covers a stay printed with our number or with none, and an empty voucher shows nothing", () => {
    expect(voucherLive([{ confirmation_number: "AD-2-7287-20261012-H1", start_date: "2026-10-20" }], [hotel({ status: "confirmed", confirmation_number: "AD-2-7287-20261012-H1" })])).toBe(false);
    expect(voucherLive([{ confirmation_number: null, start_date: "2026-10-20" }], [confirmed])).toBe(false);
    expect(voucherLive([], [confirmed])).toBe(false);
  });

  it("a voucher of two stays goes when either one's confirmation goes", () => {
    const second = hotel({ id: "h2", status: "confirmed", confirmation_number: "HTL-2", start_date: "2026-10-23", end_date: "2026-10-26" });
    const stays = [
      { confirmation_number: "HTL-7781", start_date: "2026-10-20" },
      { confirmation_number: "HTL-2", start_date: "2026-10-23" },
    ];
    expect(voucherLive(stays, [confirmed, second])).toBe(true);
    expect(voucherLive(stays, [confirmed, { ...second, status: "pending", confirmation_number: null }])).toBe(false);
  });
});

describe("red the day before travel", () => {
  it("a hotel on our number alone: red from the day before travel until checked out of", () => {
    expect(hotelAtRisk(hotel(), "2026-10-20", "2026-10-18")).toBe(false);
    expect(hotelAtRisk(hotel(), "2026-10-20", "2026-10-19")).toBe(true);
    expect(hotelAtRisk(hotel(), "2026-10-20", "2026-10-20")).toBe(true);
    expect(hotelAtRisk(hotel(), "2026-10-20", "2026-10-23")).toBe(false);
  });

  it("not once the hotel's own confirmation is in, nor for a cancelled one or a flight", () => {
    expect(hotelAtRisk(hotel({ status: "confirmed", confirmation_number: "HTL-1" }), "2026-10-20", "2026-10-19")).toBe(false);
    expect(hotelAtRisk(hotel({ status: "cancelled" }), "2026-10-20", "2026-10-19")).toBe(false);
    expect(hotelAtRisk(flight(), "2026-10-20", "2026-10-19")).toBe(false);
  });

  it("«confirmed» still on our number is red too", () => {
    expect(hotelAtRisk(hotel({ status: "confirmed", confirmation_number: "AD-2-7287-20261012-H1" }), "2026-10-20", "2026-10-19")).toBe(true);
  });
});

describe("the updates prepared for staff", () => {
  const base = { hello: "عميلنا أحمد،", destination: "تركيا", serial: "AD-2-7287-20261012", link: "https://pkg.traveliun.com/trip/T", voucherStays: [], sent: new Set<string>() };

  it("right after the client confirms: the trip link with our numbers — once", () => {
    const [m, ...rest] = preparedMessages({ ...base, bookings: [hotel(), flight()] });
    expect(rest).toEqual([]);
    expect(m.key).toBe("trip_link");
    expect(m.template).toBe("bookings_confirmed");
    expect(m.body).toContain("• فندق هيلتون بومونتي: AD-2-7287-20261012-H1");
    expect(m.body).toContain("• الرياض → إسطنبول: AD-2-7287-20261012-F1");
    expect(m.body).toContain("https://pkg.traveliun.com/trip/T");
    expect(preparedMessages({ ...base, bookings: [hotel()], sent: new Set(["trip_link"]) })).toEqual([]);
  });

  it("no link (stopped), nothing prepared", () => {
    expect(preparedMessages({ ...base, link: null, bookings: [hotel()] })).toEqual([]);
  });

  it("a ticket in: the PNR and the flights — and again only for a new PNR", () => {
    const ticketed = flight({ status: "confirmed", pnr: "X7K2QZ", flight_legs: [{ flight_no: "TK145", from: "RUH", to: "IST", departs_at: "2026-10-20T08:30:00+03:00", arrives_at: null }] });
    const [m] = preparedMessages({ ...base, bookings: [ticketed], sent: new Set(["trip_link"]) });
    expect(m.key).toBe("flight:f1:X7K2QZ");
    expect(m.template).toBe("booking_update");
    expect(m.body).toContain("رقم الحجز (PNR): X7K2QZ");
    expect(m.body).toContain("• TK145 RUH → IST — ");
    expect(m.body).toContain("08:30");
    expect(preparedMessages({ ...base, bookings: [ticketed], sent: new Set(["trip_link", "flight:f1:X7K2QZ"]) })).toEqual([]);
    expect(preparedMessages({ ...base, bookings: [{ ...ticketed, pnr: "NEW123" }], sent: new Set(["trip_link", "flight:f1:X7K2QZ"]) })[0]?.key).toBe("flight:f1:NEW123");
  });

  it("a hotel's own confirmation: prepared only once its voucher is issued — «تأكيد فندق إسطنبول والفاوتشر»", () => {
    const final = hotel({ status: "confirmed", confirmation_number: "HTL-7781" });
    const sent = new Set(["trip_link"]);
    expect(preparedMessages({ ...base, bookings: [final], sent })).toEqual([]);
    const [m] = preparedMessages({ ...base, bookings: [final], sent, voucherStays: [{ confirmation_number: "HTL-7781", start_date: "2026-10-20" }] });
    expect(m.key).toBe("hotel:h1:HTL-7781");
    expect(m.label).toBe("تأكيد فندق إسطنبول والفاوتشر");
    expect(m.body).toContain("رقم تأكيد الفندق: HTL-7781");
    expect(m.body).toContain("قسيمة الفندق (الفاوتشر) جاهزة في رابط رحلتك");
  });

  it("a hotel still on our number prepares nothing", () => {
    expect(preparedMessages({ ...base, bookings: [hotel({ status: "confirmed", confirmation_number: "AD-2-7287-20261012-H1" })], sent: new Set(["trip_link"]), voucherStays: [{ confirmation_number: "AD-2-7287-20261012-H1", start_date: "2026-10-20" }] })).toEqual([]);
  });
});
