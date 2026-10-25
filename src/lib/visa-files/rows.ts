import { isCalendarDate, passportNumber, travelerInputError } from "@/lib/operations/travelers";
import { isUuid } from "./rules";
import type { VisaDoc, VisaEvent, VisaFile, VisaPayment, VisaService, VisaTraveler } from "./types";

/**
 * visa_files rows ⇄ the contract's VisaFile (pure). The passport number never leaves the row in the clear:
 * the traveller is stored with it ENCRYPTED (the operation_travelers way) beside its last four digits, and a
 * VisaFile carries only «•••• 1234».
 */
export type VisaRowDb = {
  id: string; serial: string; status: VisaFile["status"]; country: string; country_id: string | null; visa_catalog_id: string | null; visa_type: string | null; applicants: number;
  client_name: string; client_phone: string | null; conversation_id: number | null; contact_id: number | null; lead_id: string | null; assigned_to: string | null;
  travelers: unknown; documents: unknown; services: unknown; applied_at: string | null; appointment_at: string | null; expected_reply_at: string | null; replied_at: string | null;
  fee_service: number | string; fee_embassy: number | string; currency: string; paid: number | string; next_action: string | null; next_action_at: string | null; note: string | null;
  created_by: string | null; created_at: string; updated_at: string; rev: number;
};

export type StoredTraveler = Omit<VisaTraveler, "passportNo"> & { passportEnc: string | null; passportLast4: string | null };

export const MASK = "•••• ";
export const maskedPassport = (t: Pick<StoredTraveler, "passportEnc" | "passportLast4">) => (t.passportEnc ? (t.passportLast4 ? `${MASK}${t.passportLast4}` : "••••") : null);
const isMasked = (s: string) => s.startsWith("•");

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export const storedTravelers = (row: Pick<VisaRowDb, "travelers">): StoredTraveler[] => list<StoredTraveler>(row.travelers);

export function rowToFile(r: VisaRowDb): VisaFile {
  return {
    id: r.id, serial: r.serial, status: r.status, country: r.country, countryId: r.country_id, visaCatalogId: r.visa_catalog_id, visaType: r.visa_type, applicants: r.applicants,
    clientName: r.client_name, clientPhone: r.client_phone, conversationId: r.conversation_id, contactId: r.contact_id, leadId: r.lead_id, assignedTo: r.assigned_to,
    travelers: storedTravelers(r).map(({ passportEnc, passportLast4, ...t }) => ({ ...t, passportNo: maskedPassport({ passportEnc, passportLast4 }) })),
    documents: list<VisaDoc>(r.documents), services: list<VisaService>(r.services),
    appliedAt: r.applied_at, appointmentAt: r.appointment_at, expectedReplyAt: r.expected_reply_at, repliedAt: r.replied_at,
    feeService: num(r.fee_service), feeEmbassy: num(r.fee_embassy), currency: r.currency, paid: num(r.paid), nextAction: r.next_action, nextActionAt: r.next_action_at, note: r.note,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** the camelCase fields → the table's columns */
const COLUMN: Record<string, string> = {
  country: "country", countryId: "country_id", visaCatalogId: "visa_catalog_id", visaType: "visa_type", applicants: "applicants", clientName: "client_name", clientPhone: "client_phone",
  assignedTo: "assigned_to", appliedAt: "applied_at", appointmentAt: "appointment_at", expectedReplyAt: "expected_reply_at", repliedAt: "replied_at", feeService: "fee_service",
  feeEmbassy: "fee_embassy", currency: "currency", nextAction: "next_action", nextActionAt: "next_action_at", note: "note",
};
export const toColumns = (set: Record<string, unknown>) => Object.fromEntries(Object.entries(set).map(([k, v]) => [COLUMN[k] ?? k, v]));

export const rowToPayment = (r: { id: string; file_id: string; amount: number | string; method: string | null; note: string | null; paid_at: string; by: string | null }): VisaPayment =>
  ({ id: r.id, fileId: r.file_id, amount: num(r.amount), method: r.method, note: r.note, paidAt: r.paid_at, by: r.by });
export const rowToEvent = (r: { id: string; file_id: string; at: string; by: string | null; kind: VisaEvent["kind"]; text: string }): VisaEvent =>
  ({ id: r.id, fileId: r.file_id, at: r.at, by: r.by, kind: r.kind, text: r.text });

// ---------- travellers ----------

export const blankTraveler = (id: string): StoredTraveler => ({ id, fullName: "", passportEnc: null, passportLast4: null, nationality: null, birthDate: null, passportExpiry: null, result: null, visaNo: null, note: null });

const short = (v: unknown, max: number): string | null | "bad" => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "bad";
  const t = v.trim();
  return t.length > max ? "bad" : t === "" ? null : t;
};
const day = (v: unknown): string | null | "bad" => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "string" ? v.slice(0, 10) : "";
  return isCalendarDate(d) ? d : "bad";
};

