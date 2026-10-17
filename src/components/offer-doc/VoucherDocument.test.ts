import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoucherDocument } from "./VoucherDocument";
import { partnerBrand } from "./brand";
import { COMPANY } from "./labels";
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

  it("prints a stay issued in English under its English name, the Arabic below, with its room notes", () => {
    const out = html(
      voucher("hotel_voucher", [
        booking({
          title: "Pullman Kuala Lumpur City Centre",
          alt_name: "بولمان سيتي سنتر",
          city_name: "Kuala Lumpur",
          locale: "en",
          detail: { الغرفة: "Deluxe King Room — Bed & breakfast" },
          notes: ["Beds: 1 × King Bed (Guaranteed)"],
        }),
      ]),
    );
    expect(out).toContain("Pullman Kuala Lumpur City Centre");
    expect(out).toContain("بولمان سيتي سنتر");
    expect(out).toContain("Deluxe King Room — Bed &amp; breakfast");
    expect(out).toContain("Beds: 1 × King Bed (Guaranteed)");
  });

  it("prints a voucher issued in English left to right, every label in English, with the hotel's map", () => {
    const out = html({
      ...voucher("hotel_voucher", [
        booking({
          title: "Pullman Kuala Lumpur City Centre",
          alt_name: "بولمان سيتي سنتر",
          city_name: "Kuala Lumpur",
          locale: "en",
          detail: { الغرفة: "Deluxe King Room — Bed & breakfast", النزلاء: "2 adults" },
          map: "https://maps.google.com/?q=Pullman+KL",
        }),
      ]),
      lang: "en",
    });
    expect(out).toContain('dir="ltr"');
    for (const s of ["Hotel Voucher", "Check-in", "Check-out", "Confirmation no.", "Lead guest", "TRAVELIUN TECH", "Open in Google Maps", "https://maps.google.com/?q=Pullman+KL"]) expect(out).toContain(s);
    // Arabic only in the hotel's own Arabic name, printed small
    expect(out.replace("بولمان سيتي سنتر", "").replace(/<style[\s\S]*?<\/style>/g, "")).not.toMatch(/[؀-ۿ]/);
    expect(out).not.toContain("مورّد داخلي");
  });

  it("never links a map that is not a web address", () => {
    const out = html({ ...voucher("hotel_voucher", [booking({ locale: "en", map: "javascript:alert(1)" })]), lang: "en" });
    expect(out).not.toContain("javascript:");
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

  it("prints a partner's client's voucher under the partner's name and number, not ours", () => {
    const brand = partnerBrand(
      { name: "سفريات الواحة", name_latin: "Oasis Travel", address: "جدة", phone: "0120000000", whatsapp: null, website: null, email: null, brand_color: "#123456", accent_color: "#abcdef", doc_font: null } as Parameters<typeof partnerBrand>[0],
      null,
    );
    const out = renderToStaticMarkup(createElement(VoucherDocument, { voucher: voucher("hotel_voucher", [booking({})]), brand }));
    expect(out).toContain("سفريات الواحة");
    expect(out).toContain("0120000000");
    // the test client is «ترافليون التقني» — so our company NAME and NUMBER, not the word
    expect(out).not.toContain(COMPANY.nameAr);
    expect(out).not.toContain(COMPANY.phone);
    expect(out).toContain("#123456");
  });
});
