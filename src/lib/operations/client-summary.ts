/**
 * «أرسل للعميل» (operations order 6) — the message a client gets from inside
 * the operations file: their hotels and the confirmation numbers, the flights,
 * the drives and tours on their days, the link to the trip page, and what is
 * left to pay. Pure; the agent reads and edits it before it leaves.
 */

import { LATER } from "./seed-plan";
import { clientFlight, hotelFinal, type ClientBookingRow } from "./client-booking-state";

export type SummaryBooking = ClientBookingRow;

export type ClientSummary = {
  /** «عميلنا فلان،» — client-whatsapp.ts greeting(). */
  hello: string;
  destination: string | null;
  serial: string;
  bookings: SummaryBooking[];
  /** the /trip page, or null when its link was stopped. */
  link: string | null;
  /** total − paid; null when the file has no total. */
  remaining: number | null;
  currency: string;
};

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * What the trip link shows (client-booking-state.ts): our booking number from
 * the start — a hotel's is never called provisional; the hotel's own number
 * once it is in; a flight's PNR once ticketed, «سيتم تأكيد الحجز» before.
 */
function state(b: SummaryBooking): string {
  const ours = b.company_ref ? `رقم الحجز: ${b.company_ref}` : null;
  if (b.kind === "hotel") return hotelFinal(b) ? `رقم التأكيد: ${b.confirmation_number?.trim()}` : (ours ?? "قيد التأكيد");
  if (b.kind === "flight") {
    const f = clientFlight(b);
    return f.ticketed && f.pnr ? `رقم الحجز (PNR): ${f.pnr}` : [ours, "سيتم تأكيد الحجز"].filter(Boolean).join(" — ");
  }
  return b.status === "confirmed" && b.confirmation_number ? `رقم التأكيد: ${b.confirmation_number}` : (ours ?? "قيد التأكيد");
}

function hotelLine(b: SummaryBooking): string {
  const dates = b.start_date ? ` — من ${b.start_date}${b.end_date ? ` إلى ${b.end_date}` : ""}` : "";
  const room = b.detail?.["الغرفة"] ? `\n  الغرفة: ${b.detail["الغرفة"]}` : "";
  return `• ${b.title}${b.city_name ? ` (${b.city_name})` : ""}${dates}${room}\n  ${state(b)}`;
}

function datedLine(b: SummaryBooking): string {
  const at = b.detail?.["الوقت"] || b.detail?.["وقت الانطلاق"] || "";
  const when = [b.start_date, at && at !== LATER ? at : ""].filter(Boolean).join(" ");
  return `• ${when ? `${when} — ` : ""}${b.title} · ${state(b)}`;
}

export function clientSummaryMessage(s: ClientSummary): string {
  const live = s.bookings
    .filter((b) => b.status !== "cancelled")
    .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"));
  const section = (title: string, rows: SummaryBooking[], line: (b: SummaryBooking) => string) =>
    rows.length > 0 ? [title, ...rows.map(line), ""] : [];
  const where = s.destination?.trim() ? ` إلى ${s.destination.trim()}` : "";
  const owed =
    s.remaining == null ? [] : s.remaining > 0 ? [`المتبقي من المبلغ: ${money(s.remaining)} ${s.currency}`] : ["تم سداد كامل المبلغ، شكراً لك."];
  return [
    s.hello,
    `هذه حجوزات رحلتك${where} (${s.serial}):`,
    "",
    ...section("الفنادق:", live.filter((b) => b.kind === "hotel"), hotelLine),
    ...section("الطيران:", live.filter((b) => b.kind === "flight"), datedLine),
    ...section("التنقلات والجولات:", live.filter((b) => b.kind === "transport" || b.kind === "service"), datedLine),
    ...section("التأشيرات:", live.filter((b) => b.kind === "visa"), datedLine),
    ...(s.link ? [`ملف رحلتك ومستنداتك:\n${s.link}`] : []),
    ...owed,
    "",
    "فريق ترافليون للسفر والسياحة",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
