import { muradJson, muradProvider } from "@/lib/murad/model";

/**
 * What a supplier's email says — pure reading, no database.
 *
 * The rules are the floor: they run on every message and their output is what
 * gets stored. The model (muradProvider, when a key exists) may only improve
 * the KIND — it is never allowed to invent a reference the rules did not find,
 * because an invented number would link the email to the wrong client's file.
 */

export type MailKind = "confirmation" | "hotel_change" | "no_availability" | "cancellation" | "other";

export type MailRefs = {
  /** booking / confirmation numbers, spaces dropped, upper-cased */
  numbers: string[];
  /** our own offer serials (XX-9-999-20260101 shape) */
  serials: string[];
  hotels: string[];
  guests: string[];
  /** ISO yyyy-mm-dd, dd/mm/yyyy normalised to ISO */
  dates: string[];
};

/** our serial: two letters, branch, sequence, date — as the generator issues it */
const SERIAL = /\b[A-Z]{2}-\d{1,2}-\d{3,5}-\d{8}\b/g;
/** a labelled reference: «Confirmation No: ABC123» / «رقم الحجز: 456» */
// same line only ([ \t], never \s): a bare «booking» at a line's end must not eat the next line's label
const LABELLED = /(?:(?:confirmation|booking)[ \t]*(?:no|number|ref(?:erence)?|id|#)[ \t.:#]*|(?:confirmation|booking|reference|رقم[ \t]*الحجز|رقم[ \t]*التأكيد)[ \t]*[:#][ \t]*)([A-Z0-9][A-Z0-9-]{3,})/gi;
/** a bare TBO-style numeric id (their BookingId / ConfirmationNumber run 6+ digits) */
const BARE_NUMBER = /\b\d{6,12}\b/g;
const HOTEL = /(?:hotel\s*(?:name)?|الفندق)\s*[:：]\s*([^\n\r,.;]{3,80})/gi;
const GUEST = /(?:lead\s+guest|guest\s*(?:name)?|اسم\s*النزيل)\s*[:：]\s*([^\n\r,.;]{3,80})/gi;
const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const DMY_DATE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;

const uniq = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const all = (text: string, re: RegExp, group = 0): string[] => [...text.matchAll(re)].map((m) => (m[group] ?? "").trim());

export function extractRefs(subject: string, body: string): MailRefs {
  const text = `${subject}\n${body}`;
  const serials = uniq(all(text, SERIAL));
  const dates = uniq([
    ...all(text, ISO_DATE),
    // dd/mm/yyyy — the suppliers' sheets write day first
    ...[...text.matchAll(DMY_DATE)].map((m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`),
  ]);
  // a reference holds at least one digit — «Booking Voucher» must not read as one
  const labelled = all(text, LABELLED, 1)
    .map((v) => v.replace(/\s+/g, "").toUpperCase())
    .filter((v) => /\d/.test(v));
  // bare long numbers only when no labelled one exists — a body full of phone
  // numbers and totals must not become ten false references
  const numbers = uniq(labelled.length ? labelled : all(text, BARE_NUMBER).map((v) => v.toUpperCase()));
  return {
    numbers: numbers.filter((n) => !serials.includes(n)),
    serials,
    hotels: uniq(all(text, HOTEL, 1)),
    guests: uniq(all(text, GUEST, 1)),
    dates,
  };
}

export function classifyByRules(subject: string, body: string): MailKind {
  const text = `${subject}\n${body}`.toLowerCase();
  // cancellation first: «we regret to cancel» also says regret
  if (/cancel|إلغاء|الغاء|ملغى/.test(text)) return "cancellation";
  if (/no availability|not available|sold out|نعتذر|عدم التوفر|غير متوفر/.test(text)) return "no_availability";
  if (/hotel changed|alternative hotel|تغيير الفندق|فندق بديل/.test(text)) return "hotel_change";
  if (/confirmed|confirmation|تأكيد الحجز|تم التأكيد/.test(text)) return "confirmation";
  return "other";
}

const KIND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: { kind: { type: "string", enum: ["confirmation", "hotel_change", "no_availability", "cancellation", "other"] } },
} as const;

/**
 * kind + refs. The refs are ALWAYS the rules' own finds; the model only refines
 * the kind, and any failure (no key, timeout, bad JSON) falls back to the rules.
 */
export async function classify(subject: string, body: string): Promise<{ kind: MailKind; refs: MailRefs }> {
  const refs = extractRefs(subject, body);
  let kind = classifyByRules(subject, body);
  if (muradProvider()) {
    try {
      const raw = await muradJson(
        "reservation_mail_kind",
        "صنّف بريد مورّد فنادق وصل على صندوق الحجوزات. أعد JSON فقط.",
        `kind واحد من: confirmation (تأكيد حجز)، hotel_change (تغيير/فندق بديل)، no_availability (عدم توفر/اعتذار)، cancellation (إلغاء)، other.\n\nSubject: ${subject.slice(0, 300)}\n\n${body.slice(0, 2000)}`,
        KIND_SCHEMA as unknown as Record<string, unknown>,
      );
      const parsed = JSON.parse(raw ?? "") as { kind?: string };
      if (parsed.kind && ["confirmation", "hotel_change", "no_availability", "cancellation", "other"].includes(parsed.kind)) {
        kind = parsed.kind as MailKind;
      }
    } catch {
      /* the rules' answer stands */
    }
  }
  return { kind, refs };
}
