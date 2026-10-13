/**
 * The client's messages at each stage (operations order 11, suggestion 5) —
 * pure: a manager's template filled with the case's own words.
 */

export const CLIENT_MESSAGE_KEYS = ["bookings_confirmed", "documents_ready", "day_before", "welcome", "rate_trip"] as const;
export type ClientMessageKey = (typeof CLIENT_MESSAGE_KEYS)[number];

export const CLIENT_MESSAGE_LABEL: Record<ClientMessageKey, string> = {
  bookings_confirmed: "تأكيد الحجوزات",
  documents_ready: "جاهزية المستندات",
  day_before: "قبل السفر بيوم",
  welcome: "الترحيب عند الوصول",
  rate_trip: "طلب التقييم بعد العودة",
};

/** The placeholders a template may use — anything else is left as written. */
export type MessageFields = { name: string; destination: string; serial: string; link: string; rate_link: string };

export function fillTemplate(body: string, fields: MessageFields): string {
  return body
    .replace(/\{(name|destination|serial|link|rate_link)\}/g, (_, key: keyof MessageFields) => fields[key] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** The execution step that sends a message when the case reaches it (the rest are dated, see daily.ts). */
export const MESSAGE_ON_STATE: Partial<Record<string, ClientMessageKey>> = {
  transfers_booked: "bookings_confirmed",
  vouchers_issued: "documents_ready",
};
