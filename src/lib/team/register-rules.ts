/**
 * The rules a staff self-registration must pass, kept pure so they can be
 * tested without a database.
 *
 * The limits mirror the CHECK constraints on staff_registrations (0046): a
 * value that passes here must never be refused by the table, or the applicant
 * gets a generic failure for something we could have named.
 */

import { normalizeDigits } from "@/lib/repackage/extract/arabic";

export type RegistrationInput = {
  arabic_name: string;
  english_name?: string;
  email: string;
  mobile: string;
  password: string;
  password_confirm: string;
  note?: string;
};

export type CleanRegistration = {
  arabic_name: string;
  english_name: string | null;
  email: string;
  mobile: string;
  note: string | null;
  password: string;
};

export type RegistrationError =
  | "reg.err.name"
  | "reg.err.email"
  | "reg.err.mobile"
  | "reg.err.password"
  | "reg.err.mismatch";

export const NAME_MIN = 3;
export const NAME_MAX = 80;
export const NOTE_MAX = 500;
export const PASSWORD_MIN = 8;
/** bcrypt reads 72 BYTES (an Arabic letter is two); Supabase refuses longer. */
export const PASSWORD_MAX = 72;

/** Requests one network origin may file in 24 hours. */
export const PER_IP_24H = 3;
/**
 * Open requests across everyone. The real backstop: the forwarded IP can be
 * spoofed, this cannot. Above it the form says registration is paused.
 */
export const PENDING_CAP = 20;
/** A rejected address cannot re-apply (silently) for this long. */
export const REJECT_COOLDOWN_DAYS = 30;
/**
 * How a pending applicant's account is held shut: banned for ~100 years, so it
 * cannot get a session until approval lifts it ("none").
 */
export const PENDING_BAN = "876000h";

/**
 * No `*` anywhere: PostgREST reads it as a wildcard inside ilike (the staff
 * lookup in staff-registration.ts), and escaping it does not survive. Allowed,
 * «ab*@traveliun.co*» would test a prefix against every employee's address.
 */
const EMAIL = /^[^\s@*]+@[^\s@*]+\.[^\s@*]{2,}$/;

export function normalizeRegistration(
  input: RegistrationInput,
): { ok: true; value: CleanRegistration } | { ok: false; error: RegistrationError } {
  const arabic = input.arabic_name.trim();
  const english = (input.english_name ?? "").trim();
  if (arabic.length < NAME_MIN || arabic.length > NAME_MAX || english.length > NAME_MAX) {
    return { ok: false, error: "reg.err.name" };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "reg.err.email" };

  // Spaces, dashes and brackets are how people type numbers; only digits and a
  // leading + are kept. 8–15 digits is every real mobile and fits the column.
  // An Arabic keyboard types ٠٥٥…, which \d does not match — read it as 055….
  const mobile = normalizeDigits(input.mobile).replace(/[\s()-]/g, "");
  if (!/^\+?\d{8,15}$/.test(mobile)) return { ok: false, error: "reg.err.mobile" };

  if (input.password.length < PASSWORD_MIN || new TextEncoder().encode(input.password).length > PASSWORD_MAX) {
    return { ok: false, error: "reg.err.password" };
  }
  if (input.password !== input.password_confirm) return { ok: false, error: "reg.err.mismatch" };

  const note = (input.note ?? "").trim().slice(0, NOTE_MAX);
  return {
    ok: true,
    value: {
      arabic_name: arabic,
      english_name: english || null,
      email,
      mobile,
      note: note || null,
      password: input.password,
    },
  };
}

/** Checked BEFORE an account is created, so a flood creates nothing. */
export function rateDecision(input: { ipCount24h: number; pendingTotal: number }): "ok" | "closed" {
  if (input.ipCount24h >= PER_IP_24H) return "closed";
  if (input.pendingTotal >= PENDING_CAP) return "closed";
  return "ok";
}
