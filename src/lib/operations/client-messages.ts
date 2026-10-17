/**
 * The client's messages at each stage (operations order 11, suggestion 5) —
 * pure: a manager's template filled with the case's own words, the days each
 * dated message goes out on, and the WhatsApp template that carries it once the
 * client's 24 hours have passed.
 */

export const CLIENT_MESSAGE_KEYS = [
  "bookings_confirmed",
  "documents_ready",
  "trip_reminder",
  "welcome",
  "three_days_before",
  "day_before",
  "departure_day",
  "midway",
  "rate_trip",
] as const;
export type ClientMessageKey = (typeof CLIENT_MESSAGE_KEYS)[number];

export const CLIENT_MESSAGE_LABEL: Record<ClientMessageKey, string> = {
  bookings_confirmed: "تأكيد الحجوزات",
  documents_ready: "جاهزية المستندات",
  trip_reminder: "قبل السفر بيومين — التذكير الشامل",
  three_days_before: "قبل السفر بثلاثة أيام",
  day_before: "قبل السفر بيوم",
  departure_day: "يوم السفر — سفراً ممتعاً",
  welcome: "صباح اليوم التالي للسفر — الحمد لله على السلامة",
  midway: "الاطمئنان في منتصف الرحلة",
  rate_trip: "طلب التقييم بعد العودة",
};

/** The placeholders a template may use — anything else is left as written. */
export type MessageFields = {
  name: string;
  destination: string;
  serial: string;
  link: string;
  rate_link: string;
  /** the travel day in words, «الخميس، 20 نوفمبر» — arabicDay(). */
  date?: string;
};

/** «الخميس، 20 نوفمبر» — the day a client reads, not an ISO date. */
export function arabicDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * A message laid out the way WhatsApp reads well: each link alone on its own
 * line with a blank line before it (a link in the middle of a sentence wraps
 * mid-address on a phone and looks broken), no run of blank lines, no stray
 * spaces. Bold/emoji the author wrote are kept as they are.
 */
