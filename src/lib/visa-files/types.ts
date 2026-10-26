/**
 * «ملف التأشيرة» (the owner, 2026-10-26: «اضف قسم التأشيرات وكذلك امكانية عمل ملف خاص بالتأشيرات — يختار بيانات
 * المسافر يسحبونه من تليتيل والدولة والعدد وتاريخ التقديم والخدمات المقدمة ثم ماذا ارفق ومتى الرد ومتابعة كاملة لقسم
 * التأشيرات ولوحة كاملة للطلبات التي جهزت وقيد التنفيذ والعملاء لم يسددوا»).
 *
 * The contract the data layer (src/lib/data/visa-files.ts) and the screens (src/app/visa-files, src/components/
 * traveliun/visa-files) are built against. Pure: no server code, so both sides import it.
 */

/** where a file stands — the order is the work's order */
export const VISA_STATUSES = ["new", "collecting", "ready", "submitted", "approved", "rejected", "delivered", "cancelled"] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number];
export const VISA_STATUS_LABEL: Record<VisaStatus, string> = {
  new: "جديد",
  collecting: "جمع المستندات",
  ready: "جاهز للتقديم",
  submitted: "قُدِّم — بانتظار الرد",
  approved: "صدرت التأشيرة",
  rejected: "رُفضت",
  delivered: "سُلِّمت للعميل",
  cancelled: "ملغاة",
};
/** still being worked on (not finished either way) */
export const VISA_OPEN: readonly VisaStatus[] = ["new", "collecting", "ready", "submitted"];

/** the documents a file collects — «ماذا أرفق» */
export const VISA_DOC_KINDS = ["passport", "photo", "residence", "bank_statement", "employment_letter", "hotel", "flight", "insurance", "invitation", "form", "receipt", "other"] as const;
export type VisaDocKind = (typeof VISA_DOC_KINDS)[number];
export const VISA_DOC_LABEL: Record<VisaDocKind, string> = {
  passport: "جواز السفر",
  photo: "صورة شخصية",
  residence: "الإقامة أو تأشيرة الزيارة",
  bank_statement: "كشف حساب بنكي",
  employment_letter: "خطاب عمل",
  hotel: "حجز فندق",
  flight: "حجز طيران",
  insurance: "تأمين سفر",
  invitation: "دعوة",
  form: "استمارة التقديم",
  receipt: "إيصال الرسوم",
  other: "مستند آخر",
};

/** the services the company gives on a file — a starting list; the employee may add his own line */
export const VISA_SERVICE_KEYS = ["appointment", "form_filling", "translation", "hotel_booking", "flight_booking", "insurance", "documents_review", "submission", "tracking", "delivery"] as const;
export const VISA_SERVICE_LABEL: Record<(typeof VISA_SERVICE_KEYS)[number], string> = {
  appointment: "حجز موعد",
  form_filling: "تعبئة الاستمارة",
  translation: "ترجمة",
  hotel_booking: "حجز فندق",
  flight_booking: "حجز طيران",
  insurance: "تأمين سفر",
  documents_review: "مراجعة المستندات",
  submission: "التقديم للسفارة",
  tracking: "متابعة الطلب",
  delivery: "تسليم التأشيرة",
};

export type VisaTraveler = {
  id: string;
  fullName: string;
  /** read back masked (•••• 1234) unless the reader asked for the whole number — it is stored encrypted */
  passportNo: string | null;
  nationality: string | null;
  birthDate: string | null;
  passportExpiry: string | null;
  /** this traveller's own result, once the embassy answered */
  result: "approved" | "rejected" | null;
  visaNo: string | null;
  note: string | null;
};

export type VisaDoc = {
  id: string;
  kind: VisaDocKind;
  label: string;
  travelerId: string | null;
  /** path in the private «visas» bucket; null while it is only expected */
  path: string | null;
  fileName: string | null;
  required: boolean;
  receivedAt: string | null;
  /** attached to the application that went to the embassy */
  submittedAt: string | null;
  /** came from this Teletel conversation message, when it did */
  fromMessageId: number | null;
};

export type VisaService = { key: string; label: string; price: number | null; done: boolean };

