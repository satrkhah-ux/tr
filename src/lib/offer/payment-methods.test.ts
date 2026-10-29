import { expect, it } from "vitest";
import { withMethodFees } from "./payment-methods";

const methods = [{ id: "tabby", name: "تابي" }, { id: "tamara", name: "تمارا" }];
const fee = (id: string, amount: number) => (id === "tabby" ? { fee: amount * 0.05, total: amount * 1.05, note: `رسوم ${amount * 0.05} ر.س` } : null);

it("a country's line naming a method prints its fee for the total; other lines stay", () => {
  expect(withMethodFees(["الدفع عبر تابي", "تمارا متاح", "بنك الراجحي"], 1000, methods, fee)).toEqual(["الدفع عبر تابي — رسوم 50 ر.س", "تمارا متاح", "بنك الراجحي"]);
});

it("no total or no methods: the lines as written", () => {
  expect(withMethodFees(["الدفع عبر تابي"], null, methods, fee)).toEqual(["الدفع عبر تابي"]);
  expect(withMethodFees(["الدفع عبر تابي"], 1000, [], fee)).toEqual(["الدفع عبر تابي"]);
});
