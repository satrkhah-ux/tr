export const OUTCOMES = {
  no_answer: "لم يرد", interested: "مهتم", revise_offer: "يريد تعديل",
  later: "التواصل لاحقًا", not_interested: "غير مهتم", not_completed: "لم يكمل", completed: "حجز مؤكد", transferred: "تحويل لقسم آخر",
} as const;
export const STAGES = { new: "جديد", working: "قيد المتابعة", waiting: "بانتظار العميل", scheduled: "مجدول", transferred: "تم التحويل", completed: "مكتمل" } as const;
/** «لم يكمل» — why the client did not go on (the owner, 2026-10-23). */
export const CLOSE_REASONS = ["السعر", "غيّر الوجهة", "حجز من مكان آخر", "أجّل السفر", "لا رد", "أخرى"] as const;

/**
 * The offer's cadence (the owner, 2026-10-23): two hours after it, then days
 * 1, 3 and 7 — the seventh is the last reminder, then the file is closed.
 * `step` is the NEXT one to do; 4 is «أغلق». Hours after the offer; a step
 * never falls closer than two hours (the first) or twenty (the others) after
 * the last interaction, so two reminders never land back to back.
 * Mirrored by followup_step_due() in SQL (20261023080000_followup_offers.sql).
 */
export const STEP_LABELS = ["بعد ساعتين", "اليوم 1", "اليوم 3", "اليوم 7", "إغلاق"] as const;
export const STEP_SHORT = ["2س", "1", "3", "7", "✓"] as const;
const STEP_AT_H = [2, 24, 72, 168, 192];
const HOUR = 3600_000;
export function stepDue(step: number, offerAt: number, lastAt: number): number {
  const s = Math.max(0, Math.min(4, step));
  return Math.max(offerAt + STEP_AT_H[s] * HOUR, lastAt + (s === 0 ? 2 : 20) * HOUR);
}
/** Enrolled late (a backlog, a slow sync): the latest step whose time has come — one catch-up, never all of them. */
export function stepFor(offerAt: number, now: number): number {
  let step = 0;
  for (let s = 1; s < 4; s++) if (now >= offerAt + STEP_AT_H[s] * HOUR) step = s;
  return step;
}
/** Silent this long after our offer: a follow-up file. Older than the cadence: not one. */
export const QUIET_MS = 2 * HOUR;
export const CADENCE_MS = 7 * 24 * HOUR;

/** A thread message as offer detection reads it. Times in unix seconds; `serial` a Basic file number in its text or file name. */
export type OfferMsg = { at: number; text: string; fromClient: boolean; isPrivate: boolean; senderId: number | null; pdf: boolean; serial?: string | null };
const DIGITS: Record<string, string> = Object.fromEntries([..."٠١٢٣٤٥٦٧٨٩"].map((d, i) => [d, String(i)]));
const western = (s: string) => s.replace(/[٠-٩]/g, (d) => DIGITS[d]);
const LINK = /pkg\.traveliun\.com/i;
export const SERIAL = /\b[A-Z]{2}-\d{1,2}-\d{3,5}-\d{8}\b/;
// an amount in a currency, either order: «4,500 ريال», «SAR 4500», «٤٥٠٠ ر.س»
const AMOUNT = /\d[\d,.،]{2,}\s*(?:ريال|ر\.?\s?س|SAR|﷼|دولار|USD|\$|درهم|AED|يورو|EUR)|(?:SAR|USD|EUR|\$|﷼)\s?\d{3,}/i;
// a total named: «الإجمالي: 4500», «السعر 3,200 للشخص»
const TOTAL = /(?:الإجمالي|الاجمالي|إجمالي|اجمالي|السعر|سعر|التكلفة|المبلغ|بقيمة|قيمة)[^\d\n]{0,25}\d[\d,.،]{2,}/;
// the price spoken of without a figure: «الأسعار شامل الاستقبال», «السعر موضح بالملف», «هذا أقل سعر»
const PRICE_TALK = /(?:السعر|الأسعار|الاسعار)\s+(?:شامل|يشمل|موضح|بالملف)|(?:أقل|اقل)\s+سعر|عرض\s+سعر/;
// past the offer — an invoice, a receipt, the bookings, the rating request (live threads, 2026-10-23); a
// short line only: an offer's own terms say «جميع الحجوزات والخدمات تخضع…»
const CLOSING_WORDS = /فاتور|إيصال|ايصال|سند قبض|حجوزات|تم الحجز|تم تأكيد|تم التأكيد|التقييم|تقييمك/;
const closing = (text: string) => text.length < 400 && CLOSING_WORDS.test(text);
/**
 * Our message carries an offer or a price: the programme's link or file
 * number, a PDF, an amount in a currency, or a named total. A bare «عرض» or
 * «بكج» is not one — they are asked about far more often than priced
 * (the evaluator's sample regex, 2026-10-23, narrowed).
 */
export function isOfferMessage(m: OfferMsg): boolean {
  if (m.fromClient || m.isPrivate || closing(m.text)) return false;
  const text = western(m.text);
  return m.pdf || Boolean(m.serial) || LINK.test(text) || SERIAL.test(text) || AMOUNT.test(text) || TOTAL.test(text) || PRICE_TALK.test(text);
}
/**
 * The offer the client went quiet after: the thread's last public message is
 * ours and, among our messages since the client last wrote, one is an offer
 * (the latest such). Null when the client spoke last or we sent no price.
 * `lastAt` is our last public message — the silence is counted from it.
 */
