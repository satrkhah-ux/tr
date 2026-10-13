import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptDocument } from "@/components/offer-doc/ReceiptDocument";
import {
  amountInArabicWords,
  defaultSchedule,
  installmentStates,
  paidTotal,
  remainingBalance,
  riyadhDate,
  type ReceiptDTO,
} from "./payments";
import { operationSignals, type OperationSnapshot } from "./signals";

describe("amountInArabicWords — SAR", () => {
  it.each([
    [1, "ريال سعودي واحد"],
    [2, "ريالان سعوديان"],
    [3, "ثلاثة ريالات سعودية"],
    [10, "عشرة ريالات سعودية"],
    [11, "أحد عشر ريالاً سعودياً"],
    [21, "واحد وعشرون ريالاً سعودياً"],
    [100, "مائة ريال سعودي"],
    [200, "مائتا ريال سعودي"],
    [1000, "ألف ريال سعودي"],
    [2000, "ألفا ريال سعودي"],
    [2500, "ألفان وخمسمائة ريال سعودي"],
    [10000, "عشرة آلاف ريال سعودي"],
    [10635, "عشرة آلاف وستمائة وخمسة وثلاثون ريالاً سعودياً"],
    [21270, "واحد وعشرون ألفاً ومائتان وسبعون ريالاً سعودياً"],
    [200000, "مائتا ألف ريال سعودي"],
    [1000000, "مليون ريال سعودي"],
    [2500000, "مليونان وخمسمائة ألف ريال سعودي"],
    [3000000, "ثلاثة ملايين ريال سعودي"],
  ])("%s", (amount, words) => {
    expect(amountInArabicWords(amount)).toBe(words);
  });

  it("writes halalas in the feminine, after the riyals", () => {
    expect(amountInArabicWords(10635.25)).toBe("عشرة آلاف وستمائة وخمسة وثلاثون ريالاً سعودياً وخمس وعشرون هللة");
    expect(amountInArabicWords(0.5)).toBe("خمسون هللة");
    expect(amountInArabicWords(5.03)).toBe("خمسة ريالات سعودية وثلاث هللات");
    expect(amountInArabicWords(1.01)).toBe("ريال سعودي واحد وهللة واحدة");
    expect(amountInArabicWords(7.11)).toBe("سبعة ريالات سعودية وإحدى عشرة هللة");
  });

  it("survives float noise and zero", () => {
    expect(amountInArabicWords(0.1 + 0.2)).toBe("ثلاثون هللة");
    expect(amountInArabicWords(0)).toBe("صفر ريال سعودي");
  });

  it("another currency keeps the number in words and its code", () => {
    expect(amountInArabicWords(1500, "USD")).toBe("ألف وخمسمائة USD");
  });
});

describe("balance and schedule", () => {
  it("nets refunds and leaves the remainder", () => {
    const paid = paidTotal([
      { amount: 10635, kind: "deposit" },
      { amount: 100, kind: "refund" },
    ]);
    expect(paid).toBe(10535);
    expect(remainingBalance(21270, paid)).toBe(10735);
    expect(remainingBalance(null, paid)).toBeNull();
  });

  it("defaults to half at confirmation and the rest 14 days before travel", () => {
    expect(defaultSchedule({ total: 21270, confirmed_on: "2026-10-13", travel_start: "2026-11-20" })).toEqual([
      { due_date: "2026-10-13", amount: 10635 },
      { due_date: "2026-11-06", amount: 10635 },
    ]);
  });

  it("a trip inside the fortnight owes the rest now; no travel date, no due date; no total, no schedule", () => {
    expect(defaultSchedule({ total: 1000, confirmed_on: "2026-10-13", travel_start: "2026-10-20" })[1].due_date).toBe("2026-10-13");
    expect(defaultSchedule({ total: 1000, confirmed_on: "2026-10-13", travel_start: null })[1].due_date).toBeNull();
    expect(defaultSchedule({ total: null, confirmed_on: "2026-10-13", travel_start: null })).toEqual([]);
  });

  it("applies money to the earliest installment; due today is not late", () => {
    const schedule = [
      { due_date: "2026-11-06", amount: 10635 },
      { due_date: "2026-10-13", amount: 10635 },
    ];
    expect(installmentStates(schedule, 0, "2026-10-13").map((r) => r.state)).toEqual(["due", "due"]);
    expect(installmentStates(schedule, 0, "2026-10-14").map((r) => r.state)).toEqual(["overdue", "due"]);
    expect(installmentStates(schedule, 12000, "2026-11-07").map((r) => [r.state, r.covered])).toEqual([
      ["paid", 10635],
      ["overdue", 1365],
    ]);
    expect(installmentStates(schedule, 12000, "2026-11-01").map((r) => r.state)).toEqual(["paid", "partial"]);
  });

  it("an uncovered past installment raises the red «قسط متأخر» signal", () => {
    const op: OperationSnapshot = {
      client_status: "confirmed",
      execution_status: "pending_bookings",
      travel_start: "2026-11-20",
      total: 21270,
      paid: 0,
      bookings: [],
      documents: [],
      travelers: [],
      installments: [{ due_date: "2026-10-13", amount: 10635 }],
    };
    expect(operationSignals(op, "2026-10-13").map((s) => s.code)).not.toContain("installment_overdue");
    const late = operationSignals(op, "2026-10-14").find((s) => s.code === "installment_overdue");
    expect(late?.severity).toBe("critical");
    expect(late?.subjects).toEqual(["2026-10-13 · 10635"]);
    expect(operationSignals({ ...op, paid: 10635 }, "2026-10-14").map((s) => s.code)).not.toContain("installment_overdue");
  });

  it("today is Riyadh's day, not UTC's", () => {
    expect(riyadhDate("2026-10-13T22:30:00Z")).toBe("2026-10-14");
  });
});

describe("the receipt voucher", () => {
  const receipt: ReceiptDTO = {
    receipt_no: "RCPT-261013-K7Q2",
    serial: "AD-6-3056-20261012",
    destination: "ماليزيا",
    customer_name: "ترافليون التقني",
    amount: 10635,
    currency: "SAR",
    kind: "deposit",
    method: "transfer",
    reference: "TRX-889",
    paid_at: "2026-10-13",
  };

  it("prints the number, the amount in words and the method", () => {
    const html = renderToStaticMarkup(createElement(ReceiptDocument, { receipt }));
    for (const text of ["سند قبض", "RCPT-261013-K7Q2", "عشرة آلاف وستمائة وخمسة وثلاثون ريالاً سعودياً", "تحويل بنكي", "TRX-889", "عربون"]) {
      expect(html).toContain(text);
    }
  });
});
