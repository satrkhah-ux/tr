import { describe, expect, it } from "vitest";
import {
  NAME_MAX,
  NOTE_MAX,
  PENDING_CAP,
  PER_IP_24H,
  normalizeRegistration,
  rateDecision,
  type RegistrationInput,
} from "./register-rules";

/**
 * The public staff form. Each rule mirrors a CHECK on staff_registrations, so a
 * slip here is an applicant told "try again" for a reason nobody can see.
 */

const good: RegistrationInput = {
  arabic_name: "  سارة العتيبي ",
  english_name: " Sara ",
  email: "  Sara.Otaibi@Example.COM ",
  mobile: "+966 50-123 4567",
  password: "correct horse",
  password_confirm: "correct horse",
  note: "  مبيعات — فرع الرياض ",
};

function errorOf(patch: Partial<RegistrationInput>) {
  const res = normalizeRegistration({ ...good, ...patch });
  return res.ok ? null : res.error;
}

describe("normalizeRegistration", () => {
  it("trims, lowercases the email and keeps only digits and + in the mobile", () => {
    const res = normalizeRegistration(good);
    expect(res).toEqual({
      ok: true,
      value: {
        arabic_name: "سارة العتيبي",
        english_name: "Sara",
        email: "sara.otaibi@example.com",
        mobile: "+966501234567",
        note: "مبيعات — فرع الرياض",
        password: "correct horse",
      },
    });
  });

  it("stores empty optional fields as null", () => {
    const res = normalizeRegistration({ ...good, english_name: "  ", note: "" });
    expect(res.ok && res.value.english_name).toBeNull();
    expect(res.ok && res.value.note).toBeNull();
  });

  it("requires an Arabic name of 3 to 80 characters", () => {
    expect(errorOf({ arabic_name: "  سا " })).toBe("reg.err.name");
    expect(errorOf({ arabic_name: "س".repeat(NAME_MAX + 1) })).toBe("reg.err.name");
    expect(errorOf({ arabic_name: "س".repeat(NAME_MAX) })).toBeNull();
  });

  it("caps the English name at 80 characters", () => {
    expect(errorOf({ english_name: "a".repeat(NAME_MAX + 1) })).toBe("reg.err.name");
  });

  it("refuses an address that is not an email", () => {
    expect(errorOf({ email: "sara@example" })).toBe("reg.err.email");
    expect(errorOf({ email: "sara example.com" })).toBe("reg.err.email");
  });

  it("refuses * — PostgREST would read it as an ilike wildcard against employees", () => {
    expect(errorOf({ email: "ab*@traveliun.co*" })).toBe("reg.err.email");
    expect(errorOf({ email: "*@example.com" })).toBe("reg.err.email");
  });

  it("requires 8 to 15 digits in the mobile", () => {
    expect(errorOf({ mobile: "1234567" })).toBe("reg.err.mobile");
    expect(errorOf({ mobile: "1".repeat(16) })).toBe("reg.err.mobile");
    expect(errorOf({ mobile: "0501234567x" })).toBe("reg.err.mobile");
    expect(errorOf({ mobile: "05012345" })).toBeNull();
  });

  it("reads Arabic-Indic and Eastern-Arabic digits as 0-9", () => {
    const arabic = normalizeRegistration({ ...good, mobile: "٠٥٥ ١٢٣ ٤٥٦٧" });
    expect(arabic.ok && arabic.value.mobile).toBe("0551234567");
    const eastern = normalizeRegistration({ ...good, mobile: "+۹۶۶۵۰۱۲۳۴۵۶۷" });
    expect(eastern.ok && eastern.value.mobile).toBe("+966501234567");
  });

  it("requires a password of at least 8 characters and at most 72 bytes", () => {
    expect(errorOf({ password: "short", password_confirm: "short" })).toBe("reg.err.password");
    // 40 Arabic letters = 80 bytes: under 72 characters, over bcrypt's limit.
    const arabic = "ك".repeat(40);
    expect(errorOf({ password: arabic, password_confirm: arabic })).toBe("reg.err.password");
  });

  it("requires the confirmation to match", () => {
    expect(errorOf({ password_confirm: "correct horsE" })).toBe("reg.err.mismatch");
  });

  it("cuts the note to 500 characters rather than failing the request", () => {
    const res = normalizeRegistration({ ...good, note: "ن".repeat(NOTE_MAX + 50) });
    expect(res.ok && res.value.note?.length).toBe(NOTE_MAX);
  });
});

describe("rateDecision", () => {
  it("lets a request through under both limits", () => {
    expect(rateDecision({ ipCount24h: PER_IP_24H - 1, pendingTotal: PENDING_CAP - 1 })).toBe("ok");
  });

  it("closes after 3 requests from one origin in 24 hours", () => {
    expect(rateDecision({ ipCount24h: PER_IP_24H, pendingTotal: 0 })).toBe("closed");
  });

  it("closes for everyone once 20 requests are waiting", () => {
    expect(rateDecision({ ipCount24h: 0, pendingTotal: PENDING_CAP })).toBe("closed");
  });
});
