import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyByRules, extractRefs } from "./classify";

// the rules path only — classify()'s model refinement needs a key and is never called here
const fixture = (name: string): { subject: string; body: string } => {
  const raw = readFileSync(fileURLToPath(new URL(`./fixtures/${name}.txt`, import.meta.url)), "utf8");
  const subject = /^Subject: (.*)$/m.exec(raw)?.[1] ?? "";
  const body = raw.slice(raw.indexOf("\n\n") + 2);
  return { subject, body };
};

describe("classifyByRules", () => {
  it("reads a TBO confirmation", () => {
    const { subject, body } = fixture("tbo-confirmation");
    expect(classifyByRules(subject, body)).toBe("confirmation");
  });

  it("reads a no-availability apology", () => {
    const { subject, body } = fixture("no-availability");
    expect(classifyByRules(subject, body)).toBe("no_availability");
  });

  it("reads a hotel change — before the confirmation word it also carries", () => {
    const { subject, body } = fixture("hotel-change");
    expect(classifyByRules(subject, body)).toBe("hotel_change");
  });

  it("reads an Arabic cancellation", () => {
    const { subject, body } = fixture("arabic-cancellation");
    expect(classifyByRules(subject, body)).toBe("cancellation");
  });

  it("a newsletter is other", () => {
    const { subject, body } = fixture("newsletter");
    expect(classifyByRules(subject, body)).toBe("other");
  });
});

describe("extractRefs", () => {
  it("finds the confirmation number, our serial, hotel, guest and dates", () => {
    const { subject, body } = fixture("tbo-confirmation");
    const refs = extractRefs(subject, body);
    expect(refs.numbers).toContain("149322011");
    expect(refs.serials).toContain("TR-1-1234-20261110");
    // the serial never doubles as a plain number
    expect(refs.numbers).not.toContain("TR-1-1234-20261110");
    expect(refs.hotels).toContain("Grand Mirage Resort");
    expect(refs.guests).toContain("Fahad Alqahtani");
    expect(refs.dates).toContain("2026-11-10");
    expect(refs.dates).toContain("2026-11-14");
  });

  it("reads Arabic labels and dd/mm/yyyy dates", () => {
    const { subject, body } = fixture("arabic-cancellation");
    const refs = extractRefs(subject, body);
    expect(refs.numbers).toContain("20553311");
    expect(refs.hotels).toContain("فندق النسيم الذهبي");
    expect(refs.guests).toContain("عبدالله الدوسري");
    expect(refs.dates).toContain("2027-02-03");
    expect(refs.dates).toContain("2027-02-07");
  });

  it("a labelled reference silences the bare long numbers of the body", () => {
    const refs = extractRefs("Re: booking", "Booking Ref: 445566\nCall us on 0501234567 anytime.");
    expect(refs.numbers).toEqual(["445566"]);
  });

  it("a newsletter yields no references", () => {
    const { subject, body } = fixture("newsletter");
    const refs = extractRefs(subject, body);
    expect(refs.numbers).toEqual([]);
    expect(refs.serials).toEqual([]);
    expect(refs.guests).toEqual([]);
  });
});
