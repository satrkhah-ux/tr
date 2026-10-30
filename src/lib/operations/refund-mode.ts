/**
 * «مسترجع / غير مسترجع / يُلغى إن لم ندفع» (the owner, 2026-10-30): how a booking
 * can be got out of, and by when. Flights are non-refundable once ticketed;
 * hotels are one of three:
 *
 *  · non_refundable   — paid is spent;
 *  · refundable_until — free cancellation up to a day;
 *  · pay_by           — the hotel HOLDS the room and cancels it if we have not
 *                       paid by a day. Internal: the client is never told.
 *
 * Kept on the booking as cancellation_deadline (the day's end, Riyadh) + the
 * mode in detail[REFUND_MODE_KEY] — no column of its own. Pure.
 */

export type RefundMode = "non_refundable" | "refundable_until" | "pay_by";
export const REFUND_MODES: readonly RefundMode[] = ["non_refundable", "refundable_until", "pay_by"];
/** detail key holding the mode — ours, never printed (shownDetail drops it). */
export const REFUND_MODE_KEY = "refund_mode";
export const FLIGHT_POLICY = "غير قابل للاسترداد بعد الإصدار";

export const isRefundMode = (v: unknown): v is RefundMode => typeof v === "string" && (REFUND_MODES as readonly string[]).includes(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** The draft hotel's choice — pay_by only beside no refundable mark (normaliseHotel keeps them exclusive). */
export function draftRefund(h: { refundable?: boolean | null; refundable_until?: string | null; pay_by?: string | null }): { mode: RefundMode; date: string | null } | null {
  if (h.refundable === false) return { mode: "non_refundable", date: null };
  if (h.refundable === true) return { mode: "refundable_until", date: isDay(h.refundable_until) ? h.refundable_until : null };
  if (isDay(h.pay_by)) return { mode: "pay_by", date: h.pay_by };
  return null;
}

/** The day's last second in Riyadh (UTC+3, no DST), as the timestamptz cancellation_deadline holds it. */
export function endOfRiyadhDay(day: string): string | null {
  if (!isDay(day)) return null;
  return new Date(`${day}T23:59:59+03:00`).toISOString();
}

/** The Riyadh day of a deadline timestamp. */
export function riyadhDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** The policy line ops reads on the booking. */
export function refundPolicyText(mode: RefundMode, date: string | null): string {
  if (mode === "non_refundable") return "غير قابل للاسترداد";
  if (mode === "refundable_until") return date ? `قابل للاسترداد حتى ${date}` : "قابل للاسترداد";
  return date ? `يُلغى إن لم يُدفع قبل ${date}` : "يُلغى إن لم يُدفع";
}

/** Whole days from today to the deadline day (negative = passed). */
export function daysLeft(day: string, today: string): number {
  return Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
}

/** The deadline counts while money can still be lost: a pay_by hold until we pay, a free-cancellation window while unpaid. */
export function deadlineLive(mode: RefundMode | null | undefined, isPaid: boolean | null | undefined): boolean {
  return (mode === "pay_by" || mode === "refundable_until") && !isPaid;
}

/**
 * Which reminder is due today — 3 days, 1 day, the day itself — or null. A step
 * a missed morning skipped is caught by the next (≤), each sent once by its ref.
 */
export function reminderStep(day: string, today: string): 3 | 1 | 0 | null {
  const n = daysLeft(day, today);
  if (n < 0 || n > 3) return null;
  return n === 0 ? 0 : n === 1 ? 1 : 3;
}

/** What the reminder says, in the owner's words. */
export function reminderText(mode: "pay_by" | "refundable_until", title: string, day: string, today: string): string {
  const n = daysLeft(day, today);
  const when = n <= 0 ? `اليوم ${day}` : `${day} (بعد ${n === 1 ? "يوم" : n === 2 ? "يومين" : `${n} أيام`})`;
  return mode === "pay_by" ? `⏳ ادفع قبل ${when} وإلا يُلغى الحجز: ${title}` : `⏳ آخر يوم للإلغاء المجاني ${when}: ${title}`;
}

export type RefundBadge = { text: string; tone: "red" | "amber" | "green" | "grey" };

/** The badge on the booking row. */
export function refundBadge(mode: RefundMode | null | undefined, day: string | null, isPaid: boolean | null | undefined, today: string): RefundBadge | null {
  if (mode === "non_refundable") return { text: "غير مسترجع", tone: "grey" };
  if (!day) return null;
  const near = !isPaid && daysLeft(day, today) <= 3;
  if (mode === "pay_by") return isPaid ? { text: `مدفوع — كان يُلغى بعد ${day}`, tone: "green" } : { text: `يُلغى إن لم يُدفع قبل ${day}`, tone: near ? "red" : "amber" };
  if (mode === "refundable_until") return { text: `استرجاع حتى ${day}`, tone: near ? "amber" : "green" };
  return null;
}

/** The policy line a CLIENT paper may print: a pay_by hold is ours — nothing of it reaches the client. */
export function clientPolicy(policy: string | null, detail: Record<string, string> | null | undefined): string | null {
  return detail?.[REFUND_MODE_KEY] === "pay_by" ? null : policy;
}
