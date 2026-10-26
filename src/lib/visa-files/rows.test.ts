import { describe, expect, it } from "vitest";
import { blankTraveler, boardRowToFile, mergeTravelers, rowToFile, storedTravelers, toColumns, type StoredTraveler, type VisaRowDb } from "./rows";
import type { VisaTraveler } from "./types";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const ctx = { today: "2026-10-26", encrypt: (p: { number: string }) => `enc(${p.number})`, newId: () => "33333333-3333-4333-8333-333333333333" };
const traveler = (over: Partial<VisaTraveler> = {}): VisaTraveler => ({ id: T1, fullName: "مسافر تجريبي", passportNo: null, nationality: "سعودي", birthDate: "1990-05-01", passportExpiry: "2030-01-01", result: null, visaNo: null, note: null, ...over });
const stored = (over: Partial<StoredTraveler> = {}): StoredTraveler => ({ ...blankTraveler(T1), fullName: "مسافر تجريبي", passportEnc: "CIPHER", passportLast4: "6789", ...over });

describe("a stored traveller never shows its passport number", () => {
  const row = (travelers: unknown): VisaRowDb => ({
    id: "f", serial: "VF-26-0001", status: "new", country: "جورجيا", country_id: null, visa_catalog_id: null, visa_type: null, applicants: 1, client_name: "عميل", client_phone: null, conversation_id: null,
    contact_id: null, lead_id: null, assigned_to: null, travelers, documents: null, services: undefined, applied_at: null, appointment_at: null, expected_reply_at: null, replied_at: null,
    fee_service: "400.50", fee_embassy: 0, currency: "SAR", paid: "100", next_action: null, next_action_at: null, note: null, created_by: null, created_at: "2026-10-26T00:00:00Z", updated_at: "2026-10-26T00:00:00Z", rev: 3,
  });

  it("reads back masked, with neither the cipher nor the digits", () => {
    const file = rowToFile(row([stored(), stored({ id: T2, passportEnc: null, passportLast4: null })]));
    expect(file.travelers.map((t) => t.passportNo)).toEqual(["•••• 6789", null]);
    expect(JSON.stringify(file)).not.toContain("CIPHER");
    expect(Object.keys(file.travelers[0])).not.toContain("passportEnc");
  });

  it("tolerates numerics as strings and empty or broken json", () => {
    const file = rowToFile(row(null));
    expect(file.feeService).toBe(400.5);
    expect(file.paid).toBe(100);
    expect(file.travelers).toEqual([]);
    expect(file.documents).toEqual([]);
    expect(file.services).toEqual([]);
  });

  it("the board's rows are mapped from the few columns it reads", () => {
    const f = boardRowToFile({ ...row([]), documents: [{ required: true }] } as never);
    expect(f.feeService).toBe(400.5);
    expect(f.documents).toHaveLength(1);
    expect(storedTravelers({ travelers: "garbage" })).toEqual([]);
  });

  it("toColumns renames the fields to the table's columns and leaves unknown keys", () => {
    expect(toColumns({ clientName: "x", feeEmbassy: 5, expectedReplyAt: null, status: "ready", documents: [] })).toEqual({ client_name: "x", fee_embassy: 5, expected_reply_at: null, status: "ready", documents: [] });
  });
});

describe("saving travellers", () => {
  it("a new number is encrypted and only its last four digits are kept beside it", () => {
    const r = mergeTravelers([traveler({ passportNo: "a 1234 5678" })], [stored({ passportEnc: null, passportLast4: null })], ctx);
    expect(r.ok && r.travelers[0]).toMatchObject({ passportEnc: "enc(A12345678)", passportLast4: "5678" });
    expect(JSON.stringify(r)).not.toContain('"passportNo"');
  });

  it("the masked text, null or an absent value leaves the stored passport alone", () => {
    for (const passportNo of ["•••• 6789", null]) {
      const r = mergeTravelers([traveler({ passportNo })], [stored()], ctx);
      expect(r.ok && r.travelers[0]).toMatchObject({ passportEnc: "CIPHER", passportLast4: "6789" });
    }
  });

  it("an empty string clears it", () => {
    const r = mergeTravelers([traveler({ passportNo: "" })], [stored()], ctx);
    expect(r.ok && r.travelers[0]).toMatchObject({ passportEnc: null, passportLast4: null });
  });

  it("is never stored plain: no vault, no save", () => {
    const r = mergeTravelers([traveler({ passportNo: "A12345678" })], [], { ...ctx, encrypt: () => { throw new Error("vault"); } });
    expect(r).toEqual({ ok: false, error: "تعذّر حفظ رقم الجواز: مفتاح التشفير غير مضبوط." });
  });

  it("refuses a number, a date or a result that cannot be right", () => {
    expect(mergeTravelers([traveler({ passportNo: "سش" })], [], ctx).ok).toBe(false);
    expect(mergeTravelers([traveler({ passportNo: "AB1" })], [], ctx).ok).toBe(false);
    expect(mergeTravelers([traveler({ birthDate: "2031-01-01" })], [], ctx).ok).toBe(false);
    expect(mergeTravelers([traveler({ passportExpiry: "2030-02-30" })], [], ctx).ok).toBe(false);
    expect(mergeTravelers([traveler({ result: "maybe" as never })], [], ctx).ok).toBe(false);
    expect(mergeTravelers([traveler({ fullName: "x".repeat(121) })], [], ctx).ok).toBe(false);
    expect(mergeTravelers(Array.from({ length: 51 }, () => traveler()), [], ctx).ok).toBe(false);
  });

  it("a traveller without a known id gets a new one; one left out of the list is gone", () => {
    const r = mergeTravelers([traveler({ id: "" }), traveler({ id: T2, fullName: "ثان" })], [stored(), stored({ id: T2 })], ctx);
    expect(r.ok && r.travelers.map((t) => t.id)).toEqual(["33333333-3333-4333-8333-333333333333", T2]);
    const dropped = mergeTravelers([traveler({ id: T2 })], [stored(), stored({ id: T2 })], ctx);
    expect(dropped.ok && dropped.travelers.map((t) => t.id)).toEqual([T2]);
  });

  it("dates are kept as days; the embassy's answer is kept per traveller", () => {
    const r = mergeTravelers([traveler({ birthDate: "1990-05-01T00:00:00Z", result: "approved", visaNo: "V123" })], [], ctx);
    expect(r.ok && r.travelers[0]).toMatchObject({ birthDate: "1990-05-01", result: "approved", visaNo: "V123" });
  });
});