export function lastOffer(messages: readonly OfferMsg[]): { at: number; lastAt: number; text: string; senderId: number | null; serial: string | null } | null {
  const visible = messages.filter((m) => !m.isPrivate).sort((a, b) => a.at - b.at);
  const last = visible.at(-1);
  if (!last || last.fromClient) return null;
  let start = visible.length;
  while (start > 0 && !visible[start - 1].fromClient) start--;
  const run = visible.slice(start);
  // an invoice or the bookings after the price: the client went on, nothing to follow
  if (run.some((m) => closing(m.text))) return null;
  const offer = run.findLast(isOfferMessage);
  if (!offer) return null;
  return { at: offer.at, lastAt: last.at, text: offer.text, senderId: offer.senderId, serial: run.findLast((m) => m.serial)?.serial ?? null };
}
/** A Teletel (Chatwoot) message as detection reads it; activity lines dropped. */
export type RawThreadMsg = {
  id?: number; created_at?: number; content?: string | null; message_type?: number; private?: boolean;
  sender?: { id?: number } | null; attachments?: { file_type?: string; data_url?: string; extension?: string | null }[];
};
const fileName = (url: string | undefined) => {
  const last = (url ?? "").split("?")[0].split("/").pop() ?? "";
  try { return decodeURIComponent(last); } catch { return last; }
};
export function toOfferMsg(m: RawThreadMsg): OfferMsg | null {
  if (typeof m.id !== "number" || m.message_type === 2) return null;
  const text = m.content?.trim() ?? "";
  const files = m.attachments ?? [];
  const names = files.map((f) => fileName(f.data_url));
  return {
    at: m.created_at ?? 0,
    text,
    fromClient: m.message_type === 0,
    isPrivate: m.private === true,
    senderId: m.message_type === 0 ? null : (m.sender?.id ?? null),
    // a programme as a document: Basic's PDF (named by its file number), or a Word file
    pdf: files.some((f, i) => /^(pdf|docx?)$/i.test(f.extension ?? "") || /\.(pdf|docx?)$/i.test(names[i])),
    serial: [text, ...names].join(" ").match(SERIAL)?.[0] ?? null,
  };
}
/** The client's latest line, for the card. */
export function clientLine(messages: readonly OfferMsg[]): string | null {
  const m = messages.filter((x) => x.fromClient && x.text.trim()).sort((a, b) => a.at - b.at).at(-1);
  return m ? m.text.trim().slice(0, 200) : null;
}

export type WorkRow = {
  id: string; conversation_id: number; contact_name: string | null; contact_phone: string | null;
  status: "open" | "done"; stage: keyof typeof STAGES; assigned_to: string | null; assigned_at: string | null;
  request_started_at: string; created_at: string; next_followup_at: string | null; first_followed_at: string | null;
  last_attempt_at: string | null; last_client_at: string | null; last_synced_at: string | null;
  source: string; source_team_id: number | null; transfer_reason: string | null; outcome: string | null;
  external_status: string | null; attempt_count: number; send_lock: string | null; done_at: string | null;
  offer_id: string | null; offer_at: string | null; offer_line: string | null; destination: string | null;
  step: number | null; client_line: string | null; client_waiting: boolean; close_reason: string | null;
};
export type Attempt = { id: string; employee_id: string | null; kind: string; outcome: string | null; note: string | null; due_at: string | null; provider_message_id: number | null; delivery_state: string; created_at: string };
/** `claim`: on the follow-up team (followups.work) — a seller without it sees his own files only. */
export type FollowupAccess = { employeeId: string; manager: boolean; claim: boolean };
export type WorkResult = { ok: true; duplicate?: boolean; state?: string; id?: string } | { ok: false; error: string };
export function mayRead(row: Pick<WorkRow, "assigned_to" | "status">, access: FollowupAccess): boolean {
  return access.manager || row.assigned_to === access.employeeId || (access.claim && row.status === "open" && !row.assigned_to);
}
export function mayAct(row: Pick<WorkRow, "assigned_to">, access: FollowupAccess): boolean {
  return access.manager || row.assigned_to === access.employeeId;
}
/** An offer's file (cadence) — the rest came before 2026-10-23 (team transfers, the old intake list). */
export const isOfferRow = (r: Pick<WorkRow, "step">) => r.step !== null;
/** The old «طلب غير واضح» list (an offer turns one into its own file): under «الكل» only until the owner decides its archive. */
export const isOldIntake = (r: Pick<WorkRow, "source">) => r.source === "sla";

export type TodayGroup = "replied" | "due" | "late";
/**
 * «اليوم»'s three groups: the client wrote back (the cadence stopped), due
 * today, due before today. An unclaimed team transfer is due until someone
 * takes it. Riyadh's day.
 */
export function todayGroup(r: WorkRow, now: number): TodayGroup | null {
  if (r.status !== "open" || isOldIntake(r)) return null;
  if (r.client_waiting && isOfferRow(r)) return "replied";
  if (!r.next_followup_at) return r.stage === "new" ? "due" : null;
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(t);
  const due = Date.parse(r.next_followup_at);
  if (day(due) < day(now)) return "late";
  return day(due) === day(now) ? "due" : null;
}

export function validateResult(outcome: string, dueAt: string | null, note: string, reason: string | null = null, now = Date.now()): string | null {
  if (!Object.hasOwn(OUTCOMES, outcome) || outcome === "transferred") return "invalid";
  if (dueAt && (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= now)) return "due";
  if (["not_interested", "not_completed"].includes(outcome) && !(reason && (CLOSE_REASONS as readonly string[]).includes(reason)) && !note.trim()) return "reason";
  return null;
}
export const WORK_COLS = "id,conversation_id,contact_name,contact_phone,status,stage,assigned_to,assigned_at,request_started_at,created_at,next_followup_at,first_followed_at,last_attempt_at,last_client_at,last_synced_at,source,source_team_id,transfer_reason,outcome,external_status,attempt_count,send_lock,done_at,offer_id,offer_at,offer_line,destination,step,client_line,client_waiting,close_reason";
