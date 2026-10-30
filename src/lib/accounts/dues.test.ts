import { describe, expect, it } from "vitest";
import { installmentsDue, payTerm, payTermText, payTermTone } from "./dues";

describe("«المستحقات»", () => {
  const today = "2026-10-30";
  it("reads a booking's money deadline by its mode, with the days left", () => {
    expect(payTerm({ refund_mode: "pay_by", deadlineDay: "2026-11-02" }, today)).toEqual({ kind: "pay_by", date: "2026-11-02", days: 3 });
    expect(payTerm({ refund_mode: "refundable_until", deadlineDay: "2026-10-28" }, today)).toEqual({ kind: "refundable_until", date: "2026-10-28", days: -2 });
    expect(payTerm({ refund_mode: null, deadlineDay: "2026-11-10" }, today)?.kind).toBe("deadline");
    expect(payTerm({ refund_mode: "pay_by", deadlineDay: null }, today)).toBeNull();
  });
  it("says it in the accounts' words, and colours what is urgent", () => {
    const t = (kind: "pay_by" | "refundable_until" | "deadline", days: number) => ({ kind, date: "2026-11-02", days });
    expect(payTermText(t("pay_by", 3))).toBe("ادفع قبل \u20662026-11-02\u2069 · باقي 3 أيام");
    expect(payTermText(t("pay_by", 0))).toBe("ادفع اليوم وإلا يُلغى الحجز");
    expect(payTermText(t("pay_by", -1))).toBe("ادفع قبل \u20662026-11-02\u2069 · فات منذ يوم");
    expect(payTermText(t("refundable_until", 2))).toBe("إلغاء مجاني حتى \u20662026-11-02\u2069 · باقي يومين");
    expect(payTermText(t("refundable_until", -4))).toBe("انتهى الإلغاء المجاني \u20662026-11-02\u2069");
    expect([payTermTone(t("pay_by", 0)), payTermTone(t("deadline", 3)), payTermTone(t("pay_by", 9)), payTermTone(t("refundable_until", -1))]).toEqual(["danger", "warning", "calm", "danger"]);
  });
  it("lists every unsettled installment, earliest first — the agreed schedule, else the house terms", () => {
    const rows = installmentsDue([
      { id: "a", serial: "A", client: "أ", confirmed_on: "2026-10-01", travel_start: "2026-12-01", total: 10000, paid: 5000, installments: [] },
      { id: "b", serial: "B", client: "ب", confirmed_on: "2026-10-10", travel_start: null, total: 6000, paid: 1000,
        installments: [{ due_date: "2026-10-20", amount: 3000 }, { due_date: "2026-11-05", amount: 3000 }] },
    ], today);
    expect(rows.map((r) => [r.id, r.due_date, r.left, r.state, r.days, r.agreed])).toEqual([
      ["b", "2026-10-20", 2000, "overdue", -10, true],
      ["b", "2026-11-05", 3000, "due", 6, true],
      ["a", "2026-11-17", 5000, "due", 18, false],
    ]);
  });
});
