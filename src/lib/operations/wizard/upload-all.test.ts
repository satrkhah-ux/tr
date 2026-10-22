import { describe, expect, it } from "vitest";
import { amountIn, matchHotel, matchSupplier, matchTicket, paperKind, ticketInvoice } from "./upload-all";

const PASSPORT = `KINGDOM OF SAUDI ARABIA
PASSPORT
P<SAUTESTER<<MOHAMMED<HADI<<<<<<<<<<<<<<<<<<
A123456780SAU9001011M3001015<<<<<<<<<<<<<<04`;

const TICKET = `ELECTRONIC TICKET RECEIPT
Booking reference (PNR): C98TNC
Passenger: TESTER/MOHAMMED MR
Flight XY309 RUH Riyadh - TBS Tbilisi 30OCT26 07:05 12:00
Flight XY310 TBS Tbilisi - RUH Riyadh 08NOV26 13:10 15:25
Baggage 20KG`;

const HOTEL = `Booking confirmation
Hotel: Episode Tbilisi
Hotel confirmation no: 545
Check-in: 2026-11-06
Check-out: 2026-11-08
Room: Double Room - Bed & breakfast
Guest name: MOHAMMED TESTER`;

describe("«ارفع كل الملفات» — what a paper is", () => {
  it("tells a passport by its MRZ, a ticket by its flights, a hotel by its stay", () => {
    expect(paperKind(PASSPORT)).toBe("passport");
    expect(paperKind(TICKET)).toBe("ticket");
    expect(paperKind(HOTEL)).toBe("hotel");
  });

  it("leaves a paper with too little to go on to the employee", () => {
    expect(paperKind("Invoice 2231 — thank you")).toBe("unknown");
    expect(paperKind("")).toBe("unknown");
  });
});

describe("«ارفع كل الملفات» — where a paper goes", () => {
  const flight = (id: string, line: string, start: string, end: string) => ({ id, detail: { "رحلة 1": line }, start_date: start, end_date: end });
  it("puts a ticket on the flight booking it flies", () => {
    const flights = [flight("dom", "— · TBS → BUS · 2026-11-02 يُحدَّد لاحقاً", "2026-11-02", "2026-11-02"), flight("intl", "XY309 · RUH → TBS · 2026-10-30 07:05", "2026-10-30", "2026-11-08")];
    expect(matchTicket([{ from_iata: "RUH", to_iata: "TBS", dep_date: "2026-10-30" }], flights)).toBe("intl");
    expect(matchTicket([{ from_iata: "TBS", to_iata: "BUS", dep_date: "2026-11-02" }], flights)).toBe("dom");
    expect(matchTicket([{ from_iata: "JED", to_iata: "IST", dep_date: "2027-01-01" }], flights)).toBeNull();
    // one flight booking takes every ticket
    expect(matchTicket([], [flights[1]])).toBe("intl");
  });

  it("puts a confirmation on its hotel by the stay's days and the hotel's name", () => {
    const hotels = [
      { id: "h1", title: "Marjan Plaza Hotel", city_name: "Tbilisi", start_date: "2026-10-30", end_date: "2026-10-31" },
      { id: "h5", title: "Episode Tbilisi", city_name: "Tbilisi", start_date: "2026-11-06", end_date: "2026-11-08" },
    ];
    expect(matchHotel(HOTEL, hotels)).toBe("h5");
    expect(matchHotel("Hotel confirmation for Marjan Plaza Hotel", hotels)).toBe("h1");
    expect(matchHotel("Hotel confirmation 7788", hotels)).toBeNull();
    // the same «Hotel» and «Spa» are no match: a resort's paper is not the Crystal's (AD-5-3269)
    const crystal = [...hotels, { id: "h3", title: "Crystal Hotel & SPA", city_name: "Bakuriani", start_date: "2026-11-02", end_date: "2026-11-04" }];
    expect(matchHotel("Autograph Collection Paragraph Resort & Spa Shekvetili — Batumi\nCheck-in 2026-11-04 Check-out 2026-11-06", crystal)).toBeNull();
  });
});

describe("«ارفع كل الملفات» — the money papers (2026-10-23)", () => {
  const HOTEL_INVOICE = `TAX INVOICE No. 4471
Within Earth Tourism
Hotel: Episode Tbilisi
Check-in 2026-11-06 Check-out 2026-11-08
Total amount: 1,250.00 USD`;
  const TRANSFER = `تحويل صادر
المستفيد: ترافليون للسفر
رقم العملية: 77812231
المبلغ 4,500.00 ريال
مقبولة`;

  it("tells a supplier's invoice and a client's transfer from a confirmation", () => {
    expect(paperKind(HOTEL_INVOICE)).toBe("hotel_invoice");
    expect(paperKind("INVOICE 99\nFlight booking fee RUH-TBS\nAirline: flynas\nTotal 2,300 SAR")).toBe("ticket_invoice");
    expect(paperKind(TRANSFER)).toBe("payment");
    expect(paperKind(HOTEL)).toBe("hotel");
  });

  it("keeps an e-ticket with its receipt a ticket, and reads its invoice as a second line", () => {
    const both = `${TICKET}\nRECEIPT\nTotal fare 2,450.00 SAR`;
    expect(paperKind(both)).toBe("ticket");
    expect(ticketInvoice(both)).toBe(true);
    expect(ticketInvoice(TICKET)).toBe(false);
  });

  it("reads the total and its currency", () => {
    expect(amountIn(HOTEL_INVOICE)).toEqual({ amount: 1250, currency: "USD" });
    expect(amountIn(TRANSFER)).toEqual({ amount: 4500, currency: "SAR" });
    // «COUNTRY» is no Turkish lira, «FORM» no ringgit
    expect(amountIn("Country form 12\nTotal 300").currency).toBeNull();
  });

  it("finds the invoice's issuer among our suppliers, folded, in either script", () => {
    const suppliers = [
      { id: "we", arabic_name: "ويذن ايرث", english_name: "within earth" },
      { id: "ag", arabic_name: "اجودا", english_name: "Agoda" },
    ];
    expect(matchSupplier("Within Earth", suppliers)?.id).toBe("we");
    expect(matchSupplier("WITHIN EARTH TOURISM LLC", suppliers)?.id).toBe("we");
    expect(matchSupplier("ويذن ايرث", suppliers)?.id).toBe("we");
    expect(matchSupplier("Booking.com", suppliers)).toBeNull();
  });
});
