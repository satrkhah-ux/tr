import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelPackDocument } from "@/components/offer-doc/TravelPackDocument";
import type { TravelPack } from "@/lib/data/travel-pack";
import type { VoucherDTO, VoucherKind } from "./voucher-dto";
import { pickPackDocuments, type PackDocRow } from "./travel-pack";

const row = (kind: VoucherKind, created_at: string, booking_id: string | null = null, id = `${kind}@${created_at}`) => ({ id, kind, booking_id, created_at });
const ids = (rows: (PackDocRow & { id: string })[]) => pickPackDocuments(rows).map((r) => r.id);

describe("which documents go in «حقيبة السفر»", () => {
  it("orders the trip: ticket, then stays, then the programme — and only the client's kinds", () => {
    expect(
      ids([
        row("itinerary", "2026-10-10"),
        row("booking_summary", "2026-10-10"),
        row("hotel_voucher", "2026-10-10"),
        row("welcome_board", "2026-10-10"),
        row("flight_ticket", "2026-10-10"),
      ]),
    ).toEqual(["flight_ticket@2026-10-10", "hotel_voucher@2026-10-10", "itinerary@2026-10-10"]);
  });

  it("keeps only the latest version of each", () => {
    expect(ids([row("flight_ticket", "2026-10-09"), row("flight_ticket", "2026-10-11"), row("flight_ticket", "2026-10-10")])).toEqual([
      "flight_ticket@2026-10-11",
    ]);
  });

  it("adds a hotel issued on its own only when it is newer than the whole voucher — the latest per hotel", () => {
    expect(
      ids([
        row("hotel_voucher", "2026-10-08", "kl"), // already inside the whole voucher of the 10th
        row("hotel_voucher", "2026-10-10"),
        row("hotel_voucher", "2026-10-11", "lgk"),
        row("hotel_voucher", "2026-10-12", "lgk"),
      ]),
    ).toEqual(["hotel_voucher@2026-10-10", "hotel_voucher@2026-10-12"]);
    // no whole voucher at all: one per hotel
    expect(ids([row("hotel_voucher", "2026-10-11", "kl"), row("hotel_voucher", "2026-10-12", "lgk")])).toEqual([
      "hotel_voucher@2026-10-11",
      "hotel_voucher@2026-10-12",
    ]);
  });
});

const voucher = (kind: VoucherKind): VoucherDTO => ({
  kind,
  serial: "AD-6-3056-20261012",
  issued_at: "2026-10-13",
  destination: "ماليزيا",
  customer: { name: "ترافليون التقني", phone: null },
  travelers: [{ name: "TRAVELIUN TECH", nationality: null }],
  bookings: [
    {
      kind: kind === "flight_ticket" ? "flight" : "hotel",
      title: kind === "flight_ticket" ? "طيران دولي" : "بولمان سيتي سنتر",
      city_name: "كوالالمبور",
      start_date: "2026-11-20",
      end_date: "2026-11-24",
      confirmation_number: "HB-123",
      supplier_name: "مورّد داخلي",
      detail: {},
      cancellation_policy: null,
      is_paid: true,
    },
  ],
  days: [],
  notes: [],
});

function pack(withDriver: boolean): TravelPack {
  return {
    hub: {
      serial: "AD-6-3056-20261012",
      destination: "ماليزيا",
      customer_name: "ترافليون التقني",
      travel_start: "2026-11-20",
      travel_end: "2026-11-27",
      documents: [],
      pending: [],
      brand: { name: "ترافليون", phone: "", website: "", color: null, whatsapp: "" },
    },
    trip: {
      today: "2026-11-20",
      travellers: 4,
      flights: [],
      hotels: [],
      days: [],
      services: [
        {
          kind: "reception",
          title: "المطار ← الفندق",
          date: "2026-11-20",
          time: "15:15",
          meet: "صالة الوصول",
          car: "فان",
          flight: "SV834 RUH → KUL",
          program: "",
          progress: null,
          driver: withDriver ? { name: "أمين", phone: "+60 12 345 6789", plate: "WXY 1234" } : null,
        },
      ],
      money: null,
      info: { emergency_phone: "+966 50 000 0000", agent_name: "وكيلنا في كوالالمبور", agent_phone: "+60 3 0000 0000", pay_note: "" },
    },
    guide: { country: "ماليزيا", local_agent_name: null, local_agent_phone: null, embassy_phone: "+60 3 4252 5000", ambulance: "999", police: "999", hospital: null, notes: null },
    documents: [voucher("flight_ticket"), voucher("hotel_voucher")],
    receipts: [
      { receipt_no: "RC-1", serial: "AD-6-3056-20261012", destination: "ماليزيا", customer_name: null, amount: 5000, currency: "SAR", kind: "deposit", method: "transfer", reference: null, paid_at: "2026-10-12" },
    ],
  };
}

describe("the «حقيبة السفر» PDF", () => {
  it("opens on a cover with the contacts and contents, then each document and receipt on its own sheets", () => {
    const out = renderToStaticMarkup(createElement(TravelPackDocument, { pack: pack(false) }));
    expect(out).toContain("حقيبة السفر");
    expect(out).toContain("+966 50 000 0000");
    expect(out).toContain("+60 3 4252 5000");
    expect(out.match(/class="tp-part"/g)).toHaveLength(3);
    // the ticket before the voucher before the receipt
    const ticket = out.indexOf("Flight Ticket");
    const hotel = out.indexOf("Hotel Voucher");
    const receipt = out.indexOf("سند قبض</div>");
    expect(ticket).toBeGreaterThan(0);
    expect(hotel).toBeGreaterThan(ticket);
    expect(receipt).toBeGreaterThan(hotel);
    // never a supplier, never the internal summary
    expect(out).not.toContain("مورّد داخلي");
    expect(out).not.toContain("ملخص الحجوزات");
  });

  it("prints a driver card only for a service whose day has come", () => {
    expect(renderToStaticMarkup(createElement(TravelPackDocument, { pack: pack(false) }))).not.toContain("سائقك اليوم");
    const out = renderToStaticMarkup(createElement(TravelPackDocument, { pack: pack(true) }));
    expect(out).toContain("سائقك اليوم");
    expect(out).toContain("WXY 1234");
  });
});
