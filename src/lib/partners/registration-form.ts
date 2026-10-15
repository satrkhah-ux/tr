/**
 * The public registration form, read and checked — pure, so it is tested
 * without a server. registration.ts writes what this returns.
 */

/** The cooperation terms a company accepts when it applies. Bump the version when the text changes. */
export const PARTNER_TERMS_VERSION = "2026-10-13";
export const PARTNER_TERMS: string[] = [
  "تعرض ترافليون للشركة أسعارها بعد نسبة الشركة المتفق عليها عند الاعتماد، وللشركة أن تحدد سعر البيع لعميلها.",
  "يُعدّ الحجز مؤكداً بعد تسجيل الشركة تأكيد عميلها من البوابة وسداد ما يُطلب وفق الشروط المعتمدة لها.",
  "الأسعار قابلة للتغيير حتى تأكيد الحجز وبحسب توفر الفنادق والطيران وقت التثبيت.",
  "الشركة مسؤولة عن صحة بيانات عملائها ووثائق سفرهم، وعن إبلاغهم بالشروط والمستندات الصادرة لهم.",
  "تبقى بيانات عملاء الشركة لها، ولا تطّلع الشركة على بيانات عملاء ترافليون أو مورّديها أو تكاليفها.",
  "لترافليون إيقاف حساب الشركة عند مخالفة هذه الشروط، مع بقاء ما سبق من حجوزات قائماً.",
];

export const DOCUMENT_KINDS = ["commercial_register", "tourism_license", "vat"] as const;
export type PartnerDocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_LABEL: Record<PartnerDocumentKind, string> = {
  commercial_register: "السجل التجاري",
  tourism_license: "رخصة السياحة",
  vat: "شهادة الضريبة",
};

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/**
 * Wildcards and the escape to PostgREST's ilike (`*` reads as `%` there, and
 * escaping does not survive). Refused outright, so the name-clash lookup can
 * only ever match this exact name — «تر%» used to probe every company starting
 * with «تر» and say whether it was approved.
 */
const NAME_WILDCARDS = /[%_*\\]/;

/** Valid submissions one network origin may make per window (in memory, registration.ts). */
export const PER_ORIGIN_LIMIT = 3;
export const PER_ORIGIN_WINDOW_MS = 60 * 60 * 1000;
/** A second request from the same email inside this window is refused (read from booking_partners). */
export const SAME_EMAIL_WINDOW_MS = 10 * 60 * 1000;

export type RegistrationInput = {
  name: string;
  name_latin: string | null;
  email: string;
  phone: string;
  website: string | null;
  address: string | null;
  contact_name: string | null;
  note: string | null;
  commercial_register: string;
  tourism_license: string | null;
  vat_number: string | null;
  city: string;
  country: string;
  documents: { kind: PartnerDocumentKind; file: File; ext: string }[];
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;

export function readRegistration(form: FormData): { ok: true; value: RegistrationInput } | { ok: false; message: string } {
  // one space between words: the clash check and the unique index on lower(name) see the same name
  const name = text(form, "name").replace(/\s+/g, " ");
  const email = text(form, "email").toLowerCase();
  const phone = text(form, "phone");
  const commercial_register = text(form, "commercial_register");
  const city = text(form, "city");
  const country = text(form, "country");

  if (name.length < 3) return { ok: false, message: "اسم الشركة مطلوب." };
  if (NAME_WILDCARDS.test(name)) return { ok: false, message: "اسم الشركة لا يقبل الرموز % و _ و * و \\." };
  if (!EMAIL.test(email)) return { ok: false, message: "البريد الإلكتروني غير صحيح." };
  if (phone.replace(/\D/g, "").length < 8) return { ok: false, message: "رقم التواصل غير صحيح." };
  if (commercial_register.replace(/\s/g, "").length < 5) return { ok: false, message: "رقم السجل التجاري مطلوب." };
  if (!city || !country) return { ok: false, message: "المدينة والدولة مطلوبتان." };
  if (form.get("terms") !== "on") return { ok: false, message: "الموافقة على شروط التعاون مطلوبة." };

  const documents: RegistrationInput["documents"] = [];
  for (const kind of DOCUMENT_KINDS) {
    const file = form.get(`doc_${kind}`);
    if (!(file instanceof File) || file.size === 0) continue;
    const ext = TYPES[file.type];
    if (!ext) return { ok: false, message: `${DOCUMENT_LABEL[kind]}: الملف يجب أن يكون PDF أو صورة.` };
    if (file.size > MAX_BYTES) return { ok: false, message: `${DOCUMENT_LABEL[kind]}: الحد الأقصى 5 ميغابايت.` };
    documents.push({ kind, file, ext });
  }
  if (!documents.some((d) => d.kind === "commercial_register")) return { ok: false, message: "أرفق صورة السجل التجاري." };

  return {
    ok: true,
    value: {
      name,
      name_latin: optional(form, "name_latin"),
      email,
      phone,
      website: optional(form, "website"),
      address: optional(form, "address"),
      contact_name: optional(form, "contact_name"),
      note: optional(form, "note"),
      commercial_register,
      tourism_license: optional(form, "tourism_license"),
      vat_number: optional(form, "vat_number"),
      city,
      country,
      documents,
    },
  };
}

/** «B2B-261013-K7Q2»: the day it arrived and four characters nobody misreads (no 0/O, 1/I). */
export function newReferenceNo(now: Date, random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).replace(/-/g, "").slice(2);
  const tail = Array.from({ length: 4 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
  return `B2B-${day}-${tail}`;
}

/**
 * Record one attempt for `key` and say whether it is within `limit` per window.
 * ponytail: per-process memory — resets on deploy, each server process counts on
 * its own, and the whole log is dropped past 10,000 origins. Move it to a table
 * (or Turnstile) if the form is ever flooded across instances.
 */
export function allowAttempt(
  log: Map<string, number[]>,
  key: string,
  now: number,
  limit = PER_ORIGIN_LIMIT,
  windowMs = PER_ORIGIN_WINDOW_MS,
): boolean {
  if (log.size > 10_000) log.clear();
  const recent = (log.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  log.set(key, recent);
  return allowed;
}
