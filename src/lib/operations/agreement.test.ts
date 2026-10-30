import { describe, expect, it } from "vitest";
import { DEFAULT_FEES } from "@/lib/payments/methods";
import { clientAmount, dueReminder, lastPayDay, scheduleOf, splitEqual, spreadDates, validateAgreement, type AgreementRow } from "./agreement";

const ctx = { base: 10_000, travelStart: "2026-11-20", today: "2026-10-30" };
const row = (due_date: string, amount: number, method: AgreementRow["method"] = "transfer"): AgreementRow => ({ due_date, amount, method });

describe("validateAgreement", () => {
  it("accepts one payment today and a plan ending the day before travel", () => {
    expect(validateAgreement([row("2026-10-30", 10_000)], ctx)).toBeNull();
    expect(validateAgreement([row("2026-10-30", 5_000), row("2026-11-19", 5_000, "cash")], ctx)).toBeNull();
  });
  it("needs the amounts to add up to the file's total", () => {
    expect(validateAgreement([row("2026-10-30", 5_000), row("2026-11-10", 4_999)], ctx)).toBe("sum");
    expect(validateAgreement([row("2026-10-30", 5_000), row("2026-11-10", 5_000.004)], ctx)).toBeNull();
  });
  it("refuses a date on or after the travel day, and one in the past", () => {
    expect(validateAgreement([row("2026-11-20", 10_000)], ctx)).toBe("afterTravel");
    expect(validateAgreement([row("2026-10-29", 10_000)], ctx)).toBe("past");
  });
  it("without a travel date only the past is refused", () => {
    expect(validateAgreement([row("2027-05-01", 10_000)], { ...ctx, travelStart: null })).toBeNull();
  });
  it("Tabby / Tamara take the whole amount in one row", () => {
    expect(validateAgreement([row("2026-10-30", 10_000, "tabby")], ctx)).toBeNull();
    expect(validateAgreement([row("2026-10-30", 5_000, "tamara"), row("2026-11-01", 5_000)], ctx)).toBe("bnplSplit");
  });
  it("refuses empty, zero and malformed rows", () => {
    expect(validateAgreement([], ctx)).toBe("rows");
    expect(validateAgreement([row("2026-10-30", 0)], ctx)).toBe("amount");
    expect(validateAgreement([row("30/10/2026", 10_000)], ctx)).toBe("date");
    expect(validateAgreement([{ due_date: "2026-10-30", amount: 10_000, method: "bitcoin" as never }], ctx)).toBe("method");
  });
});

describe("splits", () => {
  it("50/50 and three equal parts add back to the total to the halala", () => {
    expect(splitEqual(10_000, 2)).toEqual([5_000, 5_000]);
    const three = splitEqual(1_000, 3);
    expect(three).toEqual([333.33, 333.33, 333.34]);
    expect(validateAgreement(three.map((a) => row("2026-10-30", a)), { ...ctx, base: 1_000 })).toBeNull();
  });
  it("spreads dates from today to the day before travel", () => {
    expect(spreadDates("2026-10-30", lastPayDay("2026-11-20"), 3)).toEqual(["2026-10-30", "2026-11-09", "2026-11-19"]);
    expect(spreadDates("2026-10-30", null, 2)).toEqual(["2026-10-30", "2026-10-30"]);
  });
});

describe("what the client pays", () => {
  it("adds the method's charge on its share, never on a plain transfer", () => {
    expect(clientAmount(15_510, "tabby", DEFAULT_FEES)).toBe(16_869.61);
    expect(clientAmount(15_510, "transfer", DEFAULT_FEES)).toBe(15_510);
    expect(clientAmount(15_510, "tabby", null)).toBe(15_510);
    expect(scheduleOf([row("2026-10-30", 15_510, "tabby")], DEFAULT_FEES)).toEqual([{ due_date: "2026-10-30", amount: 16_869.61, note: "الوسيلة: تابي" }]);
  });
});

describe("dueReminder", () => {
  it("three days before and on the day, only while unpaid", () => {
    expect(dueReminder({ due_date: "2026-11-02", state: "due" }, "2026-10-30")).toBe("soon");
    expect(dueReminder({ due_date: "2026-10-30", state: "partial" }, "2026-10-30")).toBe("today");
    expect(dueReminder({ due_date: "2026-10-30", state: "paid" }, "2026-10-30")).toBeNull();
    expect(dueReminder({ due_date: "2026-11-01", state: "due" }, "2026-10-30")).toBeNull();
    expect(dueReminder({ due_date: null, state: "due" }, "2026-10-30")).toBeNull();
  });
});
