import { describe, expect, it } from "vitest";
import { summarizeBookings } from "./booking-summary";

describe("a confirmed file's services in the files list", () => {
  it("one line per kind, in the trip's order: done, in progress, or a problem; cancelled bookings do not count", () => {
    expect(
      summarizeBookings([
        { kind: "hotel", status: "confirmed" },
        { kind: "hotel", status: "pending" },
        { kind: "flight", status: "confirmed" },
        { kind: "transport", status: "failed" },
        { kind: "transport", status: "confirmed" },
        { kind: "visa", status: "cancelled" },
      ]),
    ).toEqual([
      { kind: "flight", total: 1, confirmed: 1, state: "done" },
      { kind: "hotel", total: 2, confirmed: 1, state: "progress" },
      { kind: "transport", total: 2, confirmed: 1, state: "problem" },
    ]);
  });
});
