import { describe, expect, it } from "vitest";
import { aheadOfClient, aheadOfExecution, derivedClient, derivedExecution, passportAlerts, type AlertTraveler, type ProgressBooking } from "./progress";

// a confirmed booking carries its number — a hand confirmation refuses one without it;
// a confirmed flight is a ticketed one here («صدرت التذكرة»), as the ladder needs
const b = (kind: string, status = "confirmed", over: Partial<ProgressBooking> = {}): ProgressBooking => ({
  kind,
  status,
  confirmation_number: status === "confirmed" ? "CONF-1" : null,
  ...(kind === "flight" && status === "confirmed" ? { is_paid: true } : {}),
  ...over,
});
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

  it("climbs the flight and hotel rungs by the wizard's own done-rules, not by «confirmed» alone", () => {
    // a hotel «confirmed» on OUR number only is not booked — its tile is red, the client is not told
    const ours = b("hotel", "confirmed", { confirmation_number: "AD-2-7287-H1", company_ref: "AD-2-7287-H1" });
    expect(derivedExecution([b("flight"), ours], [])).toBe("flights_booked");
    // a flight confirmed by hand with its number and «صدرت التذكرة» in «عرض الكل» is booked, as everywhere
    expect(derivedExecution([b("flight", "confirmed", { confirmation_number: "PNR6XK" }), b("hotel"), b("transport", "pending")], [])).toBe("hotels_booked");
    // a seat the airline only holds — its number, no ticket — is not
    expect(derivedExecution([b("flight", "confirmed", { confirmation_number: "PNR6XK", is_paid: false }), b("hotel")], [])).toBeNull();
    // «confirmed» with nothing the airline issued is not
    expect(derivedExecution([b("flight", "confirmed", { confirmation_number: null }), b("hotel")], [])).toBeNull();
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
});
