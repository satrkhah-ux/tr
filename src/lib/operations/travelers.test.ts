import { describe, expect, it } from "vitest";
import {
  ageOn,
  isCalendarDate,
  isLatinName,
  leadName,
  passportIssues,
  passportNeedsUpdate,
  planTravelers,
  sameName,
  savedName,
  passportNumber,
  takesPassportName,
  travelerInputError,
  travelerReadiness,
  visaFor,
} from "./travelers";

const MALAYSIA = { travel_start: "2026-11-01", travel_end: "2026-11-08" };
const TODAY = "2026-10-13";

describe("planTravelers", () => {
  it("makes the Malaysia case: two adults, children of 9 and 5 — nobody named after the client's WhatsApp contact", () => {
    const rows = planTravelers({
      adults: 2,
      children: 2,
      infants: 0,
      children_ages: [9, 5],
      infant_ages: [],
      visa_required: false,
    });
    expect(rows.map((r) => [r.traveler_kind, r.age, r.display_name, r.sort])).toEqual([
      ["adult", null, "", 0],
      ["adult", null, "", 1],
      ["child", 9, "", 2],
      ["child", 5, "", 3],
    ]);
    expect(rows.every((r) => r.visa_status === "not_required")).toBe(true);
  });

  it("marks everyone's visa required when the offer sold visas, and never plans nobody", () => {
    const rows = planTravelers({ adults: 0, children: 0, infants: 1, children_ages: [], infant_ages: [1], visa_required: true });
    expect(rows.map((r) => r.traveler_kind)).toEqual(["adult", "infant"]);
    expect(rows.every((r) => r.visa_status === "required")).toBe(true);
  });
});

describe("the traveller's name: the passport's, never the contact's (the owner, 2026-10-18)", () => {
  const PASSPORT = "MOHAMMED SAAD ALQAHTANI";
  const seeded = { display_name: "al 3r18y", name_source: "seed" as const };
  const typed = { display_name: "محمد القحطاني", name_source: "manual" as const };

  it("a read passport replaces a seeded, an earlier passport's or an empty name", () => {
    expect(savedName(seeded, "al 3r18y", PASSPORT)).toEqual({ display_name: PASSPORT, name_source: "passport" });
    expect(savedName({ display_name: "MOHAMED ALQAHTANI", name_source: "passport" }, "MOHAMED ALQAHTANI", PASSPORT)).toEqual({ display_name: PASSPORT, name_source: "passport" });
    expect(savedName({ display_name: "", name_source: "seed" }, "", PASSPORT)).toEqual({ display_name: PASSPORT, name_source: "passport" });
    expect(savedName(null, "", PASSPORT)).toEqual({ display_name: PASSPORT, name_source: "passport" });
  });

  it("a typed name stays — and one of unknown source (before 0091) is asked about too", () => {
    expect(savedName(typed, typed.display_name, PASSPORT)).toEqual(typed);
    expect(savedName({ display_name: "al 3r18y" }, "al 3r18y", PASSPORT)).toEqual({ display_name: "al 3r18y", name_source: "manual" });
    expect(takesPassportName(typed)).toBe(false);
    expect(takesPassportName({ display_name: "x", name_source: null })).toBe(false);
    expect(takesPassportName(seeded)).toBe(true);
    expect(takesPassportName(null)).toBe(true);
  });

  it("a name changed in the save is the person's: the passport's when it is that, else typed", () => {
    // «استبدال بالاسم من الجواز»
    expect(savedName(typed, PASSPORT, PASSPORT)).toEqual({ display_name: PASSPORT, name_source: "passport" });
    expect(savedName(seeded, "Mohammed  Saad Alqahtani", PASSPORT)).toEqual({ display_name: "Mohammed  Saad Alqahtani", name_source: "passport" });
    expect(savedName(seeded, "أبو سعد", PASSPORT)).toEqual({ display_name: "أبو سعد", name_source: "manual" });
    expect(savedName(null, "Sara", "")).toEqual({ display_name: "Sara", name_source: "manual" });
    // a save without a passport leaves the name and its source alone
    expect(savedName(seeded, "al 3r18y", "")).toEqual(seeded);
  });

  it("compares names case and spacing aside", () => {
    expect(sameName(" mohammed  saad ", "MOHAMMED SAAD")).toBe(true);
    expect(sameName("", "")).toBe(false);
  });

  it("the lead's name: the first traveller named, never a fallback", () => {
    expect(leadName([{ display_name: " " }, { display_name: ` ${PASSPORT} ` }])).toBe(PASSPORT);
    expect(leadName([{ display_name: "" }])).toBe("");
    expect(leadName([])).toBe("");
  });
});

