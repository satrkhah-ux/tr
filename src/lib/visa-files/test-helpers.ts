import type { VisaBoard, VisaDoc, VisaFile, VisaRow, VisaStatus } from "@/lib/visa-files/types";

/** Shared fixtures of the visa screens' tests: the owner's own words, a file as the server would hand it. */
export const NOW = Date.parse("2026-10-26T09:00:00+03:00");

export const visaRow = (over: Partial<VisaRow> = {}): VisaRow => ({
  id: "f1", serial: "VF-26-0001", status: "collecting", country: "جورجيا", visaType: "سياحية", applicants: 2, clientName: "أحمد العتيبي", clientPhone: "0501112233",
  assignedTo: "emp-1", appliedAt: "2026-10-20", expectedReplyAt: null, feeService: 300, feeEmbassy: 200, currency: "SAR", paid: 0, nextAction: null, nextActionAt: null,
  updatedAt: "2026-10-25T10:00:00Z", createdAt: "2026-10-20T10:00:00Z", missingDocs: 0, ...over,
});

const zeroByStatus = (): Record<VisaStatus, number> => ({ new: 0, collecting: 0, ready: 0, submitted: 0, approved: 0, rejected: 0, delivered: 0, cancelled: 0 });
export const visaBoard = (over: Partial<VisaBoard> = {}): VisaBoard => ({
  people: [{ id: "emp-1", name: "ريم", open: 4 }, { id: "emp-2", name: "خالد", open: 1 }],
  counts: {
    total: 12,
    byStatus: { ...zeroByStatus(), new: 1, collecting: 3, ready: 2, submitted: 4, approved: 1, rejected: 1, delivered: 0 },
    unpaid: { files: 5, due: { SAR: 2400, USD: 300 } },
    missingDocs: 3,
    replyOverdue: 2,
    actionDue: 1,
    toDeliver: 1,
  },
  rows: [
    visaRow({ missingDocs: 2, nextAction: "طلب كشف الحساب", nextActionAt: "2026-10-26" }),
    visaRow({ id: "f2", serial: "VF-26-0002", status: "submitted", clientName: "سارة", country: "تركيا", assignedTo: "emp-2", expectedReplyAt: "2026-10-22", paid: 500 }),
  ],
  ...over,
});

export const visaDoc = (over: Partial<VisaDoc> = {}): VisaDoc => ({
  id: "d1", kind: "passport", label: "جواز السفر", travelerId: null, path: null, fileName: null, required: true, receivedAt: null, submittedAt: null, fromMessageId: null, ...over,
});

export const visaFile = (over: Partial<VisaFile> = {}): VisaFile => ({
  id: "f1", serial: "VF-26-0001", status: "collecting", country: "جورجيا", countryId: "c2", visaCatalogId: "v1", visaType: "سياحية", applicants: 2,
  clientName: "أحمد العتيبي", clientPhone: "0501112233", conversationId: 4821, contactId: 90, leadId: null, assignedTo: "emp-1",
  travelers: [{ id: "t1", fullName: "أحمد العتيبي", passportNo: "•••• 4567", nationality: "سعودي", birthDate: "1990-02-03", passportExpiry: "2030-05-01", result: null, visaNo: null, note: null }],
  documents: [
    visaDoc({ id: "d1", kind: "passport", label: "جواز السفر", path: "f1/d1.jpg", fileName: "passport.jpg", receivedAt: "2026-10-24T10:00:00Z" }),
    visaDoc({ id: "d2", kind: "photo", label: "صورة شخصية" }),
    visaDoc({ id: "d3", kind: "bank_statement", label: "كشف حساب بنكي" }),
    visaDoc({ id: "d4", kind: "insurance", label: "تأمين سفر", required: false }),
  ],
  services: [{ key: "appointment", label: "حجز موعد", price: 100, done: false }],
  appliedAt: "2026-10-20", appointmentAt: "2026-10-30T07:30:00Z", expectedReplyAt: "2026-11-05", repliedAt: null,
  feeService: 300, feeEmbassy: 200, currency: "SAR", paid: 120, nextAction: "طلب كشف الحساب", nextActionAt: "2026-10-27", note: null,
  createdBy: "emp-1", createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-25T10:00:00Z", ...over,
});
