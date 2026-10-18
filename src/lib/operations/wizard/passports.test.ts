import { describe, expect, it } from "vitest";
import { checkNames } from "./flights";
import { matchPassport, type MatchRow } from "./passports";

/**
 * Which traveller a passport belongs to, and who is on a ticket — by the name
 * in either script (the owner, 2026-10-18): the MRZ is Latin, the name on the
 * case is often Arabic. A planned name — the client's WhatsApp contact on older
 * cases — is never evidence.
 */

const TRIP = { travel_start: "2026-11-10", travel_end: "2026-11-16" };
const TODAY = "2026-10-18";
const PASSPORT = "MOHAMMED SAAD ALQAHTANI";
const none = new Set<string>();

const row = (id: string, display_name: string, name_source: MatchRow["name_source"] = "manual"): MatchRow => ({
  id,
  display_name,
  name_source,
  traveler_kind: "adult",
  age: null,
  birth_date: null,
  nationality: null,
  has_passport: false,
});
const read = (full_name: string) => ({ full_name, birth_date: "1980-01-01", nationality: "SAU" });

describe("matchPassport, both scripts", () => {
  const rows = [row("first", ""), row("sara", "SARA ALI"), row("ar", "محمد القحطاني")];

  it("gives a Latin passport to the traveller written in Arabic", () => {
    expect(matchPassport(rows, read(PASSPORT), TRIP, TODAY, none)?.id).toBe("ar");
  });

  it("gives a Latin passport to the traveller written in Latin, the surest first", () => {
    expect(matchPassport(rows, read("SARA AHMED ALI"), TRIP, TODAY, none)?.id).toBe("sara");
  });

  it("never matches on a planned name — the client's contact name says nothing", () => {
    const planned = [row("free", ""), row("contact", "AHMED ALI", "seed")];
    expect(matchPassport(planned, read("AHMED ALI HASSAN"), TRIP, TODAY, none)?.id).toBe("free");
    // the same name typed by a person is evidence
    expect(matchPassport([row("free", ""), row("typed", "AHMED ALI")], read("AHMED ALI HASSAN"), TRIP, TODAY, none)?.id).toBe("typed");
  });
});

describe("the ticket's names against the passport's (as wizard-tickets builds them)", () => {
  const ticket = ["ALQAHTANI/MOHAMMED MR"];

  it("is sure against the passport's Latin, likely against the Arabic name alone", () => {
    expect(checkNames(ticket, [{ id: "t1", label: "محمد القحطاني", names: [PASSPORT, "محمد القحطاني"] }]).names[0]).toMatchObject({ traveler_id: "t1", status: "ok" });
    // a viewer who may not open passports has only the case's name — Arabic still heard
    expect(checkNames(ticket, [{ id: "t1", label: "محمد القحطاني", names: ["محمد القحطاني"] }]).names[0]).toMatchObject({ traveler_id: "t1", status: "likely" });
  });

  it("a traveller with no name but a planned one is missing, not matched", () => {
    expect(checkNames(ticket, [{ id: "t1", label: "مسافر 1", names: [] }])).toEqual({
      names: [{ name: ticket[0], traveler_id: null, traveler: null, status: "mismatch" }],
      missing: ["مسافر 1"],
    });
  });
});