describe("travelerInputError — a passport typed by hand (AD-2-3599)", () => {
  it("refuses a birth date in the future — it made a traveller «رضيع» at -1", () => {
    expect(travelerInputError({ birth_date: "2026-10-30" }, "2026-10-18")).toBe("birthFuture");
    expect(travelerInputError({ birth_date: "2026-10-18" }, "2026-10-18")).toBeNull();
  });

  it("refuses an implausible one, and a date that is no day", () => {
    expect(travelerInputError({ birth_date: "1899-12-31" }, "2026-10-18")).toBe("birthOld");
    expect(travelerInputError({ birth_date: "1985-02-30" }, "2026-10-18")).toBe("date");
    expect(travelerInputError({ passport_expiry: "2031-13-01" }, "2026-10-18")).toBe("date");
    expect(travelerInputError({ passport_expiry: "2031-06-31" }, "2026-10-18")).toBe("date");
    expect(travelerInputError({ birth_date: "1985-04-12", passport_expiry: "2031-06-30" }, "2026-10-18")).toBeNull();
    expect([isCalendarDate("2028-02-29"), isCalendarDate("2027-02-29"), isCalendarDate("12/04/1985")]).toEqual([true, false, false]);
  });

  it("takes a passport number in Latin letters and digits only — upper-cased, spaces dropped", () => {
    expect(travelerInputError({ number: "سش" }, "2026-10-18")).toBe("passportNo");
    expect(travelerInputError({ number: "A12-3456" }, "2026-10-18")).toBe("passportNo");
    expect(travelerInputError({ number: "a12 345 67" }, "2026-10-18")).toBeNull();
    expect(passportNumber(" a12 345 67 ")).toBe("A1234567");
    // no number typed: nothing to check
    expect(travelerInputError({ number: "" }, "2026-10-18")).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts whole years, turning on the birthday itself", () => {
    expect(ageOn("2017-11-01", "2026-10-31")).toBe(8);
    expect(ageOn("2017-11-01", "2026-11-01")).toBe(9);
    expect(ageOn(null, "2026-11-01")).toBeNull();
  });
});

describe("travelerReadiness", () => {
  const ready = {
    has_passport: true,
    passport_expiry: "2029-01-01",
    visa_status: "not_required" as const,
    birth_date: "1985-03-01",
    age: null,
    traveler_kind: "adult" as const,
  };

  it("is empty for a traveler with everything in order", () => {
    expect(travelerReadiness(ready, MALAYSIA, TODAY)).toEqual([]);
  });

  it("asks for the passport, then for its expiry", () => {
    expect(travelerReadiness({ ...ready, has_passport: false, passport_expiry: null }, MALAYSIA, TODAY)).toEqual(["passport"]);
    expect(travelerReadiness({ ...ready, passport_expiry: null }, MALAYSIA, TODAY)).toEqual(["passport_expiry"]);
  });

  it("wants six months after the RETURN, not after today", () => {
    // fine six months from today, short six months from the 8 Nov return
    expect(travelerReadiness({ ...ready, passport_expiry: "2027-04-20" }, MALAYSIA, TODAY)).toEqual(["passport_short"]);
    expect(travelerReadiness({ ...ready, passport_expiry: "2027-06-01" }, MALAYSIA, TODAY)).toEqual([]);
  });

  it("holds a visa that is required or submitted, passes one issued or not needed", () => {
    expect(travelerReadiness({ ...ready, visa_status: "required" }, MALAYSIA, TODAY)).toEqual(["visa"]);
    expect(travelerReadiness({ ...ready, visa_status: "submitted" }, MALAYSIA, TODAY)).toEqual(["visa"]);
    expect(travelerReadiness({ ...ready, visa_status: "issued" }, MALAYSIA, TODAY)).toEqual([]);
  });

  it("flags a child whose birth date disagrees with the age sold, on the travel day", () => {
    const child = { ...ready, traveler_kind: "child" as const, age: 9 };
    expect(travelerReadiness({ ...child, birth_date: "2017-06-10" }, MALAYSIA, TODAY)).toEqual([]);
    expect(travelerReadiness({ ...child, birth_date: "2015-06-10" }, MALAYSIA, TODAY)).toEqual(["age_mismatch"]);
    // turns 12 before departure: no longer a child at all
    expect(travelerReadiness({ ...child, age: null, birth_date: "2014-10-20" }, MALAYSIA, TODAY)).toEqual(["age_mismatch"]);
    // no birth date yet: nothing to compare, not a mismatch
    expect(travelerReadiness({ ...child, birth_date: null }, MALAYSIA, TODAY)).toEqual([]);
  });
});