export function tidyWhatsapp(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // a full stop or comma right after a link is the sentence's, not the address's
    .replace(/[ \t]*(https?:\/\/[^\s،]+?)[.,،]*(?=\s|$)/g, "\n\n$1\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fillTemplate(body: string, fields: MessageFields): string {
  return tidyWhatsapp(body.replace(/\{(name|destination|serial|link|rate_link|date)\}/g, (_, key: keyof MessageFields) => fields[key] ?? ""));
}

/** The execution step that sends a message when the case reaches it (the rest are dated, see messagesDueToday). */
export const MESSAGE_ON_STATE: Partial<Record<string, ClientMessageKey>> = {
  transfers_booked: "bookings_confirmed",
  vouchers_issued: "documents_ready",
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The dated messages due on `today` for a trip from `start` to `end` (the
 * morning job runs once a day, so a day is the finest it can aim). Only the
 * ones a manager switched on go out (client_message_templates.enabled), each
 * once per trip (sendClientMessage keeps count).
 *
 * The administration's set (2026-10-17): ONE reminder two days before —
 * passport and tickets, the documents and the driver, «سفراً ممتعاً», and the
 * rating after the return, together — and the welcome the morning AFTER the
 * travel day, when the group has landed and «الحمد لله على سلامتك» is true.
 * The reminder also goes to a file made later than that, up to the travel day.
 *
 * The finer ones (three days, the day before, the travel day, mid-trip) stay
 * here for a manager who switches them back on.
 */
export function messagesDueToday(start: string | null, end: string | null, today: string): ClientMessageKey[] {
  if (!start) return [];
  const until = dayDiff(today, start);
  const due: ClientMessageKey[] = [];
  if (until >= 0 && until <= 2) due.push("trip_reminder");
  if (until === 3) due.push("three_days_before");
  if (until === 1) due.push("day_before");
  if (until === 0) due.push("departure_day");
  const since = -until;
  if (since >= 1 && end && today <= end) {
    if (since === 1) due.push("welcome");
    const length = dayDiff(start, end);
    const middle = Math.floor(length / 2);
    if (length >= 4 && middle > 1 && since === middle) due.push("midway");
  }
  return due;
}

// ---------- WhatsApp templates (Meta-approved, for after the 24 hours) ----------

/** What a template is about: a stage message, or the programme sent when a file is issued. */
export type WaTemplateKey = ClientMessageKey | "programme";

type WaField = "name" | "destination" | "serial" | "link" | "date";

export type WaTemplateDef = {
  /** the name it is approved under in Meta's WhatsApp Manager. */
  name: string;
  /** what {{1}}, {{2}}, … stand for, in order. */
  params: WaField[];
  body: string;
  /** the programme carries its PDF as the template's document header. */
  document?: boolean;
};

const SIGN = "فريق ترافليون للسفر والسياحة";
const HELLO = "عميلنا {{1}}،";

/**
 * The approved texts, one per message, laid out the way the owner asked
 * (2026-10-17): the greeting, then every sentence and the link on its own line
 * with a blank line between, the signature last. «UTILITY», Arabic. Submitted
 * to Meta as written here (scripts/submit-wa-templates.mjs) — this is the one
 * copy; Teletel only syncs and sends what Meta approved. A body never starts or
 * ends with a variable: Meta refuses those.
 */
export const WA_TEMPLATES: Record<WaTemplateKey, WaTemplateDef> = {
  programme: {
    name: "traveliun_trip_program",
    document: true,
    params: ["name", "destination", "serial", "link"],
    body: [HELLO, "تم إعداد برنامج رحلتك إلى {{2}}", "(رقم الملف {{3}})", "البرنامج كاملاً في الملف المرفق، وتفاصيله من هنا:", "{{4}}", SIGN].join("\n\n"),
  },
  bookings_confirmed: {
    name: "traveliun_bookings_confirmed",
    params: ["name", "destination", "serial", "link"],
    body: [HELLO, "تم تأكيد حجوزات رحلتك إلى {{2}}", "(رقم الملف {{3}})", "تابع تفاصيل رحلتك من هنا:", "{{4}}", SIGN].join("\n\n"),
  },
  documents_ready: {
    name: "traveliun_documents_ready",
    params: ["name", "destination", "serial", "link"],
    body: [HELLO, "مستندات رحلتك إلى {{2}} جاهزة: قسائم الفنادق والتذاكر والبرنامج", "(رقم الملف {{3}})", "تجدها كلها من هنا:", "{{4}}", SIGN].join("\n\n"),
  },
  trip_reminder: {
    name: "traveliun_trip_reminder",
    params: ["name", "destination", "date", "serial", "link"],
    body: [
      HELLO,
      "نذكّرك بموعد رحلتك إلى {{2}} يوم {{3}}",
      "(رقم الملف {{4}})",
      "تأكد من جواز السفر والتذاكر، وتجد مستندات رحلتك وبيانات الاستقبال والسائق من هنا:",
      "{{5}}",
      "نتمنى لك سفراً ممتعاً وآمناً، وبعد عودتك يسعدنا تقييمك لرحلتك من الرابط نفسه",
      SIGN,
    ].join("\n\n"),
  },
  three_days_before: {
    name: "traveliun_trip_in_3_days",
    params: ["name", "destination", "link"],
    body: [HELLO, "باقي 3 أيام على رحلتك إلى {{2}}", "تأكد من جواز السفر والتذاكر، وكل مستندات رحلتك من هنا:", "{{3}}", SIGN].join("\n\n"),
  },
  day_before: {
    name: "traveliun_trip_tomorrow",
    params: ["name", "destination", "link"],
    body: [HELLO, "رحلتك إلى {{2}} غداً", "بيانات الاستقبال والسائق من هنا:", "{{3}}", "نتمنى لك رحلة سعيدة", SIGN].join("\n\n"),
  },
  departure_day: {
    name: "traveliun_bon_voyage",
    params: ["name", "destination", "link"],
    body: [HELLO, "اليوم موعد رحلتك إلى {{2}}", "نتمنى لك سفراً ممتعاً وآمناً، ونحن معك خطوة بخطوة:", "{{3}}", SIGN].join("\n\n"),
  },
  welcome: {
    name: "traveliun_welcome_arrival",
    params: ["name", "destination", "link"],
    body: [HELLO, "الحمد لله على سلامتك، وأهلاً بك في {{2}}", "نتابع معك رحلتك بكل لحظة، وإن احتجت أي شيء راسلنا هنا:", "{{3}}", SIGN].join("\n\n"),
  },
  midway: {
    name: "traveliun_trip_checkin",
    params: ["name", "destination", "link"],
    body: [HELLO, "نطمئن عليك في {{2}}، ونتمنى أن رحلتك تسير كما تحب", "إن احتجت أي شيء نحن هنا، وبرنامجك من هنا:", "{{3}}", SIGN].join("\n\n"),
  },
  rate_trip: {
    name: "traveliun_rate_trip",
    params: ["name", "destination", "link"],
    body: [HELLO, "حمداً لله على سلامة العودة، ونتمنى أن رحلتك إلى {{2}} كانت ممتعة", "شاركنا رأيك بنقرة من هنا:", "{{3}}", SIGN].join("\n\n"),
  },
};

/** The template's values in its own order — the rating message points at the rating link. */
export function waParams(key: WaTemplateKey, fields: Pick<MessageFields, "name" | "destination" | "serial" | "link" | "rate_link" | "date">): string[] {
  const value: Record<WaField, string> = {
    date: fields.date?.trim() || "-",
    name: fields.name.trim() || "العزيز",
    destination: fields.destination.trim() || "وجهتك",
    serial: fields.serial.trim() || "-",
    link: (key === "rate_trip" ? fields.rate_link : fields.link) || "-",
  };
  return WA_TEMPLATES[key].params.map((f) => value[f]);
}

/** The template text as the client will read it — shown on the thread beside the template. */
export function waPreview(def: WaTemplateDef, params: string[]): string {
  return def.body.replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

/**
 * The same words as the stage's editable text (/settings/client-comms), in the
 * placeholders a manager writes — so the message reads the same inside the 24
 * hours and after them.
 */
export function defaultMessageBody(key: ClientMessageKey): string {
  const def = WA_TEMPLATES[key];
  return def.body.replace(/\{\{(\d)\}\}/g, (_, n: string) => {
    const field = def.params[Number(n) - 1];
    return field === "link" && key === "rate_trip" ? "{rate_link}" : `{${field}}`;
  });
}
