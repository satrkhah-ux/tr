import { describe, expect, it } from "vitest";
import { driverLinkExpiry, linkOpen, sameDriver, stepAllowed, stepDetail, supplierAnswer, supplierLinkExpiry } from "./op-links";

const blank = { ref: "", driver: "", phone: "", car: "", plate: "" };

describe("links", () => {
  it("expires a supplier link a week on and a driver's day at the end of the next Riyadh day", () => {
    expect(supplierLinkExpiry(new Date("2026-10-13T10:00:00Z"))).toBe("2026-10-20T10:00:00.000Z");
    expect(driverLinkExpiry("2026-11-20")).toBe("2026-11-21T21:00:00.000Z");
  });

  it("is open until it expires or is stopped", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(linkOpen({ expires_at: "2026-10-14T00:00:00Z", revoked_at: null }, now)).toBe(true);
    expect(linkOpen({ expires_at: "2026-10-13T09:59:00Z", revoked_at: null }, now)).toBe(false);
    expect(linkOpen({ expires_at: "2026-10-14T00:00:00Z", revoked_at: "2026-10-13T09:00:00Z" }, now)).toBe(false);
  });

  it("knows a driver however his number was typed", () => {
    expect(sameDriver("0551234567", "+966 55 123 4567")).toBe(true);
    expect(sameDriver("+60 12 345 6789", "0060123456789")).toBe(true);
    expect(sameDriver("", "")).toBe(false);
    expect(sameDriver("0551234567", "0551234568")).toBe(false);
  });
});

describe("supplierAnswer", () => {
  it("needs a confirmation number for a hotel", () => {
    expect(supplierAnswer(null, blank)).toEqual({ ok: false, error: "ref" });
    expect(supplierAnswer(null, { ...blank, ref: "  HX-77 ", driver: "ignored" })).toEqual({ ok: true, ref: "HX-77", detail: {} });
  });

  it("needs the driver and his phone for a drive; the number is optional", () => {
    expect(supplierAnswer("reception", { ...blank, ref: "R1" })).toEqual({ ok: false, error: "driver" });
    expect(supplierAnswer("tour", { ...blank, driver: "Ali", phone: "+60 12", plate: " WXY 1 " })).toEqual({
      ok: true,
      ref: null,
      detail: { السائق: "Ali", "جوال السائق": "+60 12", "رقم السيارة": "WXY 1" },
    });
  });

  it("writes the supplier's car model and how many apart, the count 1 to 50", () => {
    const answer = { ...blank, driver: "Ali", phone: "+60 12", car: "Hyundai Staria" };
    expect(supplierAnswer("tour", { ...answer, cars: " 2 " })).toEqual({
      ok: true,
      ref: null,
      detail: { السائق: "Ali", "جوال السائق": "+60 12", السيارة: "Hyundai Staria", "عدد السيارات": "2" },
    });
    expect(supplierAnswer("tour", { ...answer, cars: "0" })).toEqual({ ok: false, error: "cars" });
    expect(supplierAnswer("tour", { ...answer, cars: "abc" })).toEqual({ ok: false, error: "cars" });
  });

  it("caps what a public form may write", () => {
    const res = supplierAnswer(null, { ...blank, ref: "x".repeat(500) });
    expect(res.ok && res.ref?.length).toBe(60);
  });
});

describe("the driver's steps", () => {
  it("goes forward only", () => {
    expect(stepAllowed(null, "on_way")).toBe(true);
    expect(stepAllowed(null, "done")).toBe(true);
    expect(stepAllowed("on_way", "done")).toBe(true);
    expect(stepAllowed("on_way", "on_way")).toBe(false);
    expect(stepAllowed("done", "on_way")).toBe(false);
  });

  it("writes the status, and the time of the pick-up", () => {
    expect(stepDetail({ الوقت: "15:15" }, "on_way", "2026-11-20 14:00")).toEqual({ الوقت: "15:15", "حالة السائق": "في الطريق" });
    expect(stepDetail(null, "done", "2026-11-20 15:30")).toEqual({ "حالة السائق": "تم الاستقبال", "وقت الاستقبال": "2026-11-20 15:30" });
  });
});
