import { describe, expect, it } from "vitest";
import { isLiveCase, summarizeOperations, type OpsCase } from "./summary";
import type { OperationSignal } from "./signals";

/**
 * The dashboard panel's numbers. The clock is injected, so "travelling within the
 * week" is testable; and the money is bucketed per currency, so a mixed-currency
 * board can never print a total that is true in no currency.
 */

const TODAY = "2026-07-30";

const critical: OperationSignal = { code: "travel_approaching_incomplete", severity: "critical", subjects: ["فندق"] };
const info: OperationSignal = { code: "vouchers_pending", severity: "info", subjects: ["فندق"] };
const twoPending: OperationSignal = { code: "vouchers_pending", severity: "info", subjects: ["أ", "ب"] };

function op(over: Partial<OpsCase> = {}): OpsCase {
  return {
    client_status: "confirmed",
    execution_status: "pending_bookings",
    travel_start: "2026-09-10",
    total: 12000,
    paid: 12000,
    currency: "SAR",
    bookings: [],
    signals: [],
    ...over,
  };
}

describe("isLiveCase", () => {
  it("drops cancelled on either track, and finished travel", () => {
    expect(isLiveCase(op({ client_status: "cancelled" }))).toBe(false);
    expect(isLiveCase(op({ execution_status: "cancelled" }))).toBe(false);
    expect(isLiveCase(op({ execution_status: "travelled" }))).toBe(false);
    expect(isLiveCase(op())).toBe(true);
  });
});

describe("summarizeOperations", () => {
  it("counts only live cases", () => {
    const counts = summarizeOperations([op(), op({ client_status: "cancelled" }), op({ execution_status: "travelled" })], TODAY);
    expect(counts.liveCases).toBe(1);
  });

  it("separates cases that are shouting from cases that merely have a signal", () => {
    const counts = summarizeOperations([op({ signals: [critical] }), op({ signals: [info] }), op()], TODAY);
    expect(counts.needsAction).toBe(2);
    expect(counts.critical).toBe(1);
  });

  it("counts every booking a supplier has not answered yet", () => {
    const counts = summarizeOperations(
      [
        op({
          bookings: [
            { id: "a", status: "pending" },
            { id: "b", status: "prebooked" },
            { id: "c", status: "in_flight" },
            { id: "d", status: "confirmed" },
            { id: "e", status: "cancelled" },
          ],
        }),
      ],
      TODAY,
    );
    expect(counts.openBookings).toBe(3);
  });

  // Taken from the signal, not recomputed — one rule, one place.
  it("sums missing vouchers across cases from the signal's own subjects", () => {
    const counts = summarizeOperations([op({ signals: [twoPending] }), op({ signals: [info] }), op()], TODAY);
    expect(counts.vouchersPending).toBe(3);
  });

  it("counts travel inside the week, not travel already started or far off", () => {
    const counts = summarizeOperations(
      [
        op({ travel_start: "2026-08-02" }), // 3 days out
        op({ travel_start: "2026-07-30" }), // today
        op({ travel_start: "2026-07-29" }), // yesterday — already gone
        op({ travel_start: "2026-09-01" }), // far off
        op({ travel_start: null }),
      ],
      TODAY,
    );
    expect(counts.travelSoon).toBe(2);
  });

  it("buckets outstanding money per currency, biggest first", () => {
    const counts = summarizeOperations(
      [
        op({ total: 10000, paid: 4000, currency: "SAR" }),
        op({ total: 3000, paid: 1000, currency: "SAR" }),
        op({ total: 9000, paid: 0, currency: "USD" }),
        op({ total: 5000, paid: 5000 }), // settled — not chased
        op({ total: 5000, paid: 6000 }), // overpaid — money to return, not to chase
        op({ total: null, paid: 0 }),
      ],
      TODAY,
    );
    expect(counts.outstanding).toEqual([
      { currency: "USD", amount: 9000 },
      { currency: "SAR", amount: 8000 },
    ]);
  });

  it("ignores a cancelled case entirely, money and bookings included", () => {
    const counts = summarizeOperations(
      [op({ client_status: "cancelled", total: 10000, paid: 0, bookings: [{ id: "a", status: "pending" }], signals: [critical] })],
      TODAY,
    );
    expect(counts).toEqual({
      liveCases: 0,
      needsAction: 0,
      critical: 0,
      openBookings: 0,
      vouchersPending: 0,
      travelSoon: 0,
      outstanding: [],
    });
  });
});
