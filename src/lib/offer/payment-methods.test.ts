import { expect, it } from "vitest";
import { methodsForFees, sessionEFee, withMethodFees } from "./payment-methods";
import { DEFAULT_FEES } from "@/lib/payments/methods";

const methods = [{ id: "tabby", name: "تابي" }, { id: "tamara", name: "تمارا" }];
const fee = (id: string, amount: number) => (id === "tabby" ? { fee: amount * 0.05, total: amount * 1.05, note: `رسوم ${amount * 0.05} ر.س` } : null);

it("a country's line naming a method prints its fee for the total; other lines stay", () => {
  expect(withMethodFees(["الدفع عبر تابي", "تمارا متاح", "بنك الراجحي"], 1000, methods, fee)).toEqual(["الدفع عبر تابي — رسوم 50 ر.س", "تمارا متاح", "بنك الراجحي"]);
});

it("no total or no methods: the lines as written", () => {
  expect(withMethodFees(["الدفع عبر تابي"], null, methods, fee)).toEqual(["الدفع عبر تابي"]);
  expect(withMethodFees(["الدفع عبر تابي"], 1000, [], fee)).toEqual(["الدفع عبر تابي"]);
});

it("session E's real quote: Tabby at 8.766% on 10,000 SAR prints the total only; an unset method adds nothing", () => {
  const fees = { ...DEFAULT_FEES, tabby: { pct: 8.766, fixed: 0 } };
  const lines = withMethodFees(["التقسيط عبر تابي على 4 دفعات", "التقسيط عبر تمارا"], 10000, methodsForFees(), sessionEFee(fees));
  expect(lines).toEqual(["التقسيط عبر تابي على 4 دفعات — الإجمالي 10,877 ريال", "التقسيط عبر تمارا"]);
});

it("never tells the client a provider's fee or percentage (the owner, 2026-10-29)", () => {
  const fees = { ...DEFAULT_FEES, tabby: { pct: 8.766, fixed: 5 }, tamara: { pct: 8.766, fixed: 0 }, link: { pct: 2.5, fixed: 0 } };
  const lines = withMethodFees(["التقسيط عبر تابي", "التقسيط عبر تمارا", "الدفع عبر رابط فاتورة (ماي فاتورة)"], 12345, methodsForFees(), sessionEFee(fees));
  for (const line of lines) {
    expect(line).not.toMatch(/رسوم|%|٪|نسبة|8\.766|877/);
  }
  expect(lines.filter((l) => l.includes("الإجمالي")).length).toBeGreaterThanOrEqual(2);
});
