import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoucherDocument } from "./VoucherDocument";
import type { VoucherBooking, VoucherDTO } from "@/lib/operations/voucher-dto";

function voucher(kind: VoucherDTO["kind"], bookings: VoucherBooking[]): VoucherDTO {
  return {
    kind,
    serial: "AD-6-3056-20261012",
    issued_at: "2026-10-13",
    destination: "ماليزيا",
    customer: { name: "ترافليون التقني", phone: "0500000000" },
    travelers: [{ name: "TRAVELIUN TECH", nationality: null }],
    bookings,
    days: [],
    notes: [],
  };
}

const booking = (over: Partial<VoucherBooking>): VoucherBooking => ({
  kind: "hotel",
  title: "بولمان سيتي سنتر",
  city_name: "كوالالمبور",
  start_date: "2026-11-20",
  end_date: "2026-11-24",
  confirmation_number: "HB-123",
  supplier_name: "مورّد داخلي",
  detail: { الغرفة: "ديلوكس — إفطار", النزلاء: "2 بالغ + 2 طفل" },
  cancellation_policy: null,
  is_paid: true,
  ...over,
});

const html = (v: VoucherDTO) => renderToStaticMarkup(createElement(VoucherDocument, { voucher: v }));

describe("the operational documents", () => {
  it("prints the hotel voucher in Arabic and English, with the hotel's own address — never the supplier", () => {
    const out = html(voucher("hotel_voucher", [booking({ name_en: "Pullman Kuala Lumpur City Centre", address: "4 Jalan Conlay", phone: "+60 3 2170 8888" })]));
    expect(out).toContain("Hotel Voucher");
    expect(out).toContain("Check-in");
    expect(out).toContain("Pullman Kuala Lumpur City Centre");
    expect(out).toContain("4 Jalan Conlay");
    expect(out).not.toContain("مورّد داخلي");
  });

  it("dates a ticket as departure and return, prints a planned time as «to be set», and names the route once", () => {
    const out = html(
      voucher("flight_ticket", [
        booking({ kind: "flight", title: "طيران دولي RUH ⇄ KUL", city_name: "RUH ⇄ KUL", end_date: "2026-11-27", detail: { الذهاب: "SV834 · RUH → KUL · 2026-11-20 00:00" } }),
      ]),
    );
    expect(out).toContain("Departure");
    expect(out).not.toContain("الدخول");
    expect(out).toContain("يُحدَّد لاحقاً");
    expect(out.match(/RUH ⇄ KUL/g)).toHaveLength(1);
  });

  it("keeps the supplier for the internal summary, and leaves out a nationality nobody entered", () => {
    const out = html(voucher("booking_summary", [booking({})]));
    expect(out).toContain("مورّد داخلي");
    expect(out).toContain("داخلي — لا يُسلَّم للعميل");
    expect(out).not.toContain(">—</td></tr>");
  });
});
