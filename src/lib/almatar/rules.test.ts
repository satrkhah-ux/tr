import { describe, expect, it } from "vitest";
import { bookingProblem, cancelFeePct, loginEmail, outsideProgram, passwordProblem, profitOf, REQUEST_KINDS, serviceInstant, unitPrice } from "./rules";

const th07 = { price_small: 215, price_medium: 335, price_van10: 280, tz: "Asia/Bangkok", valid_through: "2027-12-31" };
const now = new Date("2026-10-18T12:00:00Z");
const ok = { vehicle: "medium", units: 1, date: "2026-10-20", time: "10:00", passengers: 2, lead_name: "Ali" };

describe("almatar rules", () => {
  it("prices a vehicle as the list sent it — th-07 van below medium is kept", () => {
    expect(unitPrice(th07, "medium")).toBe(335);
    expect(unitPrice(th07, "van10")).toBe(280);
  });

  it("reads the time on the destination's clock", () => {
    expect(serviceInstant("2026-10-20", "10:00", "Asia/Bangkok").toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });

  it("takes a booking 24h+ ahead and refuses one closer", () => {
    expect(bookingProblem(th07, ok, now)).toBeNull();
    // 2026-10-19 19:00 Bangkok = 12:00Z → exactly 24h: taken; 18:59 → refused
    expect(bookingProblem(th07, { ...ok, date: "2026-10-19", time: "19:00" }, now)).toBeNull();
    expect(bookingProblem(th07, { ...ok, date: "2026-10-19", time: "18:59" }, now)).toMatch(/24 ساعة/);
  });

  it("refuses a group of 8 vehicles and a date past the list", () => {
    expect(bookingProblem(th07, { ...ok, units: 7 }, now)).toBeNull();
    expect(bookingProblem(th07, { ...ok, units: 8 }, now)).toMatch(/الجماعي/);
    expect(bookingProblem(th07, { ...ok, date: "2028-01-02" }, now)).toMatch(/2027/);
  });

  it("charges 100% inside 12 hours, nothing before", () => {
    const at = new Date("2026-10-19T12:00:00Z");
    expect(cancelFeePct(at, new Date("2026-10-18T23:59:00Z"))).toBe(0);
    expect(cancelFeePct(at, new Date("2026-10-19T00:00:01Z"))).toBe(100);
  });

  it("books our profit inside their price", () => {
    expect(profitOf(335, 15)).toBe(50.25);
  });

  it("turns a bare username into the partners address", () => {
    expect(loginEmail(" Almatar ")).toBe("almatar@partners.traveliun.com");
    expect(loginEmail("a@b.co")).toBe("a@b.co");
  });

  it("refuses a weak password", () => {
    expect(passwordProblem("almatar123", "almatar")).not.toBeNull();
    expect(passwordProblem("short1", "almatar")).not.toBeNull();
    expect(passwordProblem("onlyletters", "almatar")).not.toBeNull();
    expect(passwordProblem("Rq7-mountain-42", "almatar")).toBeNull();
  });
});

describe("almatar requests", () => {
  it("lays out arrival + departure for «استقبال وتوديع», and keeps a program's days inside it", () => {
    expect(REQUEST_KINDS.find((k) => k.id === "both")?.lines).toEqual(["arrival", "departure"]);
    expect(outsideProgram("2026-11-01", "2026-11-07", "2026-11-08")).toBe(true);
    expect(outsideProgram("2026-11-01", "2026-11-07", "2026-11-03")).toBe(false);
    expect(outsideProgram("", "", "2026-11-03")).toBe(false);
  });
});
