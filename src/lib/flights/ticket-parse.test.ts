import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emptyLeg, enrichTicket, mergeTicket, parseTicketText, refundIn, sanitizeTicket, ticketGaps } from "./ticket-parse";

describe("refund status on the card («مسترد / مسترد جزئياً / غير مسترد»)", () => {
  it("reads the ticket's refund wording, narrowest phrase first", () => {
    expect(refundIn("Fare basis: YOWSA  NON-REFUNDABLE")).toBe("non_refundable");
    expect(refundIn("Tickets are Non Refundable after departure")).toBe("non_refundable");
    expect(refundIn("التذكرة غير قابلة للاسترداد")).toBe("non_refundable");
    expect(refundIn("نوع التذكرة: غير مسترد")).toBe("non_refundable");
    expect(refundIn("Refundable with penalty SAR 200")).toBe("partial");
    expect(refundIn("Partially refundable")).toBe("partial");
    expect(refundIn("التذكرة مستردة جزئياً")).toBe("partial");
    expect(refundIn("قابلة للاسترداد مع خصم رسوم الإلغاء")).toBe("partial");
    expect(refundIn("Fare: Flex — REFUNDABLE")).toBe("refundable");
    expect(refundIn("التذكرة مسترد")).toBe("refundable");
    expect(refundIn("Economy SV1020 RUH-KUL")).toBe("");
    // a word that only contains the letters is not the word
    expect(refundIn("المستردين")).toBe("");
  });

  it("keeps the employee's choice and note through the server's cleaning, and nothing else", () => {
    const t = sanitizeTicket({ pnr: "abc123", passengers: [], legs: [], refund: "partial", refund_note: "  رسوم الإلغاء 200 ريال  " });
    expect(t).toMatchObject({ refund: "partial", refund_note: "رسوم الإلغاء 200 ريال" });
    expect(sanitizeTicket({ refund: "maybe" }).refund).toBe("");
  });

  it("a status the reader found is not overwritten by the model's", () => {
    const base = { pnr: "", passengers: [], legs: [], refund: "non_refundable" as const };
    const fill = { pnr: "X1Y2Z3", passengers: [], legs: [], refund: "refundable" as const };
    expect(mergeTicket(base, fill).refund).toBe("non_refundable");
    expect(mergeTicket({ ...base, refund: "" }, fill).refund).toBe("refundable");
  });
});

/** Every name and reference in the fixtures is invented. */
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const NOW = new Date("2026-10-15T00:00:00Z");

/** The fields that matter on the card, one line per leg — a failure shows the whole route. */
const route = (text: string) =>
  parseTicketText(text, NOW).legs.map(
    (l) => `${l.flight_no} ${l.from_iata}-${l.to_iata} ${l.dep_date} ${l.dep_time} → ${l.arr_date} ${l.arr_time} ${l.leg_order ?? "-"}`,
  );

describe("parseTicketText — Amadeus PNR display", () => {
  const text = fixture("amadeus-pnr.txt");
  it("reads every segment, the +1 arrival and the yearless dates from the issue date", () => {
    expect(route(text)).toEqual([
      "SV1020 RUH-JED 2026-11-15 08:30 → 2026-11-15 10:15 outbound",
      "SV117 JED-IST 2026-11-15 12:40 → 2026-11-15 16:55 outbound",
      "SV260 IST-RUH 2026-11-28 22:35 → 2026-11-29 04:20 inbound",
    ]);
  });
  it("prefers the airline locator and reads the name elements", () => {
    const t = parseTicketText(text, NOW);
    expect(t.pnr).toBe("QWE7RT");
    expect(t.passengers).toEqual(["LAYLA TESTOVA", "OMAR TESTOV"]);
    expect(t.legs[0].cabin).toBe("اقتصادية");
    expect(t.legs[0].airline_iata).toBe("SV");
  });
});

describe("parseTicketText — Sabre itinerary", () => {
  const text = fixture("sabre-itinerary.txt");
  it("converts the A/P clock", () => {
    expect(route(text)).toEqual([
      "XY123 RUH-DXB 2026-12-03 10:30 → 2026-12-03 13:05 outbound",
      "XY124 DXB-RUH 2026-12-10 14:35 → 2026-12-10 15:05 inbound",
    ]);
  });
  it("reads the DC locator and the passengers", () => {
    const t = parseTicketText(text, NOW);
    expect(t.pnr).toBe("K7XQ2P");
    expect(t.passengers).toEqual(["NOURA TESTER", "SAAD TESTER"]);
  });
});

describe("parseTicketText — Saudia e-ticket receipt (English)", () => {
  const text = fixture("saudia-eticket.txt");
  it("reads both legs from their table rows", () => {
    expect(route(text)).toEqual([
      "SV1471 MED-RUH 2026-11-20 14:20 → 2026-11-20 15:55 outbound",
      "SV1478 RUH-MED 2026-11-27 21:30 → 2026-11-27 23:05 inbound",
    ]);
  });
  it("reads the reference, the passenger, cabin, baggage and the printed airport names", () => {
    const t = parseTicketText(text, NOW);
    expect(t.pnr).toBe("M3TQ8Z");
    expect(t.passengers).toEqual(["FAHAD TESTUSER"]);
    expect(t.legs[0]).toMatchObject({ cabin: "اقتصادية", baggage: "23 كجم", from_name: "Madinah", to_name: "Riyadh" });
  });
});

