import { describe, expect, it } from "vitest";
import { aheadOfClient, aheadOfExecution, derivedClient, derivedExecution, passportValidFor, readiness } from "./progress";

const b = (kind: string, status = "confirmed") => ({ kind, status });
const malaysia = [b("flight"), b("flight"), b("hotel"), b("hotel"), b("transport"), b("transport"), b("service")];

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

  it("asks a passport to outlive the return by six months", () => {
    expect(passportValidFor("2027-05-27", "2026-11-27")).toBe(true);
    expect(passportValidFor("2027-05-26", "2026-11-27")).toBe(false);
    expect(passportValidFor(null, "2026-11-27")).toBe(false);
  });

  it("lists what «جاهز للسفر» still waits for", () => {
    const items = readiness({
      bookings: malaysia,
      documents: [{ kind: "hotel_voucher" }, { kind: "flight_ticket" }, { kind: "itinerary" }],
      paid: 10_635,
      total: 21_270,
      travelers: [{ name: "أحمد", passport_expiry: "2030-01-01" }, { name: "سارة", passport_expiry: "2027-01-01", visa_status: "submitted" }],
      travelEnd: "2026-11-27",
    });
    expect(Object.fromEntries(items.map((i) => [i.key, i.ok]))).toEqual({ bookings: true, payment: false, documents: true, passports: false, visas: false });
    expect(items.find((i) => i.key === "passports")?.detail).toContain("سارة");
  });
});
