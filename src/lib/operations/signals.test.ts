import { describe, expect, it } from "vitest";
import {
  cancellationDeadlineNear,
  hotelAwaitingConfirmation,
  operationSignals,
  passportExpiring,
  severityRank,
  travelApproachingIncomplete,
  unpaidConfirmed,
  vouchersPending,
  type OperationSnapshot,
} from "./signals";

/**
 * The signals ARE the board. Each rule is tested against an injected clock,
 * because the whole point of deriving them is that they change with the date
 * without anything writing to the database.
 */

const TODAY = "2026-07-29";

function snap(over: Partial<OperationSnapshot> = {}): OperationSnapshot {
  return {
    client_status: "confirmed",
    execution_status: "pending_bookings",
    travel_start: "2026-09-10",
    total: 12000,
    paid: 12000,
    bookings: [],
    documents: [],
    travelers: [],
    ...over,
  };
}

describe("unpaidConfirmed", () => {
  it("fires when the money is not all in", () => {
    expect(unpaidConfirmed(snap({ paid: 4000 }))).toBe(true);
  });

  it("stays quiet once paid in full", () => {
    expect(unpaidConfirmed(snap({ paid: 12000 }))).toBe(false);
  });

  it("does not chase a client who has not confirmed yet", () => {
    expect(unpaidConfirmed(snap({ client_status: "awaiting_reply", paid: 0 }))).toBe(false);
  });

  it("does not fire on an offer with no total — that is a data gap, not a debt", () => {
    expect(unpaidConfirmed(snap({ total: null, paid: 0 }))).toBe(false);
  });
});

describe("hotelAwaitingConfirmation", () => {
  it("names hotels that were requested but never came back", () => {
    const op = snap({
      bookings: [
        { id: "b1", kind: "hotel", title: "فندق باكو سنتر", status: "pending", cancellation_deadline: null },
        { id: "b2", kind: "hotel", title: "مؤكّد", status: "confirmed", cancellation_deadline: null },
        { id: "b3", kind: "flight", title: "SV832", status: "pending", cancellation_deadline: null },
      ],
    });
    expect(hotelAwaitingConfirmation(op)).toEqual(["فندق باكو سنتر"]);
  });

  it("counts an in-flight request too — that is a booking we cannot account for", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "ح", status: "in_flight", cancellation_deadline: null }],
    });
    expect(hotelAwaitingConfirmation(op)).toEqual(["ح"]);
  });
});

describe("vouchersPending", () => {
  it("names confirmed bookings with no document against them", () => {
    const op = snap({
      bookings: [
        { id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: null },
        { id: "b2", kind: "hotel", title: "ب", status: "confirmed", cancellation_deadline: null },
      ],
      documents: [{ kind: "hotel_voucher", booking_id: "b1" }],
    });
    expect(vouchersPending(op)).toEqual(["ب"]);
  });

  it("ignores bookings that are not confirmed — nothing to voucher yet", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: null }],
    });
    expect(vouchersPending(op)).toEqual([]);
  });

  // The DEFAULT document is one combined voucher (booking_id null). Before this
  // was handled, the signal shouted forever on a case already served.
  it("accepts the combined voucher as covering every hotel on it", () => {
    const op = snap({
      bookings: [
        { id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: null },
        { id: "b2", kind: "hotel", title: "ب", status: "confirmed", cancellation_deadline: null },
      ],
      documents: [{ kind: "hotel_voucher", booking_id: null }],
    });
    expect(vouchersPending(op)).toEqual([]);
  });

  it("does not let a hotel voucher cover a flight", () => {
    const op = snap({
      bookings: [{ id: "f1", kind: "flight", title: "رحلة", status: "confirmed", cancellation_deadline: null }],
      documents: [{ kind: "hotel_voucher", booking_id: null }],
    });
    expect(vouchersPending(op)).toEqual(["رحلة"]);
  });

  it("counts a booking confirmed AFTER the combined voucher was printed — it is not on that paper", () => {
    const op = snap({
      bookings: [
        { id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: null, confirmed_at: "2026-07-20T10:00:00Z" },
        { id: "b2", kind: "hotel", title: "ب", status: "confirmed", cancellation_deadline: null, confirmed_at: "2026-07-28T10:00:00Z" },
      ],
      documents: [{ kind: "hotel_voucher", booking_id: null, created_at: "2026-07-25T10:00:00Z" }],
    });
    expect(vouchersPending(op)).toEqual(["ب"]);
  });

  it("stays lenient when a timestamp is missing — an unsure signal is noise", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: null, confirmed_at: null }],
      documents: [{ kind: "hotel_voucher", booking_id: null, created_at: "2026-07-25T10:00:00Z" }],
    });
    expect(vouchersPending(op)).toEqual([]);
  });
});