describe("passportIssues — one decision for the case, «جاهز للسفر» and /trip", () => {
  const ok = { has_passport: true, passport_expiry: "2029-01-01", birth_date: "1985-03-01", age: null, traveler_kind: "adult" as const };

  it("calls a passport expired on the travel day, not merely short", () => {
    expect(passportIssues({ ...ok, passport_expiry: "2011-11-09" }, MALAYSIA, TODAY)).toEqual(["passport_expired"]);
    // valid on the day it leaves, but not for six months after the return
    expect(passportIssues({ ...ok, passport_expiry: "2026-12-01" }, MALAYSIA, TODAY)).toEqual(["passport_short"]);
    expect(passportIssues(ok, MALAYSIA, TODAY)).toEqual([]);
  });

  it("flags for the client only what a new passport can fix — expired, short, or the wrong age", () => {
    expect(passportNeedsUpdate(passportIssues({ ...ok, passport_expiry: "2011-11-09" }, MALAYSIA, TODAY))).toBe(true);
    expect(passportNeedsUpdate(passportIssues({ ...ok, passport_expiry: "2027-04-20" }, MALAYSIA, TODAY))).toBe(true);
    // the Syrian traveller: birth date 2026-01-01 on an adult booking
    expect(passportNeedsUpdate(passportIssues({ ...ok, birth_date: "2026-01-01" }, MALAYSIA, TODAY))).toBe(true);
    // an expiry nobody typed yet is our gap, not the client's
    expect(passportNeedsUpdate(passportIssues({ ...ok, passport_expiry: null }, MALAYSIA, TODAY))).toBe(false);
    expect(passportNeedsUpdate(passportIssues(ok, MALAYSIA, TODAY))).toBe(false);
  });

  it("holds readiness while a visa needs checking", () => {
    expect(travelerReadiness({ ...ok, visa_status: "check" }, MALAYSIA, TODAY)).toEqual(["visa_check"]);
  });
});

describe("visaFor — nationality x destination", () => {
  const INDONESIA = { iso2: "ID", visa_required: false };
  const AZERBAIJAN = { iso2: "AZ", visa_required: true };

  it("lets a Saudi (or a case with no passport read yet) follow the destination's own setting, as before", () => {
    expect(visaFor("SAU", INDONESIA, false)).toBe("not_required");
    expect(visaFor("SAU", AZERBAIJAN, false)).toBe("required");
    expect(visaFor(null, INDONESIA, false)).toBe("not_required");
    expect(visaFor(" sau ", AZERBAIJAN, false)).toBe("required");
    expect(visaFor("SAU", null, false)).toBe("not_required");
  });

  it("reads a Saudi nationality however it was typed (the owner, 2026-10-22)", () => {
    for (const typed of ["سعودي", "سعودية", "السعودية", "Saudi", "SA", " sa "]) {
      expect(visaFor(typed, INDONESIA, false)).toBe("not_required");
      expect(visaFor(typed, AZERBAIJAN, false)).toBe("required");
    }
    expect(visaFor("KW", { iso2: "AE", visa_required: false }, false)).toBe("not_required");
  });

  it("never says «غير مطلوبة» for any other nationality — Iraqi and Syrian to Indonesia need checking", () => {
    expect(visaFor("IRQ", INDONESIA, false)).toBe("check");
    expect(visaFor("SYR", INDONESIA, false)).toBe("check");
    expect(visaFor("EGY", null, false)).toBe("check");
  });

  it("knows the starting exemption list: GCC citizens inside the GCC", () => {
    expect(visaFor("KWT", { iso2: "AE", visa_required: false }, false)).toBe("not_required");
    expect(visaFor("SAU", { iso2: "BH", visa_required: true }, false)).toBe("not_required");
    // a GCC citizen OUTSIDE the GCC is not on the list
    expect(visaFor("KWT", INDONESIA, false)).toBe("check");
  });

  it("keeps a visa the offer sold required, whoever travels", () => {
    expect(visaFor("SAU", INDONESIA, true)).toBe("required");
    expect(visaFor("IRQ", INDONESIA, true)).toBe("required");
  });
});

describe("isLatinName", () => {
  it("accepts a passport-style name and refuses Arabic or digits", () => {
    expect(isLatinName("AHMED ALI")).toBe(true);
    expect(isLatinName("Mary-Jane O'Neil")).toBe(true);
    expect(isLatinName("ترافليون التقني")).toBe(false);
    expect(isLatinName("0553300417")).toBe(false);
    expect(isLatinName("")).toBe(false);
  });
});