describe("parseTicketText — flynas confirmation (Arabic, Eastern digits)", () => {
  const text = fixture("flynas-arabic.txt");
  it("reads Arabic months, ص/م and the labelled blocks", () => {
    expect(route(text)).toEqual([
      "XY213 JED-CAI 2026-11-22 11:40 → 2026-11-22 13:55 outbound",
      "XY214 CAI-JED 2026-12-03 14:55 → 2026-12-03 18:40 inbound",
    ]);
  });
  it("reads the passengers under their heading and the Arabic labels", () => {
    const t = parseTicketText(text, NOW);
    expect(t.pnr).toBe("NX4P7A");
    expect(t.passengers).toEqual(["تجربة ريم", "تجربة خالد"]);
    expect(t.legs[0]).toMatchObject({ from_name: "جدة", to_name: "القاهرة", cabin: "اقتصادية", baggage: "20 كجم" });
  });
});

describe("parseTicketText — flyadeal e-mail", () => {
  const text = fixture("flyadeal-email.txt");
  it("takes the date heading above each flight number, and bare codes", () => {
    expect(route(text)).toEqual([
      "F3141 RUH-AHB 2026-12-18 06:15 → 2026-12-18 07:50 outbound",
      "F3146 AHB-RUH 2026-12-26 20:40 → 2026-12-26 22:10 inbound",
    ]);
  });
  it("reads a reference on the next line, titled guests, one allowance for both legs", () => {
    const t = parseTicketText(text, NOW);
    expect(t.pnr).toBe("FA9K2Q");
    expect(t.passengers).toEqual(["Test Guest", "Sample Guest"]);
    expect(t.legs.map((l) => l.baggage)).toEqual(["20 كجم", "20 كجم"]);
  });
});

describe("parseTicketText — edges", () => {
  it("rolls a yearless trip over the new year", () => {
    const t = parseTicketText(
      "  1  SV 900 Y 28DEC 1 RUHLHR HK1  0200 0630\n  2  SV 901 Y 04JAN 7 LHRRUH HK1  1100 2015",
      new Date("2026-12-01T00:00:00Z"),
    );
    expect(t.legs.map((l) => l.dep_date)).toEqual(["2026-12-28", "2027-01-04"]);
  });
  it("leaves what it cannot read empty rather than guessing", () => {
    const t = parseTicketText("Thank you for flying with us.", NOW);
    expect(t).toEqual({ pnr: "", passengers: [], legs: [], refund: "" });
    expect(ticketGaps(t)).toEqual(["pnr", "passengers", "legs"]);
  });
  it("does not read a terminal and a day as a flight number", () => {
    const t = parseTicketText("Flight SV 1020\nDeparture Riyadh (RUH) Terminal T1 20 Nov 2026 08:30\nArrival Jeddah (JED) 20 Nov 2026 10:15", NOW);
    expect(t.legs.map((l) => l.flight_no)).toEqual(["SV1020"]);
    expect(t.legs[0]).toMatchObject({ from_iata: "RUH", to_iata: "JED", dep_time: "08:30", arr_time: "10:15" });
  });
});

describe("mergeTicket / sanitizeTicket / enrichTicket", () => {
  it("fills only the blanks, never a field the parser read", () => {
    const base = { pnr: "ABC123", passengers: [], legs: [{ ...emptyLeg(), flight_no: "SV1020", from_iata: "RUH", dep_time: "" }] };
    const fill = {
      pnr: "ZZZ999",
      passengers: ["X Y"],
      legs: [{ ...emptyLeg(), flight_no: "SV 1020", from_iata: "DMM", to_iata: "JED", dep_time: "08:30" }],
    };
    const merged = mergeTicket(base, fill);
    expect(merged.pnr).toBe("ABC123");
    expect(merged.passengers).toEqual(["X Y"]);
    expect(merged.legs[0]).toMatchObject({ from_iata: "RUH", to_iata: "JED", dep_time: "08:30" });
  });
  it("drops what does not fit its form", () => {
    const t = sanitizeTicket({
      pnr: "abc123",
      passengers: ["  A  B ", 5, ""],
      legs: [{ from_iata: "riyadh", to_iata: "jed", dep_date: "15/11/2026", dep_time: "8:30", leg_order: "sideways", extra: "x" }],
    });
    expect(t.pnr).toBe("ABC123");
    expect(t.passengers).toEqual(["A B"]);
    expect(t.legs[0]).toMatchObject({ from_iata: "", to_iata: "JED", dep_date: "", dep_time: "", leg_order: null });
    expect(t.legs[0]).not.toHaveProperty("extra");
  });
  it("names the codes in Arabic from our tables", () => {
    const t = enrichTicket(
      { pnr: "", passengers: [], legs: [{ ...emptyLeg(), flight_no: "SV1020", from_iata: "RUH", from_name: "Riyadh", to_iata: "ZZZ", to_name: "Somewhere" }] },
      [{ code: "RUH", name: "مطار الملك خالد الدولي" }],
      [{ iata: "SV", name: "الخطوط السعودية" }],
    );
    expect(t.legs[0]).toMatchObject({ airline_iata: "SV", airline: "الخطوط السعودية", from_name: "مطار الملك خالد الدولي", to_name: "Somewhere" });
  });
});
