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

it("session E's real quote: Tabby at 8.766% on 10,000 SAR, an unset method adds nothing", () => {
  const fees = { ...DEFAULT_FEES, tabby: { pct: 8.766, fixed: 0 } };
  expect(withMethodFees(["التقسيط عبر تابي على 4 دفعات", "التقسيط عبر تمارا"], 10000, methodsForFees(), sessionEFee(fees))).toEqual([
    "التقسيط عبر تابي على 4 دفعات — الإجمالي عبر تابي 10,877 ريال (يشمل رسوم 877 ريال)",
    "التقسيط عبر تمارا",
  ]);
});
