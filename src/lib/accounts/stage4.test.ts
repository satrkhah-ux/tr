import { describe, expect, it } from "vitest";
import { journal, journalCsv } from "./journal";
import { quotesView, type Quote } from "./quotes";

describe("«القيود اليومية»", () => {
  const j = journal({
    month: "2026-10",
    sales: [
      { serial: "A-1", client: "عميل أ", on: "2026-10-03", price: 10000, cost: 8500 },
      { serial: "B-2", client: "عميل ب", on: "2026-09-28", price: 4000, cost: 3000 },
    ],
    clientPayments: [
      { serial: "A-1", client: "عميل أ", on: "2026-10-03", amount: 5000, kind: "deposit", receipt: "R-1" },
      { serial: "A-1", client: "عميل أ", on: "2026-10-20", amount: 300, kind: "refund", receipt: null },
    ],
    supplierPayments: [{ supplier: "القافلة", serial: "A-1", on: "2026-10-05", amount: 6000, kind: "payment", reference: "TR-9" }],
    expenses: [{ on: "2026-10-15", title: "إعلانات سناب", category: "ads", amount: 1500 }],
  });

  it("writes one balanced entry per money event of the month, in date order", () => {
    expect(j.entries.map((e) => [e.date, e.memo])).toEqual([
      ["2026-10-03", "بيع رحلة — عميل أ"],
      ["2026-10-03", "دفعة من عميل — عميل أ"],
      ["2026-10-05", "سداد لمورد — القافلة"],
      ["2026-10-15", "مصروف — إعلانات سناب"],
      ["2026-10-20", "استرجاع لعميل — عميل أ"],
    ]);
    for (const e of j.entries) expect(e.lines.reduce((s, l) => s + l.debit, 0)).toBe(e.lines.reduce((s, l) => s + l.credit, 0));
    expect(j.balanced).toBe(true);
  });
  it("totals each account: what clients and suppliers owe at the month's end follows", () => {
    const t = Object.fromEntries(j.totals.map((x) => [x.account, [x.debit, x.credit]]));
    expect(t).toEqual({ cash: [5000, 7800], receivable: [10300, 5000], payable: [6000, 8500], revenue: [0, 10000], cost: [8500, 0], expense: [1500, 0] });
  });
  it("exports for the accountant with the Arabic headers and one row per line", () => {
    const csv = journalCsv(j.entries);
    expect(csv.startsWith("﻿التاريخ,المرجع,البيان")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(1 + 12); // the sale has 4 lines (price and cost), the other four events 2 each
  });
});

describe("«عروض الأسعار»", () => {
  const q = (id: string, date: string, status: string, sar: number | null, valid_until: string | null = null): Quote => ({ id, serial: id, client: "", seller: "", date, valid_until, status, sar });
  const v = quotesView(
    [q("a", "2026-10-02", "confirmed", 10000), q("b", "2026-10-10", "sent", 6000, "2026-11-01"), q("c", "2026-10-12", "sent", 4000, "2026-10-29"), q("d", "2026-10-20", "cancelled", 9000), q("e", "2026-09-20", "sent", 3000, null), q("f", "2026-10-25", "draft", 1000)],
    "2026-10",
    "2026-10-30",
  );
  it("counts the month's quotes and wins, drafts and cancelled aside", () => {
    expect([v.made, v.won, v.conversion]).toEqual([{ count: 3, value: 20000 }, { count: 1, value: 10000 }, 33.3]);
  });
  it("lists the open ones, about to lapse first, and values only those still valid", () => {
    expect(v.open.map((o) => [o.id, o.lapse])).toEqual([["b", "soon"], ["e", null], ["c", "expired"]]);
    expect(v.openValue).toBe(9000);
  });
});
