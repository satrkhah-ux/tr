import { describe, expect, it } from "vitest";
import { mrzCheckDigit, parseTd3, trustedFields, type MrzPassport } from "./mrz";

// The ICAO 9303 specimen passport — every check digit in it is known-good.
const L1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const L2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
const TODAY = "2026-10-13";

/** a line 2 with correct digits, for cases the specimen does not cover. */
function line2(number: string, nat: string, birth: string, sex: string, expiry: string): string {
  const num = number.padEnd(9, "<");
  const personal = "<".repeat(14);
  const body = `${num}${mrzCheckDigit(num)}${nat}${birth}${mrzCheckDigit(birth)}${sex}${expiry}${mrzCheckDigit(expiry)}${personal}<`;
  const composite = mrzCheckDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
  return body + composite;
}

describe("mrzCheckDigit", () => {
  it("matches the specimen's digits", () => {
    expect(mrzCheckDigit("L898902C3")).toBe(6);
    expect(mrzCheckDigit("740812")).toBe(2);
    expect(mrzCheckDigit("120415")).toBe(9);
  });
});

describe("parseTd3", () => {
  it("reads the ICAO specimen with every check passing", () => {
    const res = parseTd3(`${L1}\n${L2}`, TODAY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.passport).toMatchObject({
      surname: "ERIKSSON",
      given_names: "ANNA MARIA",
      full_name: "ANNA MARIA ERIKSSON",
      number: "L898902C3",
      nationality: "UTO",
      issuing_state: "UTO",
      birth_date: "1974-08-12",
      sex: "F",
      expiry: "2012-04-15",
      failed: [],
    });
  });

  it("names the field whose digit is wrong instead of trusting it", () => {
    // one misread character in the number: its own check and the composite fail
    const res = parseTd3(`${L1}\n${L2.replace("L898902C3", "L898902C8")}`, TODAY);
    expect(res.ok && res.passport.failed).toEqual(["number", "composite"]);
  });

  it("survives spaces, lower case and dropped trailing fillers from a transcription", () => {
    const res = parseTd3(`  p<uto eriksson<<anna<maria\n${L2.slice(0, 22)} ${L2.slice(22)}  `, TODAY);
    expect(res.ok && res.passport.full_name).toBe("ANNA MARIA ERIKSSON");
    expect(res.ok && res.passport.failed).toEqual([]);
  });

  it("puts a child's birth year in this century and an old one in the last", () => {
    const child = parseTd3(`P<SAUTRAVELIUN<<TECH\n${line2("A1234567", "SAU", "170301", "M", "300101")}`, TODAY);
    expect(child.ok && child.passport.birth_date).toBe("2017-03-01");
    expect(child.ok && child.passport.expiry).toBe("2030-01-01");
    expect(child.ok && child.passport.nationality).toBe("SAU");
    expect(child.ok && child.passport.failed).toEqual([]);

    const adult = parseTd3(`P<SAUTRAVELIUN<<TECH\n${line2("A1234567", "SAU", "850301", "M", "300101")}`, TODAY);
    expect(adult.ok && adult.passport.birth_date).toBe("1985-03-01");
  });

  it("rejects text that is not a passport MRZ", () => {
    expect(parseTd3("", TODAY).ok).toBe(false);
    expect(parseTd3("hello world", TODAY).ok).toBe(false);
    expect(parseTd3(`${L1}`, TODAY).ok).toBe(false);
  });

  it("keeps the fields that pass when junk trails line 2, instead of throwing the read away", () => {
    const res = parseTd3(`${L1}\n${L2}XYZ`, TODAY);
    expect(res.ok && res.passport.number).toBe("L898902C3");
    expect(res.ok && res.passport.failed).not.toContain("number");
    expect(res.ok && res.passport.failed).not.toContain("birth_date");
    expect(res.ok && res.passport.failed).not.toContain("expiry");
  });

  it("returns a null date rather than an impossible one", () => {
    const res = parseTd3(`${L1}\n${line2("A1234567", "SAU", "851399", "M", "300101")}`, TODAY);
    expect(res.ok && res.passport.birth_date).toBeNull();
  });
});

