import { describe, expect, it } from "vitest";
import { matchesFilters, matchesQuery, movements, NO_FILTERS, toClientInfo, type ListedCase } from "./case-list";

const base: ListedCase = {
  serial: "AD-6-3056",
  destination: "ماليزيا",
  customer_name: "ترافليون التقني",
  customer_phone: "0569222111",
  partner_name: null,
  travel_start: "2026-11-20",
  travel_end: "2026-11-27",
  client_status: "paid_partial",
  execution_status: "pending_bookings",
  assignee_id: "e1",
};

describe("finding a case", () => {
  it("finds it by the phone however it is typed", () => {
    for (const q of ["0569222111", "+966 56 922 2111", "966569222111", "569222"]) expect(matchesQuery(base, q)).toBe(true);
    expect(matchesQuery(base, "0500000000")).toBe(false);
  });

  it("finds it by name and serial, and a serial's digits are not a phone", () => {
    expect(matchesQuery(base, "ad-6-3056")).toBe(true);
    expect(matchesQuery(base, "ترافليون")).toBe(true);
    expect(matchesQuery({ ...base, customer_phone: "0563056000" }, "AD-9-3056")).toBe(false);
  });
});

describe("the default list", () => {
  it("leaves cancelled and travelled cases out until their status is asked for", () => {
    const travelled = { ...base, execution_status: "travelled" as const };
    const cancelled = { ...base, client_status: "cancelled" as const };
    expect(matchesFilters(travelled, NO_FILTERS)).toBe(false);
    expect(matchesFilters(cancelled, NO_FILTERS)).toBe(false);
    expect(matchesFilters(travelled, { ...NO_FILTERS, status: "travelled" })).toBe(true);
    expect(matchesFilters(cancelled, { ...NO_FILTERS, status: "cancelled" })).toBe(true);
    expect(matchesFilters(base, NO_FILTERS)).toBe(true);
    // a search reaches them all the same
    expect(matchesFilters(travelled, NO_FILTERS, true)).toBe(true);
  });

  it("filters by travel date, destination and owner", () => {
    expect(matchesFilters(base, { ...NO_FILTERS, from: "2026-11-21" })).toBe(false);
    expect(matchesFilters(base, { ...NO_FILTERS, from: "2026-11-01", to: "2026-11-30", destination: "ماليزيا" })).toBe(true);
    expect(matchesFilters(base, { ...NO_FILTERS, assignee: "none" })).toBe(false);
    expect(matchesFilters({ ...base, assignee_id: null }, { ...NO_FILTERS, assignee: "none" })).toBe(true);
    expect(matchesFilters(base, { ...NO_FILTERS, assignee: "e2" })).toBe(false);
  });
});

describe("arrivals and departures", () => {
  const ops = [base, { ...base, serial: "B", travel_start: "2026-11-21", travel_end: "2026-11-24" }, { ...base, serial: "C", execution_status: "cancelled" as const }];

  it("splits today, tomorrow and the week", () => {
    expect(movements(ops, "2026-11-20", "today").arrivals.map((o) => o.serial)).toEqual(["AD-6-3056"]);
    expect(movements(ops, "2026-11-20", "tomorrow").arrivals.map((o) => o.serial)).toEqual(["B"]);
    const week = movements(ops, "2026-11-20", "week");
    expect(week.arrivals.map((o) => o.serial)).toEqual(["AD-6-3056", "B"]);
    expect(week.departures.map((o) => o.serial)).toEqual(["B"]);
  });

  it("crosses a month end", () => {
    expect(movements([{ ...base, travel_start: "2026-12-01" }], "2026-11-30", "tomorrow").arrivals).toHaveLength(1);
  });
});

it("keeps only the client info fields, trimmed", () => {
  expect(toClientInfo({ emergency_phone: " 0569 ", agent_name: 5, extra: "x" })).toEqual({ emergency_phone: "0569", agent_name: "", agent_phone: "", pay_note: "" });
  expect(toClientInfo(null).pay_note).toBe("");
});
