import { describe, expect, it } from "vitest";
import { PER_ORIGIN_LIMIT, PER_ORIGIN_WINDOW_MS, allowAttempt, newReferenceNo, readRegistration } from "./registration-form";

const pdf = (name = "cr.pdf", size = 1000, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });

function form(over: Record<string, string | File | null> = {}): FormData {
  const base: Record<string, string | File | null> = {
    name: "سفريات الواحة",
    email: "Info@Oasis.travel",
    phone: "+966 50 000 0000",
    commercial_register: "1010123456",
    city: "جدة",
    country: "السعودية",
    terms: "on",
    doc_commercial_register: pdf(),
    ...over,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(base)) if (v !== null) f.set(k, v);
  return f;
}

describe("the partner registration form", () => {
  it("reads a complete request, its documents and a lower-cased email", () => {
    const r = readRegistration(form({ doc_vat: pdf("vat.png", 2000, "image/png") }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email).toBe("info@oasis.travel");
    expect(r.value.documents.map((d) => `${d.kind}.${d.ext}`)).toEqual(["commercial_register.pdf", "vat.png"]);
  });

  it("refuses without the register, the city and country, the terms, or the register's document", () => {
    expect(readRegistration(form({ commercial_register: "" })).ok).toBe(false);
    expect(readRegistration(form({ city: "" })).ok).toBe(false);
    expect(readRegistration(form({ terms: null })).ok).toBe(false);
    expect(readRegistration(form({ doc_commercial_register: null })).ok).toBe(false);
  });

  it("refuses a document that is not a PDF or an image, or is over 5MB", () => {
    expect(readRegistration(form({ doc_tourism_license: pdf("x.exe", 10, "application/x-msdownload") }))).toMatchObject({ ok: false });
    expect(readRegistration(form({ doc_commercial_register: pdf("big.pdf", 5 * 1024 * 1024 + 1) }))).toMatchObject({ ok: false });
  });

  it("numbers a request by its Riyadh day, with no 0/O or 1/I to misread", () => {
    const ref = newReferenceNo(new Date("2026-10-12T22:30:00Z"), () => 0.5);
    expect(ref).toMatch(/^B2B-261013-[2-9A-HJ-NP-Z]{4}$/);
  });
});

describe("the name-clash lookup cannot be turned into a probe (security audit L12)", () => {
  it("refuses every ilike wildcard and the escape in the company name", () => {
    for (const name of ["تر%", "سفر_يات", "ترا*", "سفريات\\الواحة"]) {
      expect(readRegistration(form({ name })).ok).toBe(false);
    }
  });

  it("collapses runs of spaces so the lookup and the unique index see one name", () => {
    const r = readRegistration(form({ name: "  سفريات    الواحة " }));
    expect(r.ok && r.value.name).toBe("سفريات الواحة");
  });
});

describe("allowAttempt", () => {
  it("allows the limit per window, then refuses until the window passes", () => {
    const log = new Map<string, number[]>();
    for (let i = 0; i < PER_ORIGIN_LIMIT; i++) expect(allowAttempt(log, "1.2.3.4", 1000 + i)).toBe(true);
    expect(allowAttempt(log, "1.2.3.4", 2000)).toBe(false);
    expect(allowAttempt(log, "5.6.7.8", 2000)).toBe(true);
    expect(allowAttempt(log, "1.2.3.4", 1000 + PER_ORIGIN_WINDOW_MS + 5)).toBe(true);
  });
});