describe("travelApproachingIncomplete", () => {
  it("fires when the trip starts this week with an unbooked item", () => {
    const op = snap({
      travel_start: "2026-08-02",
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: null }],
    });
    expect(travelApproachingIncomplete(op, TODAY)).toEqual(["أ"]);
  });

  it("stays quiet when everything is confirmed", () => {
    const op = snap({
      travel_start: "2026-08-02",
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: null }],
    });
    expect(travelApproachingIncomplete(op, TODAY)).toEqual([]);
  });

  it("stays quiet for a trip still far away", () => {
    const op = snap({
      travel_start: "2026-12-01",
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: null }],
    });
    expect(travelApproachingIncomplete(op, TODAY)).toEqual([]);
  });

  it("does not shout about a trip that already departed", () => {
    const op = snap({
      travel_start: "2026-07-01",
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: null }],
    });
    expect(travelApproachingIncomplete(op, TODAY)).toEqual([]);
  });
});

describe("passportExpiring", () => {
  it("names travelers inside the six-month rule", () => {
    const op = snap({
      travelers: [
        { display_name: "ابتهال", passport_expiry: "2026-10-01" },
        { display_name: "سالم", passport_expiry: "2029-01-01" },
      ],
    });
    expect(passportExpiring(op, TODAY)).toEqual(["ابتهال"]);
  });

  it("says nothing when the expiry is unknown", () => {
    const op = snap({ travelers: [{ display_name: "س", passport_expiry: null }] });
    expect(passportExpiring(op, TODAY)).toEqual([]);
  });
});

describe("cancellationDeadlineNear", () => {
  it("fires before the free window closes — after it, cancelling costs money", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: "2026-07-31T12:00:00Z" }],
    });
    expect(cancellationDeadlineNear(op, TODAY)).toEqual(["أ"]);
  });

  it("stays quiet while the window is comfortably open", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: "2026-09-01T12:00:00Z" }],
    });
    expect(cancellationDeadlineNear(op, TODAY)).toEqual([]);
  });

  it("ignores an unconfirmed booking — there is nothing to lose yet", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: "2026-07-30T12:00:00Z" }],
    });
    expect(cancellationDeadlineNear(op, TODAY)).toEqual([]);
  });
});

describe("operationSignals", () => {
  it("returns nothing at all for a cancelled case — that is history, not work", () => {
    const op = snap({ client_status: "cancelled", paid: 0, travelers: [{ display_name: "س", passport_expiry: "2026-08-01" }] });
    expect(operationSignals(op, TODAY)).toEqual([]);
  });

  it("orders the most severe first", () => {
    const op = snap({
      travel_start: "2026-08-02",
      paid: 0,
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: null }],
    });
    const codes = operationSignals(op, TODAY).map((s) => s.code);
    expect(codes[0]).toBe("travel_approaching_incomplete");
    expect(codes).toContain("unpaid_confirmed");
    expect(codes).toContain("hotel_awaiting_confirmation");
  });

  it("is silent on a case with nothing wrong", () => {
    const op = snap({
      bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "confirmed", cancellation_deadline: null }],
      documents: [{ kind: "hotel_voucher", booking_id: "b1" }],
    });
    expect(operationSignals(op, TODAY)).toEqual([]);
  });
});

describe("severityRank", () => {
  it("sorts critical above warn above info above clean", () => {
    expect(severityRank([{ code: "passport_expiring", severity: "critical", subjects: [] }])).toBe(0);
    expect(severityRank([{ code: "unpaid_confirmed", severity: "warn", subjects: [] }])).toBe(1);
    expect(severityRank([{ code: "vouchers_pending", severity: "info", subjects: [] }])).toBe(2);
    expect(severityRank([])).toBe(3);
  });
});
