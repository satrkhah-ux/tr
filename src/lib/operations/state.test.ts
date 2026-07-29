import { describe, expect, it } from "vitest";
import { STAGE_KEYS } from "@/lib/data/pipeline";
import {
  CLIENT_STATES,
  EXECUTION_STATES,
  canAdvanceClient,
  canAdvanceExecution,
  isClientStatus,
  isExecutionStatus,
  kanbanStageFor,
  type ExecutionStatus,
} from "./state";

/**
 * The transition rules. These are the only thing standing between an agent's
 * mis-click and an operation that claims the vouchers are out on a trip whose
 * hotel was never booked — so every property of the rule is pinned here.
 */

describe("canAdvanceExecution", () => {
  it("moves forward one step", () => {
    expect(canAdvanceExecution("pending_bookings", "flights_booked")).toBe(true);
  });

  it("allows SKIPPING ahead — hotels are often booked before flights, and a", () => {
    // …package with no flights never passes through flights_booked at all
    expect(canAdvanceExecution("pending_bookings", "hotels_booked")).toBe(true);
    expect(canAdvanceExecution("pending_bookings", "vouchers_issued")).toBe(true);
  });

  it("refuses to go backwards", () => {
    expect(canAdvanceExecution("vouchers_issued", "hotels_booked")).toBe(false);
    expect(canAdvanceExecution("travelled", "pending_bookings")).toBe(false);
  });

  it("refuses to stand still", () => {
    expect(canAdvanceExecution("hotels_booked", "hotels_booked")).toBe(false);
  });

  it("reaches cancelled from any live state, and never leaves it", () => {
    for (const state of EXECUTION_STATES) {
      expect(canAdvanceExecution(state, "cancelled")).toBe(true);
    }
    for (const state of EXECUTION_STATES) {
      expect(canAdvanceExecution("cancelled", state)).toBe(false);
    }
    expect(canAdvanceExecution("cancelled", "cancelled")).toBe(false);
  });

  it("treats the last state as terminal without a special case", () => {
    expect(canAdvanceExecution("travelled", "ready_to_travel")).toBe(false);
  });

  it("rejects a value that is not a state at all", () => {
    expect(canAdvanceExecution("pending_bookings", "shipped" as ExecutionStatus)).toBe(false);
    expect(canAdvanceExecution("" as ExecutionStatus, "hotels_booked")).toBe(false);
  });
});

describe("canAdvanceClient", () => {
  it("runs awaiting → confirmed → partial → full → completed", () => {
    expect(canAdvanceClient("awaiting_reply", "confirmed")).toBe(true);
    expect(canAdvanceClient("confirmed", "paid_partial")).toBe(true);
    expect(canAdvanceClient("paid_partial", "paid_full")).toBe(true);
    expect(canAdvanceClient("paid_full", "completed")).toBe(true);
  });

  it("lets a client who pays in one go skip the partial state", () => {
    expect(canAdvanceClient("confirmed", "paid_full")).toBe(true);
  });

  it("refuses to un-pay", () => {
    expect(canAdvanceClient("paid_full", "paid_partial")).toBe(false);
  });
});

describe("the tracks are independent", () => {
  it("does not couple payment to fulfilment in either direction", () => {
    // the whole reason these are two columns: a client can be paid in full while
    // the hotel is still unconfirmed, and nothing here may forbid that pairing
    expect(canAdvanceClient("confirmed", "paid_full")).toBe(true);
    expect(canAdvanceExecution("pending_bookings", "hotels_booked")).toBe(true);
  });
});

describe("type guards", () => {
  it("accepts every declared state plus cancelled", () => {
    for (const s of CLIENT_STATES) expect(isClientStatus(s)).toBe(true);
    for (const s of EXECUTION_STATES) expect(isExecutionStatus(s)).toBe(true);
    expect(isClientStatus("cancelled")).toBe(true);
    expect(isExecutionStatus("cancelled")).toBe(true);
  });

  it("rejects a state from the OTHER track", () => {
    expect(isClientStatus("hotels_booked")).toBe(false);
    expect(isExecutionStatus("paid_full")).toBe(false);
  });
});

describe("kanbanStageFor", () => {
  it("returns a stage the board actually has, for every execution state", () => {
    for (const state of EXECUTION_STATES) {
      const stage = kanbanStageFor(state);
      expect(stage).not.toBeNull();
      expect(STAGE_KEYS).toContain(stage);
    }
  });

  it("returns null for a cancelled case rather than inventing a column", () => {
    expect(kanbanStageFor("cancelled")).toBeNull();
  });

  it("puts everything after the vouchers in the completed column", () => {
    expect(kanbanStageFor("vouchers_issued")).toBe("completed");
    expect(kanbanStageFor("travelled")).toBe("completed");
  });
});
