"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, Loader2, MessageCircle, Phone, RefreshCw } from "lucide-react";
import { DirText } from "@/components/DirText";
import { VISA_STATUS_LABEL, type VisaFile, type VisaStatus } from "@/lib/visa-files/types";
import { NEXT_STATUS, fmtDate, stepLabel } from "@/lib/visa-files/ui";
import { Notice, StatusChip, btn, btnDanger, btnPrimary, card, field, label, type Message, type Person } from "./visa-ui";

type HeaderFile = Pick<VisaFile, "serial" | "status" | "clientName" | "clientPhone" | "conversationId" | "assignedTo" | "country" | "visaType" | "applicants" | "createdAt">;

/** The file's top: who it is for, how to reach him, where it stands, who holds it. */
export function VisaFileHeader({
  file, teletelUrl, manager, people, assignee, assigning, assignMessage, onAssignee, onAssign, onRefresh, refreshing,
}: {
  file: HeaderFile;
  /** the conversation's page in Teletel, when the server could build it */
  teletelUrl: string | null;
  manager: boolean;
  people: Person[];
  /** the picker's value ("" — nobody) while it is being changed */
  assignee: string;
  assigning: boolean;
  assignMessage: Message;
  onAssignee: (value: string) => void;
  onAssign: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const holder = file.assignedTo === null ? "بلا مسؤول" : (people.find((p) => p.id === file.assignedTo)?.name ?? "مُسنَد");
  const changed = assignee !== (file.assignedTo ?? "");
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/visa-files" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 text-sm font-bold text-[#557d78] hover:bg-[#f4f8f6]"><ArrowRight className="size-4" /> اللوحة</Link>
          <DirText className="text-sm font-bold text-[#6f8f88]">{file.serial}</DirText>
          <StatusChip status={file.status} />
        </div>
        <button type="button" className={btn} onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> تحديث
        </button>
      </div>
      <h1 className="text-xl font-extrabold text-[#003c3a]">{file.clientName}</h1>
      <p className="text-sm font-semibold text-[#185045]">
        {[file.country, file.visaType].filter(Boolean).join(" · ")} · <span className="tv-tnum">{file.applicants}</span> مسافر · فُتح {fmtDate(file.createdAt)}
      </p>
      <div className="flex flex-wrap gap-2">
        {file.clientPhone ? (
          <a href={`tel:${file.clientPhone}`} className={btn}><Phone className="size-4" /> <DirText>{file.clientPhone}</DirText></a>
        ) : null}
        {file.conversationId !== null && teletelUrl ? (
          <a href={teletelUrl} target="_blank" rel="noreferrer" className={btn}><MessageCircle className="size-4" /> فتح في تليتيل <ExternalLink className="size-3.5" /></a>
        ) : null}
        {file.conversationId !== null && !teletelUrl ? (
          <span className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#557d78]"><MessageCircle className="size-4" /> محادثة تليتيل <DirText>#{file.conversationId}</DirText></span>
        ) : null}
      </div>
      {manager ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${label} w-full sm:w-64`}>
            المسؤول عن الملف
            <select className={field} value={assignee} disabled={assigning} onChange={(e) => onAssignee(e.target.value)}>
              <option value="">بلا مسؤول</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {file.assignedTo && !people.some((p) => p.id === file.assignedTo) ? <option value={file.assignedTo}>{holder}</option> : null}
            </select>
          </label>
          {changed ? (
            <button type="button" className={btnPrimary} disabled={assigning} onClick={onAssign}>
              {assigning ? <Loader2 className="size-4 animate-spin" /> : null} نقل الملف
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm font-semibold text-[#557d78]">المسؤول: {holder}</p>
      )}
      {assignMessage ? <Notice tone={assignMessage.tone}>{assignMessage.text}</Notice> : null}
    </section>
  );
}

const CONFIRM_TEXT: Partial<Record<VisaStatus, string>> = {
  approved: "سيُسجَّل أن السفارة وافقت وصدرت التأشيرة.",
  rejected: "سيُسجَّل أن السفارة رفضت الطلب.",
  cancelled: "سيخرج الملف من الملفات المفتوحة.",
};

/** The steps the file may take from where it stands. The embassy's answers and a cancel ask «هل أنت متأكد؟» first. */
export function StatusBar({
  status, confirming, owing, note, busy, message, onPick, onConfirm, onCancel, onNote,
}: {
  status: VisaStatus;
  confirming: VisaStatus | null;
  /** the fees still owed, said when the file is about to be handed over unpaid — never a block, only a red question */
  owing?: string | null;
  note: string;
  busy: boolean;
  message: Message;
  onPick: (to: VisaStatus) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onNote: (value: string) => void;
}) {
  const next = NEXT_STATUS[status];
  return (
    <section className={`${card} space-y-3`} aria-label="خطوات الملف">
      <h2 className="text-sm font-extrabold text-[#185045]">الخطوة التالية</h2>
      {next.length === 0 ? (
        <p className="text-sm font-semibold text-[#557d78]">انتهى العمل في هذا الملف ({VISA_STATUS_LABEL[status]}).</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next.map((to, i) => (
            <button
              key={to}
              type="button"
              disabled={busy || confirming !== null}
              onClick={() => onPick(to)}
              className={to === "cancelled" ? btnDanger : i === 0 ? btnPrimary : btn}
            >
              {stepLabel(status, to)}
            </button>
          ))}
        </div>
      )}
      {confirming ? (
        <div role="alertdialog" aria-label="تأكيد الخطوة" className="space-y-2 rounded-[12px] border border-[#f2e2b4] bg-[#fff8e8] p-3">
          <p className="text-sm font-extrabold text-[#a86a10]">هل أنت متأكد من «{VISA_STATUS_LABEL[confirming]}»؟</p>
          {CONFIRM_TEXT[confirming] ? <p className="text-[13px] font-semibold text-[#a86a10]">{CONFIRM_TEXT[confirming]}</p> : null}
          {owing ? <p role="alert" className="rounded-[8px] bg-[#fdeef2] p-2 text-[13px] font-extrabold text-[#a3263f]">لم يسدد العميل كامل الرسوم — المتبقي {owing}. التسليم غير ممنوع، لكن تأكّد أنه مقصود.</p> : null}
          <label className={label}>
            ملاحظة (اختيارية)
            <input className={field} value={note} onChange={(e) => onNote(e.target.value)} placeholder={confirming === "rejected" ? "سبب الرفض كما ذكرته السفارة" : "تُحفظ في سجل الملف"} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={confirming === "cancelled" || confirming === "rejected" || owing ? btnDanger : btnPrimary} disabled={busy} onClick={onConfirm}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} نعم، أكّد
            </button>
            <button type="button" className={btn} disabled={busy} onClick={onCancel}>تراجع</button>
          </div>
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}