/**
 * The travellers a person saved, onto what is stored. A traveller keeps his stored passport unless a new number
 * comes: `passportNo` null/undefined or the masked text getVisaFile returned leaves it; a number sets it
 * (encrypted); "" clears it. `encrypt` throws when the vault is not configured — the number is never stored plain.
 */
export function mergeTravelers(
  incoming: VisaTraveler[],
  stored: StoredTraveler[],
  ctx: { today: string; encrypt: (p: { number: string; full_name: string; nationality: string }) => string; newId?: () => string },
): { ok: true; travelers: StoredTraveler[] } | { ok: false; error: string } {
  if (!Array.isArray(incoming) || incoming.length > 50) return { ok: false, error: "قائمة المسافرين غير صالحة." };
  const byId = new Map(stored.map((t) => [t.id, t]));
  const out: StoredTraveler[] = [];
  for (const [i, t] of incoming.entries()) {
    const label = `المسافر ${i + 1}`;
    const known = isUuid(t?.id) ? byId.get(t.id) : undefined;
    const fullName = short(t?.fullName, 120);
    const nationality = short(t?.nationality, 40);
    const visaNo = short(t?.visaNo, 40);
    const note = short(t?.note, 300);
    const birthDate = day(t?.birthDate);
    const passportExpiry = day(t?.passportExpiry);
    if ([fullName, nationality, visaNo, note].includes("bad")) return { ok: false, error: `بيانات ${label} غير صالحة.` };
    if (birthDate === "bad" || passportExpiry === "bad") return { ok: false, error: `تاريخ ${label} غير صالح.` };
    const result = t?.result ?? null;
    if (result !== null && result !== "approved" && result !== "rejected") return { ok: false, error: `نتيجة ${label} غير صالحة.` };
    const next: StoredTraveler = {
      ...(known ?? blankTraveler(isUuid(t?.id) ? t.id : (ctx.newId ?? (() => globalThis.crypto.randomUUID()))())),
      fullName: (fullName as string | null) ?? "", nationality: nationality as string | null, birthDate, passportExpiry, result, visaNo: visaNo as string | null, note: note as string | null,
    };
    const typed = typeof t?.passportNo === "string" ? t.passportNo.trim() : null;
    if (typed === "") {
      next.passportEnc = null;
      next.passportLast4 = null;
    } else if (typed !== null && !isMasked(typed)) {
      const number = passportNumber(typed);
      const bad = travelerInputError({ birth_date: birthDate, passport_expiry: passportExpiry, number }, ctx.today);
      if (bad === "passportNo" || number.length < 5 || number.length > 15) return { ok: false, error: `رقم جواز ${label} غير صالح.` };
      if (bad) return { ok: false, error: bad === "date" ? `تاريخ ${label} غير صالح.` : `تاريخ ميلاد ${label} غير منطقي.` };
      try {
        next.passportEnc = ctx.encrypt({ number, full_name: next.fullName, nationality: next.nationality ?? "" });
      } catch {
        return { ok: false, error: "تعذّر حفظ رقم الجواز: مفتاح التشفير غير مضبوط." };
      }
      next.passportLast4 = number.slice(-4);
    } else {
      const bad = travelerInputError({ birth_date: birthDate, passport_expiry: passportExpiry }, ctx.today);
      if (bad) return { ok: false, error: bad === "date" ? `تاريخ ${label} غير صالح.` : `تاريخ ميلاد ${label} غير منطقي.` };
    }
    out.push(next);
  }
  return { ok: true, travelers: out };
}

/** the columns the board reads (documents for the missing count; no travellers, no passport data) */
export const BOARD_COLS = "id, serial, status, country, visa_type, applicants, client_name, client_phone, assigned_to, applied_at, expected_reply_at, replied_at, fee_service, fee_embassy, currency, paid, next_action, next_action_at, created_at, updated_at, documents";
export type BoardDb = Pick<VisaRowDb, "id" | "serial" | "status" | "country" | "visa_type" | "applicants" | "client_name" | "client_phone" | "assigned_to" | "applied_at" | "expected_reply_at" | "replied_at" | "fee_service" | "fee_embassy" | "currency" | "paid" | "next_action" | "next_action_at" | "created_at" | "updated_at" | "documents">;
export const boardRowToFile = (r: BoardDb) => ({
  id: r.id, serial: r.serial, status: r.status, country: r.country, visaType: r.visa_type, applicants: r.applicants, clientName: r.client_name, clientPhone: r.client_phone, assignedTo: r.assigned_to,
  appliedAt: r.applied_at, expectedReplyAt: r.expected_reply_at, repliedAt: r.replied_at, feeService: num(r.fee_service), feeEmbassy: num(r.fee_embassy), currency: r.currency, paid: num(r.paid),
  nextAction: r.next_action, nextActionAt: r.next_action_at, createdAt: r.created_at, updatedAt: r.updated_at, documents: list<VisaDoc>(r.documents),
});
