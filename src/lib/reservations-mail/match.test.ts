import { describe, expect, it } from "vitest";
import type { MailRefs } from "./classify";
import { matchEmail, type MatchCandidate } from "./match";

const refs = (over: Partial<MailRefs>): MailRefs => ({ numbers: [], serials: [], hotels: [], guests: [], dates: [], ...over });

const candidate = (over: Partial<MatchCandidate>): MatchCandidate => ({
  booking_id: "b1",
  operation_id: "op1",
  confirmation_number: null,
  supplier_ref: null,
  client_reference: null,
  hotel_title: null,
  guest_names: [],
  check_in: null,
  check_out: null,
  ...over,
});

describe("matchEmail", () => {
  it("matches a confirmation number, spaces and case ignored", () => {
    const hit = matchEmail(refs({ numbers: ["149 322 011"] }), [candidate({ confirmation_number: "149322011" })]);
    expect(hit).toEqual({ booking_id: "b1", operation_id: "op1", matched_by: "number" });
  });

  it("matches our serial against the client reference", () => {
    const hit = matchEmail(refs({ serials: ["TR-1-1234-20261110"] }), [candidate({ client_reference: "tr-1-1234-20261110" })]);
    expect(hit?.matched_by).toBe("number");
  });

  it("a number match beats a name match on another booking", () => {
    const byName = candidate({ booking_id: "name", hotel_title: "فندق النسيم الذهبي", check_in: "2027-02-03", check_out: "2027-02-07" });
    const byNumber = candidate({ booking_id: "num", supplier_ref: "20553311" });
    const hit = matchEmail(refs({ numbers: ["20553311"], hotels: ["فندق النسيم الذهبي"], dates: ["2027-02-04"] }), [byName, byNumber]);
    expect(hit?.booking_id).toBe("num");
    expect(hit?.matched_by).toBe("number");
  });

  it("matches hotel-or-guest name AND a date inside the stay — Arabic spellings folded", () => {
    const c = candidate({ hotel_title: "فندق النسيم الذهبى", guest_names: ["عبدالله الدوسري"], check_in: "2027-02-03", check_out: "2027-02-07" });
    expect(matchEmail(refs({ hotels: ["فندق النسيم الذهبي"], dates: ["2027-02-05"] }), [c])?.matched_by).toBe("name_dates");
    expect(matchEmail(refs({ guests: ["عبدالله الدوسري"], dates: ["2027-02-03"] }), [c])?.matched_by).toBe("name_dates");
  });

  it("a name without a date inside the stay matches nothing", () => {
    const c = candidate({ hotel_title: "Grand Mirage Resort", check_in: "2026-11-10", check_out: "2026-11-14" });
    expect(matchEmail(refs({ hotels: ["Grand Mirage Resort"], dates: ["2026-12-01"] }), [c])).toBeNull();
    expect(matchEmail(refs({ hotels: ["Grand Mirage Resort"] }), [c])).toBeNull();
  });

  it("nothing shared matches nothing", () => {
    const c = candidate({ confirmation_number: "111", hotel_title: "Other Hotel", check_in: "2026-11-10", check_out: "2026-11-14" });
    expect(matchEmail(refs({ numbers: ["999"], hotels: ["Some Hotel"], dates: ["2026-11-11"] }), [c])).toBeNull();
    expect(matchEmail(refs({}), [c])).toBeNull();
  });
});