export type VisaFile = {
  id: string;
  /** «VF-26-0001» */
  serial: string;
  status: VisaStatus;
  country: string;
  countryId: string | null;
  /** the catalogue row it follows (visas.id) — its requirements become the expected documents */
  visaCatalogId: string | null;
  visaType: string | null;
  applicants: number;
  clientName: string;
  clientPhone: string | null;
  conversationId: number | null;
  contactId: number | null;
  leadId: string | null;
  assignedTo: string | null;
  travelers: VisaTraveler[];
  documents: VisaDoc[];
  services: VisaService[];
  /** تاريخ التقديم */
  appliedAt: string | null;
  appointmentAt: string | null;
  /** متى الرد */
  expectedReplyAt: string | null;
  repliedAt: string | null;
  feeService: number;
  feeEmbassy: number;
  currency: string;
  /** sum of the payments (visa_file_payments) — kept on the row so the board needs no join */
  paid: number;
  /** the next thing to do on the file, and when */
  nextAction: string | null;
  nextActionAt: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VisaPayment = { id: string; fileId: string; amount: number; method: string | null; note: string | null; paidAt: string; by: string | null };
export type VisaEvent = { id: string; fileId: string; at: string; by: string | null; kind: "created" | "status" | "note" | "payment" | "document" | "contact" | "edit"; text: string };

export type PaymentState = "unpaid" | "partial" | "paid" | "free";
export const PAYMENT_LABEL: Record<PaymentState, string> = { unpaid: "لم يسدد", partial: "سدد جزءاً", paid: "مسدّد", free: "بلا رسوم" };

/** fees owed in total */
export const feeTotal = (f: Pick<VisaFile, "feeService" | "feeEmbassy">) => f.feeService + f.feeEmbassy;
export const dueAmount = (f: Pick<VisaFile, "feeService" | "feeEmbassy" | "paid">) => Math.max(0, Math.round((feeTotal(f) - f.paid) * 100) / 100);
export function paymentState(f: Pick<VisaFile, "feeService" | "feeEmbassy" | "paid">): PaymentState {
  const total = feeTotal(f);
  if (total <= 0) return "free";
  if (f.paid <= 0) return "unpaid";
  return f.paid + 0.005 >= total ? "paid" : "partial";
}

/** documents still missing: required, not received */
export const missingDocs = (f: Pick<VisaFile, "documents">) => f.documents.filter((d) => d.required && !d.receivedAt);
/** the reply is late: submitted, the expected date has passed, no answer yet */
export const replyOverdue = (f: Pick<VisaFile, "status" | "expectedReplyAt" | "repliedAt">, now = Date.now()) =>
  f.status === "submitted" && !f.repliedAt && f.expectedReplyAt !== null && Date.parse(f.expectedReplyAt) < now;
/** the next action is due (or past due) */
export const actionDue = (f: Pick<VisaFile, "status" | "nextActionAt">, now = Date.now()) =>
  (VISA_OPEN as readonly string[]).includes(f.status) && f.nextActionAt !== null && Date.parse(f.nextActionAt) <= now;

/** the board's rows and counters (src/lib/data/visa-files.ts getVisaBoard) */
export type VisaRow = Pick<VisaFile, "id" | "serial" | "status" | "country" | "visaType" | "applicants" | "clientName" | "clientPhone" | "assignedTo" | "appliedAt" | "expectedReplyAt" | "feeService" | "feeEmbassy" | "currency" | "paid" | "nextAction" | "nextActionAt" | "updatedAt" | "createdAt"> & { missingDocs: number };
export type VisaBoard = {
  /** the employees who work visa files, for the filter and the per-person load */
  people: { id: string; name: string; open: number }[];
  counts: {
    total: number;
    byStatus: Record<VisaStatus, number>;
    /** open files whose fees are not all paid, and what is owed (per currency) */
    unpaid: { files: number; due: Record<string, number> };
    missingDocs: number;
    replyOverdue: number;
    actionDue: number;
    /** approved, not yet handed to the client */
    toDeliver: number;
  };
  rows: VisaRow[];
};

export type VisaFilter = {
  status?: VisaStatus | "open" | "all";
  country?: string;
  assignedTo?: string | "none";
  payment?: PaymentState | "owing";
  search?: string;
  /** one of the board's counters, as a filter */
  focus?: "missingDocs" | "replyOverdue" | "actionDue" | "toDeliver" | "unpaid";
  limit?: number;
};

/** What a Teletel conversation gives a new file (pullFromTeletel) — «يسحبونه من تليتيل». */
export type TeletelPull = {
  conversationId: number;
  contactId: number | null;
  clientName: string;
  clientPhone: string | null;
  /** what Murad's visa intake already learned (murad_log.intake.visa_flow), when he took it */
  intake: { country: string | null; nationality: string | null; applicants: number | null } | null;
  /** the lead (client_leads) of this conversation, when there is one */
  leadId: string | null;
  attachments: { messageId: number; attachmentId: number; fileName: string; fileType: string; at: string; fromClient: boolean }[];
};
export type TeletelCandidate = { conversationId: number; contactName: string; phone: string | null; lastActivityAt: number; team: string | null; assignee: string | null };

export type VisaActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
