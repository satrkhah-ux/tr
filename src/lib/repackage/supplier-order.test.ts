import { describe, expect, it } from "vitest";
import { buildSupplierOrder } from "./supplier-order";
import { ADDITION_PRICE, georgiaData, georgiaPackage, SELL } from "./fixture";

const order = (over: Partial<Parameters<typeof buildSupplierOrder>[0]> = {}) =>
  buildSupplierOrder({ lang: "ar", reference: "AD-1-1000-20261026", contact: "أحمد", data: georgiaData(), ...over });

describe("the supplier's order — every detail it needs", () => {
  const { subject, body } = order();

  it("names our reference, so their answer can be matched", () => {
    expect(subject).toContain("AD-1-1000-20261026");
    expect(body).toContain("مرجعنا: AD-1-1000-20261026");
    expect(body).toContain("السلام عليكم أحمد،");
  });

  it("carries the guest to contact, and only that much of them: a name and a phone", () => {
    expect(body).toContain("العميل (للتواصل): عميل تجريبي — 0500000000");
    expect(body).not.toMatch(/passport|جواز/i);
  });

  it("carries the travellers as counts, and says names follow until the case holds them", () => {
    expect(body).toContain("المسافرون: 2 بالغ، 1 طفل");
    expect(body).toContain("الأسماء تُرسل لاحقاً");
    const named = order({ travelers: [{ name: "مسافر أول", kind: "adult" }, { name: "مسافر ثانٍ", kind: "child" }] }).body;
    expect(named).toContain("1. مسافر أول (بالغ)");
    expect(named).toContain("2. مسافر ثانٍ (طفل)");
    expect(named).not.toContain("الأسماء تُرسل لاحقاً");
  });

  it("carries the dates and nights, and every stay: city, hotel, room, meals, check-in and check-out", () => {
    expect(body).toContain("التواريخ: 2026-11-10 → 2026-11-15 (5 ليالٍ)");
    expect(body).toContain("1. تبليسي — Twenties Hotel — غرفة ديلوكس — شامل الإفطار — 3 ليالٍ (من 2026-11-10 إلى 2026-11-13)");
    expect(body).toContain("2. باتومي — Sea Pearl — غرفة بإطلالة — نصف إقامة — 2 ليالٍ (من 2026-11-13 إلى 2026-11-15)");
  });

  it("carries the flights, the transfers, and what the price includes and leaves out", () => {
    expect(body).toContain("• Air Test AT100 RUH → TBS — 2026-11-10 04:20");
    expect(body).toContain("• استقبال وتوديع من المطار");
    expect(body).toContain("• الإقامة في الفنادق");
    expect(body).toContain("• التأشيرة");
  });

  it("leaves out a flight the agent added: it is ours to book, not the supplier's", () => {
    const own = georgiaPackage().flights[0];
    const added = { ...own, flight_no: "AT999", from_airport: "TBS", to_airport: "BUS", added: true as const };
    const withAdded = order({ data: georgiaData({ extracted: georgiaPackage({ flights: [own, added] }) }) }).body;
    expect(withAdded).toContain("AT100");
    expect(withAdded).not.toContain("AT999");
  });

  it("says what we pay THEM, in their currency — and a note when the clerk wrote one", () => {
    expect(body).toContain("المبلغ المستحق لكم: 7,391.5 SAR");
    expect(order({ note: "الغرف متجاورة" }).body).toContain("ملاحظة: الغرف متجاورة");
  });

  it("never carries what the client pays or what we earn: not the sell price, not an addition's price, not the profit", () => {
    for (const secret of [String(SELL), String(SELL + ADDITION_PRICE), String(ADDITION_PRICE), "8,500", "8,820", "الربح", "profit", "margin", "الهامش"]) {
      expect(body, secret).not.toContain(secret);
      expect(subject, secret).not.toContain(secret);
    }
    // our own price would show in a different currency too
    const usd = order({ data: georgiaData({ final_currency: "USD", extracted: georgiaPackage({ supplier_currency: "SAR" }) }) }).body;
    expect(usd).toContain("7,391.5 SAR");
    expect(usd).not.toContain("USD");
  });

  it("tells the supplier what we sell ourselves outside their package — by title, with no price", () => {
    expect(body).toContain("للعلم — خدمات إضافية يرتّبها طرفنا خارج باقتكم:");
    expect(body).toContain("• جولة نهرية");
    expect(body).not.toContain("ساعتان مع مرشد");
    expect(order({ data: georgiaData({ additions: [] }) }).body).not.toContain("للعلم");
  });

  it("is written to a supplier that reads English in English, content unchanged", () => {
    const en = order({ lang: "en", contact: null }).body;
    expect(en).toContain("Package confirmation request");
    expect(en).toContain("Dear team,");
    expect(en).toContain("Our reference: AD-1-1000-20261026");
    expect(en).toContain("1. تبليسي — Twenties Hotel — غرفة ديلوكس — Bed & breakfast — 3 nights (from 2026-11-10 to 2026-11-13)");
    expect(en).toContain("Amount payable to you: 7,391.5 SAR");
    expect(en).toContain("Travellers: 2 adults, 1 children");
  });

  it("leaves the price line out rather than invent one when the supplier's price was never read", () => {
    const none = order({ data: georgiaData({ extracted: georgiaPackage({ supplier_total: null }) }) }).body;
    expect(none).not.toContain("المبلغ المستحق لكم");
  });

  it("is ONE message for the whole package: one reference, one price line, however many stays", () => {
    expect(body.match(/مرجعنا/g)).toHaveLength(1);
    expect(body.match(/المبلغ المستحق لكم/g)).toHaveLength(1);
  });
});
