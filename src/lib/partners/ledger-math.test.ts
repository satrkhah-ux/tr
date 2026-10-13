import { describe, expect, it } from "vitest";
import { balances, invoiceNoFor, overCredit, receiptNo, type LedgerLine } from "./ledger-math";

const inv = (amount: number, currency = "SAR"): LedgerLine => ({ kind: "invoice", at: "2026-10-13", ref: "INV-x", amount, currency });
const pay = (amount: number, currency = "SAR"): LedgerLine => ({ kind: "payment", at: "2026-10-13", ref: "RCPT-x", amount, currency });

describe("the partner's account", () => {
  it("owes invoices minus payments, per currency, never across them", () => {
    expect(balances([inv(10_000), inv(2_400.5), pay(5_000), inv(300, "USD")])).toEqual([
      { currency: "SAR", owed: 7_400.5 },
      { currency: "USD", owed: 300 },
    ]);
  });

  it("refuses a file that would pass the limit, in the limit's currency only", () => {
    const lines = [inv(8_000), pay(1_000)];
    const limit = { amount: 10_000, currency: "SAR" };
    expect(overCredit(lines, { amount: 3_000, currency: "SAR" }, limit)).toBe(false); // 7,000 + 3,000 = the limit
    expect(overCredit(lines, { amount: 3_001, currency: "SAR" }, limit)).toBe(true);
    expect(overCredit(lines, { amount: 99_000, currency: "USD" }, limit)).toBe(false);
    expect(overCredit(lines, { amount: 99_000, currency: "SAR" }, { amount: null, currency: "SAR" })).toBe(false);
  });

  it("numbers an invoice by its offer and a receipt by its Riyadh day", () => {
    expect(invoiceNoFor("AD-6-5866-20261013")).toBe("INV-AD-6-5866-20261013");
    expect(receiptNo(new Date("2026-10-12T22:30:00Z"), () => 0)).toBe("RCPT-261013-2222");
  });
});
