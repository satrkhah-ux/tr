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
  const name = text(form, "name");
  const email = text(form, "email").toLowerCase();
  const phone = text(form, "phone");
  const commercial_register = text(form, "commercial_register");
  const city = text(form, "city");
  const country = text(form, "country");

  if (name.length < 3) return { ok: false, message: "اسم الشركة مطلوب." };
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