// the owner, 2026-10-22: «الجوازات لا يقرأها بالشكل الصحيح» — 15 live reads, none passed every check
describe("parseTd3 — what a reader gets wrong", () => {
  const SAUDI = line2("A1234567", "SAU", "850301", "M", "300101");
  const L1S = "P<SAUALQAHTANI<<MOHAMMED<ABDULLAH<<<<<<<<<<<";
  const clean = (l2: string) => parseTd3(`${L1S}\n${l2}`, TODAY);

  it("reads a Saudi 8-character number padded with «<»", () => {
    const res = clean(SAUDI);
    expect(res.ok && res.passport).toMatchObject({ number: "A1234567", nationality: "SAU", birth_date: "1985-03-01", expiry: "2030-01-01", failed: [] });
  });

  it("re-aligns line 2 when the number's «<» was dropped or doubled", () => {
    const dropped = SAUDI.slice(0, 8) + SAUDI.slice(9); // 43 characters
    const doubled = SAUDI.slice(0, 8) + "<" + SAUDI.slice(8); // 45
    for (const l2 of [dropped, doubled]) {
      const res = clean(l2);
      expect(res.ok && res.passport).toMatchObject({ number: "A1234567", birth_date: "1985-03-01", expiry: "2030-01-01", failed: [] });
    }
  });

  it("trims a 45-character line and pads a short one", () => {
    expect(clean(`${SAUDI}<`).ok && clean(`${SAUDI}<`)).toMatchObject({ passport: { failed: [] } });
    expect(clean(SAUDI.replace(/<+(\d)$/, "$1")).ok && clean(SAUDI.replace(/<+(\d)$/, "$1"))).toMatchObject({ passport: { failed: [] } });
    expect(parseTd3(`${L1S}<<<\n${SAUDI}`, TODAY)).toMatchObject({ ok: true, passport: { surname: "ALQAHTANI", given_names: "MOHAMMED ABDULLAH" } });
  });

  it("repairs look-alikes the check digits vouch for: letters in a date, a digit in the number, a digit in a name", () => {
    // 850301 read «85O3O1», the number's 5 read «S», the name's O read «0»
    const misread = SAUDI.slice(0, 5) + "S" + SAUDI.slice(6, 13) + "85O3O1" + SAUDI.slice(19);
    const res = parseTd3(`${L1S.replace("MOHAMMED", "M0HAMMED")}\n${misread}`, TODAY);
    expect(res.ok && res.passport).toMatchObject({ number: "A1234567", birth_date: "1985-03-01", given_names: "MOHAMMED ABDULLAH", failed: [] });
  });

  it("does not guess a number when the composite does not confirm the swap", () => {
    const misread = SAUDI.slice(0, 5) + "S" + SAUDI.slice(6, 43) + String((Number(SAUDI[43]) + 1) % 10);
    const res = clean(misread);
    expect(res.ok && res.passport.failed).toEqual(["number", "composite"]);
    expect(res.ok && trustedFields(res.passport, TODAY).values.number).toBe("");
  });
});

describe("trustedFields — a failed read never invents data", () => {
  const read = (patch: Partial<MrzPassport>): MrzPassport => ({
    surname: "SAMER",
    given_names: "ALI",
    full_name: "ALI SAMER",
    number: "N01234567",
    nationality: "SYR",
    issuing_state: "SYR",
    birth_date: "1990-05-01",
    sex: "M",
    expiry: "2030-01-01",
    failed: [],
    ...patch,
  });

  it("passes a clean read through whole", () => {
    expect(trustedFields(read({}), TODAY)).toEqual({
      values: { full_name: "ALI SAMER", number: "N01234567", nationality: "SYR", birth_date: "1990-05-01", expiry: "2030-01-01" },
      missing: [],
    });
  });

  it("leaves the Syrian traveller's 1 January of this year empty instead of writing it", () => {
    // what the live case got: the number failed its digit and the birth date read as 2026-01-01
    const res = trustedFields(read({ birth_date: "2026-01-01", failed: ["number", "personal", "composite"] }), TODAY);
    expect(res.values.birth_date).toBe("");
    expect(res.values.number).toBe("");
    expect(res.missing).toEqual(["number", "birth_date"]);
  });

  it("never pre-fills today, a future birthday, or a field whose own check digit failed", () => {
    expect(trustedFields(read({ birth_date: TODAY }), TODAY).missing).toEqual(["birth_date"]);
    expect(trustedFields(read({ birth_date: "2026-12-01" }), TODAY).missing).toEqual(["birth_date"]);
    expect(trustedFields(read({ failed: ["expiry"] }), TODAY).missing).toEqual(["expiry"]);
    expect(trustedFields(read({ failed: ["birth_date"] }), TODAY).missing).toEqual(["birth_date"]);
    // an old 1 January is a real birthday on many passports
    expect(trustedFields(read({ birth_date: "1980-01-01" }), TODAY).missing).toEqual([]);
  });

  it("names every field the read did not give", () => {
    const res = trustedFields(read({ full_name: "", nationality: "", birth_date: null, expiry: null, number: "" }), TODAY);
    expect(res.missing).toEqual(["full_name", "number", "nationality", "birth_date", "expiry"]);
    expect(Object.values(res.values).every((v) => v === "")).toBe(true);
  });
});
