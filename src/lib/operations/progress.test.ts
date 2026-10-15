import { describe, expect, it } from "vitest";
import { aheadOfClient, aheadOfExecution, derivedClient, derivedExecution, passportAlerts, readiness, type AlertTraveler, type ReadinessTraveler } from "./progress";

const b = (kind: string, status = "confirmed") => ({ kind, status });
const malaysia = [b("flight"), b("flight"), b("hotel"), b("hotel"), b("transport"), b("transport"), b("service")];
const traveler = (name: string, patch: Partial<ReadinessTraveler> = {}): ReadinessTraveler => ({
  name,
  has_passport: true,
  passport_expiry: null,
  birth_date: null,
  age: null,
  traveler_kind: "adult",
  nationality: "SAU",
  visa_status: "not_required",
  ...patch,
});

describe("a case's progress, derived", () => {
  it("climbs as far as every earlier step holds", () => {
    expect(derivedExecution([b("flight", "pending"), b("hotel")], [])).toBeNull();
    expect(derivedExecution([b("flight"), b("hotel", "pending")], [])).toBe("flights_booked");
    expect(derivedExecution([b("flight"), b("hotel"), b("transport", "pending")], [])).toBe("hotels_booked");
    expect(derivedExecution(malaysia, [])).toBe("transfers_booked");
    expect(derivedExecution(malaysia, [{ kind: "hotel_voucher" }, { kind: "flight_ticket" }, { kind: "itinerary" }])).toBe("vouchers_issued");
  });

  it("passes the flights step for a package without flights, ignores cancelled bookings, and has nothing for an empty case", () => {
    expect(derivedExecution([b("hotel"), b("flight", "cancelled")], [])).toBe("transfers_booked");
    expect(derivedExecution([], [])).toBeNull();
  });

  it("moves the client from the money, forward only", () => {
    expect(derivedClient(10_635, 21_270)).toBe("paid_partial");
    expect(derivedClient(21_270, 21_270)).toBe("paid_full");
    expect(derivedClient(0, 21_270)).toBeNull();
    expect(aheadOfClient("confirmed", "paid_partial")).toBe(true);
    expect(aheadOfClient("paid_full", "paid_partial")).toBe(false);
    expect(aheadOfExecution("vouchers_issued", "hotels_booked")).toBe(false);
    expect(aheadOfExecution("cancelled", "vouchers_issued")).toBe(false);
  });

  it("alerts on every passport issue the ops screen and /trip show — once per traveler and issue", () => {
    const trip = { travel_start: "2026-11-20", travel_end: "2026-11-27" };
    const p = (id: string, patch: Partial<AlertTraveler> = {}): AlertTraveler => ({
      id, display_name: id, has_passport: true, passport_expiry: "2030-01-01", birth_date: null, age: null, traveler_kind: "adult", ...patch,
    });
    const alerts = passportAlerts(
      [
        p("ok"),
        p("valid", { passport_expiry: "2027-05-28" }),
        p("short", { passport_expiry: "2027-05-27" }), // exactly six months after the return: short, as on the ops screen
        p("expired", { passport_expiry: "2026-11-19" }),
        p("none", { has_passport: false, passport_expiry: null }),
        p("no-expiry", { passport_expiry: null }),
        p("grown", { traveler_kind: "child", age: 11, birth_date: "2014-11-01" }),
      ],
      trip,
      "2026-10-15",
    );
    expect(alerts.map((a) => a.ref)).toEqual(["short", "expired", "none:passport", "no-expiry:passport_expiry", "grown:age_mismatch"]);
    expect(alerts[0].text).toBe("🛂 short: الجواز أقل من 6 أشهر بعد العودة (2027-05-27)");
    expect(alerts[4].text).toBe("🛂 grown: عمره يوم السفر 12 — لا يطابق العرض");
  });

  it("lists what «جاهز للسفر» still waits for", () => {
    const items = readiness({
      bookings: malaysia,
      documents: [{ kind: "hotel_voucher" }, { kind: "flight_ticket" }, { kind: "itinerary" }],
      paid: 10_635,
      total: 21_270,
      travelers: [traveler("أحمد", { passport_expiry: "2030-01-01" }), traveler("سارة", { passport_expiry: "2027-01-01", visa_status: "submitted" })],
      travelStart: "2026-11-20",
      travelEnd: "2026-11-27",
      today: "2026-10-15",
    });
    expect(Object.fromEntries(items.map((i) => [i.key, i.ok]))).toEqual({ bookings: true, payment: false, documents: true, passports: false, visas: false });
    expect(items.find((i) => i.key === "passports")?.detail).toContain("سارة");
  });

  it("reads the passports with the traveler row's own decision, and holds a nationality nobody checked", () => {
    // the Indonesia case: an Iraqi with a good passport, a Syrian whose passport expired and whose birth date makes him a baby
    const items = readiness({
      bookings: malaysia,
      documents: [],
      paid: 0,
      total: null,
      travelers: [
        traveler("علي", { passport_expiry: "2033-11-24", birth_date: "1991-02-08", nationality: "IRQ", visa_status: "check" }),
        traveler("سامر", { passport_expiry: "2011-11-09", birth_date: "2026-01-01", nationality: "SYR", visa_status: "check" }),
      ],
      travelStart: "2026-10-31",
      travelEnd: "2026-11-07",
      today: "2026-10-15",
    });
    const passports = items.find((i) => i.key === "passports");
    const visas = items.find((i) => i.key === "visas");
    expect(passports?.ok).toBe(false);
    expect(passports?.detail).toContain("سامر: الجواز منتهٍ يوم السفر");
    expect(passports?.detail).toContain("لا يطابق العرض");
    expect(passports?.detail).not.toContain("علي");
    expect(visas?.ok).toBe(false);
    expect(visas?.detail).toContain("علي: التأشيرة تحتاج تحقق — الجنسية IRQ");
    expect(visas?.detail).toContain("SYR");
  });
});
