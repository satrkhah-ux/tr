/**
 * The client's messages at each stage (operations order 11, suggestion 5) —
 * pure: a manager's template filled with the case's own words, the days each
 * dated message goes out on, and the WhatsApp template that carries it once the
 * client's 24 hours have passed.
 */

export const CLIENT_MESSAGE_KEYS = [
  "bookings_confirmed",
  "documents_ready",
  "three_days_before",
  "day_before",
  "departure_day",
  "welcome",
  "midway",
  "rate_trip",
] as const;
export type ClientMessageKey = (typeof CLIENT_MESSAGE_KEYS)[number];

export const CLIENT_MESSAGE_LABEL: Record<ClientMessageKey, string> = {
  bookings_confirmed: "تأكيد الحجوزات",
  documents_ready: "جاهزية المستندات",
  three_days_before: "قبل السفر بثلاثة أيام",
  day_before: "قبل السفر بيوم",
  departure_day: "يوم السفر — سفراً ممتعاً",
  welcome: "الترحيب بعد الوصول",
  midway: "الاطمئنان في منتصف الرحلة",
  rate_trip: "طلب التقييم بعد العودة",
};

/** The placeholders a template may use — anything else is left as written. */
export type MessageFields = { name: string; destination: string; serial: string; link: string; rate_link: string };

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
  return tidyWhatsapp(body.replace(/\{(name|destination|serial|link|rate_link)\}/g, (_, key: keyof MessageFields) => fields[key] ?? ""));
}

/** The execution step that sends a message when the case reaches it (the rest are dated, see messagesDueToday). */
export const MESSAGE_ON_STATE: Partial<Record<string, ClientMessageKey>> = {
  transfers_booked: "bookings_confirmed",
  vouchers_issued: "documents_ready",
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The dated messages due on `today` for a trip from `start` to `end` (the
 * morning job runs once a day, so a day is the finest it can aim):
 * three days before, the day before, the travel day itself, the morning AFTER
 * it — by then the group has landed, so «الحمد لله على سلامتك» is true — and
 * the middle of a trip of four nights or more. «rate_trip» goes when the trip is
 * marked travelled (daily.ts), not by date.
 */
export function messagesDueToday(start: string | null, end: string | null, today: string): ClientMessageKey[] {
  if (!start) return [];
  const until = dayDiff(today, start);
  if (until === 3) return ["three_days_before"];
  if (until === 1) return ["day_before"];
  if (until === 0) return ["departure_day"];
  const since = -until;
  if (!end || today > end) return [];
  if (since === 1) return ["welcome"];
  const length = dayDiff(start, end);
  const middle = Math.floor(length / 2);
  return length >= 4 && middle > 1 && since === middle ? ["midway"] : [];
}

// ---------- WhatsApp templates (Meta-approved, for after the 24 hours) ----------

/** What a template is about: a stage message, or the programme sent when a file is issued. */
export type WaTemplateKey = ClientMessageKey | "programme";

export type WaTemplateDef = {
  /** the name it is approved under in Meta's WhatsApp Manager. */
  name: string;
  /** {{1}} the client's name · {{2}} the destination · {{3}} the link. */
  body: string;
  /** the programme carries its PDF as the template's document header. */
  document?: boolean;
};

const SIGN = "فريق ترافليون للسفر والسياحة";

/**
 * The approved texts, one per message. «UTILITY», Arabic. They are submitted to
 * Meta as written here (scripts/submit-wa-templates.mjs) — so this is the one
 * copy of them; Teletel only syncs and sends what Meta approved.
 */
export const WA_TEMPLATES: Record<WaTemplateKey, WaTemplateDef> = {
  programme: {
    name: "traveliun_trip_program",
    document: true,
    body: `مرحباً {{1}} 👋\n\nتم إعداد برنامج رحلتك إلى *{{2}}* ✈️\nتجد البرنامج كاملاً في الملف المرفق، وعلى الرابط:\n{{3}}\n\n${SIGN}`,
  },
  bookings_confirmed: {
    name: "traveliun_bookings_confirmed",
    body: `مرحباً {{1}} 👋\n\n✅ تم تأكيد حجوزات رحلتك إلى *{{2}}*.\nتابع تفاصيل رحلتك من هنا:\n{{3}}\n\n${SIGN}`,
  },
  documents_ready: {
    name: "traveliun_documents_ready",
    body: `مرحباً {{1}} 👋\n\n📄 مستندات رحلتك إلى *{{2}}* جاهزة: قسائم الفنادق والتذاكر والبرنامج.\n{{3}}\n\n${SIGN}`,
  },
  three_days_before: {
    name: "traveliun_trip_in_3_days",
    body: `مرحباً {{1}} 👋\n\n⏳ باقي *3 أيام* على رحلتك إلى *{{2}}*.\nتأكد من جواز السفر والتذاكر — كل مستندات رحلتك هنا:\n{{3}}\n\n${SIGN}`,
  },
  day_before: {
    name: "traveliun_trip_tomorrow",
    body: `مرحباً {{1}} 👋\n\n✈️ رحلتك إلى *{{2}}* غداً.\nبيانات الاستقبال والسائق في الرابط:\n{{3}}\n\nنتمنى لك رحلة سعيدة 🤍\n${SIGN}`,
  },
  departure_day: {
    name: "traveliun_bon_voyage",
    body: `مرحباً {{1}} 👋\n\nاليوم موعد رحلتك إلى *{{2}}* ✈️\nنتمنى لك سفراً ممتعاً وآمناً، ونحن معك خطوة بخطوة:\n{{3}}\n\n${SIGN}`,
  },
  welcome: {
    name: "traveliun_welcome_arrival",
    body: `الحمد لله على سلامتك يا {{1}} 🌴\n\nأهلاً بك في *{{2}}*. نتابع معك رحلتك بكل لحظة، وإن احتجت أي شيء راسلنا هنا.\n{{3}}\n\n${SIGN}`,
  },
  midway: {
    name: "traveliun_trip_checkin",
    body: `مرحباً {{1}} 👋\n\nنطمئن عليك في *{{2}}* 😊 نتمنى أن رحلتك تسير كما تحب.\nإن احتجت أي شيء نحن هنا، وبرنامجك على الرابط:\n{{3}}\n\n${SIGN}`,
  },
  rate_trip: {
    name: "traveliun_rate_trip",
    body: `حمداً لله على سلامة العودة يا {{1}} 🤍\n\nنتمنى أن رحلتك إلى *{{2}}* كانت ممتعة. شاركنا رأيك بنقرة:\n{{3}}\n\n${SIGN}`,
  },
};

/** The template's three values, in order — the link the message is about. */
export function waParams(key: WaTemplateKey, fields: Pick<MessageFields, "name" | "destination" | "link" | "rate_link">): string[] {
  return [fields.name.trim() || "عميلنا العزيز", fields.destination.trim() || "وجهتك", (key === "rate_trip" ? fields.rate_link : fields.link) || "-"];
}

/** The template text as the client will read it — shown on the thread beside the template. */
export function waPreview(def: WaTemplateDef, params: string[]): string {
  return def.body.replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}
