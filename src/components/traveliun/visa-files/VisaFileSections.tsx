"use client";

import { useState, type ReactNode } from "react";
import { CircleDot, Loader2, MessageSquareText, Phone, Wallet } from "lucide-react";
import { DirText } from "@/components/DirText";
import { CURRENCIES } from "@/lib/offer/draft-types";
import { METHOD_AR, PAYMENT_METHODS } from "@/lib/operations/payments";
import { dueAmount, feeTotal, paymentState, type VisaEvent, type VisaFile, type VisaPayment } from "@/lib/visa-files/types";
import { fmtDate, fmtDateTime, money, relativeDay, whoText, type DatesDraft, type DetailsDraft, type FollowDraft, type MoneyDraft, type PaymentDraft, type ServiceDraft } from "@/lib/visa-files/ui";
import { VisaServicesEditor } from "./VisaServicesEditor";
import { Notice, PaymentChip, area, btn, btnPrimary, card, field, heading, label, type Message, type Person } from "./visa-ui";

/** One card of the file's page: its title, its fields, and an explicit save that wakes only when something was edited. */
export function Section({
  id, title, dirty, busy, message, onSave, saveLabel = "حفظ", children, hint,
}: {
  id: string;
  title: string;
  dirty: boolean;
  busy: boolean;
  message: Message;
  onSave: () => void;
  saveLabel?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`${card} scroll-mt-24 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className={heading}>{title}</h2>
        {dirty ? <span className="rounded-full bg-[#fff8e8] px-3 py-0.5 text-xs font-extrabold text-[#a86a10]">تعديلات لم تُحفظ</span> : null}
      </div>
      {hint}
      {children}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="button" className={btnPrimary} disabled={!dirty || busy} onClick={onSave}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null} {saveLabel}
      </button>
    </section>
  );
}

type SectionState<D> = { draft: D; set: (patch: Partial<D>) => void; dirty: boolean; busy: boolean; message: Message; onSave: () => void };

/** «بيانات الطلب» */
export function DetailsSection({ draft, set, ...rest }: SectionState<DetailsDraft>) {
  return (
    <Section id="details" title="بيانات الطلب" {...rest}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>اسم العميل<input className={field} value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} /></label>
        <label className={label}>الجوال<input className={field} dir="ltr" inputMode="tel" value={draft.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} /></label>
        <label className={label}>الدولة<input className={field} value={draft.country} onChange={(e) => set({ country: e.target.value })} /></label>
        <label className={label}>نوع التأشيرة<input className={field} value={draft.visaType} onChange={(e) => set({ visaType: e.target.value })} /></label>
        <label className={label}>عدد المتقدمين<input className={field} dir="ltr" inputMode="numeric" value={draft.applicants} onChange={(e) => set({ applicants: e.target.value.replace(/[^\d]/g, "") })} /></label>
      </div>
      <label className={label}>ملاحظة<textarea className={area} value={draft.note} onChange={(e) => set({ note: e.target.value })} /></label>
    </Section>
  );
}

/** «المواعيد» — the dates the work runs on */
export function DatesSection({ draft, set, now, ...rest }: SectionState<DatesDraft> & { now: number }) {
  const late = draft.expectedReplyAt && !draft.repliedAt ? relativeDay(draft.expectedReplyAt, now) : "";
  return (
    <Section id="dates" title="المواعيد" {...rest}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>تاريخ التقديم<input className={field} type="date" value={draft.appliedAt} onChange={(e) => set({ appliedAt: e.target.value })} /></label>
        <label className={label}>موعد السفارة<input className={field} type="datetime-local" value={draft.appointmentAt} onChange={(e) => set({ appointmentAt: e.target.value })} /></label>
        <label className={label}>متى الرد المتوقع
          <input className={field} type="date" value={draft.expectedReplyAt} onChange={(e) => set({ expectedReplyAt: e.target.value })} />
          {late ? <span className={`text-[12px] font-bold ${late.startsWith("تأخر") ? "text-[#c22850]" : "text-[#557d78]"}`}>{late}</span> : null}
        </label>
        <label className={label}>تاريخ الرد الفعلي<input className={field} type="date" value={draft.repliedAt} onChange={(e) => set({ repliedAt: e.target.value })} /></label>
      </div>
    </Section>
  );
}

/** «الخدمات المقدمة» */
export function ServicesSection({ value, onChange, ...rest }: Omit<SectionState<ServiceDraft[]>, "draft" | "set"> & { value: ServiceDraft[]; onChange: (next: ServiceDraft[]) => void }) {
  return (
    <Section id="services" title="الخدمات" {...rest}>
      <VisaServicesEditor value={value} onChange={onChange} showDone disabled={rest.busy} />
    </Section>
  );
}

/** «المتابعة»: the next thing to do, a note or a call logged, and the file's timeline */
const EVENT_LABEL: Record<VisaEvent["kind"], string> = { created: "فتح الملف", status: "تغيير الحالة", note: "ملاحظة", payment: "دفعة", document: "مستند", contact: "اتصال بالعميل", edit: "تعديل" };
export function FollowupSection({
  draft, set, events, people, now, note, onNote, noteKind, onNoteKind, noteBusy, noteMessage, onAddNote, ...rest
}: SectionState<FollowDraft> & {
  events: VisaEvent[];
  people: Person[];
  now: number;
  note: string;
  onNote: (value: string) => void;
  noteKind: "note" | "contact";
  onNoteKind: (kind: "note" | "contact") => void;
  noteBusy: boolean;
  noteMessage: Message;
  onAddNote: () => void;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shown = all ? sorted : sorted.slice(0, 12);
  const due = draft.nextActionAt ? relativeDay(draft.nextActionAt, now) : "";
  return (
    <Section id="followup" title="المتابعة" {...rest}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <label className={label}>الإجراء التالي<input className={field} value={draft.nextAction} onChange={(e) => set({ nextAction: e.target.value })} placeholder="مثلاً: طلب كشف الحساب من العميل" /></label>
        <label className={label}>موعده
          <input className={field} type="date" value={draft.nextActionAt} onChange={(e) => set({ nextActionAt: e.target.value })} />
          {due ? <span className={`text-[12px] font-bold ${due.startsWith("تأخر") || due === "اليوم" ? "text-[#a86a10]" : "text-[#557d78]"}`}>{due}</span> : null}
        </label>
      </div>
      <div className="space-y-2 rounded-[12px] bg-[#f7faf8] p-3">
        <p className="text-[12px] font-bold text-[#185045]">سجّل ملاحظة أو اتصالاً</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="نوع السجل">
          {([["note", "ملاحظة داخلية", MessageSquareText], ["contact", "اتصال بالعميل", Phone]] as const).map(([kind, text, Icon]) => (
            <button key={kind} type="button" role="radio" aria-checked={noteKind === kind} onClick={() => onNoteKind(kind)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-[10px] border px-3 text-sm font-bold ${noteKind === kind ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045]"}`}>
              <Icon className="size-4" /> {text}
            </button>
          ))}
        </div>
        <textarea className={area} aria-label="نص السجل" value={note} onChange={(e) => onNote(e.target.value)} placeholder={noteKind === "contact" ? "ماذا قال العميل؟ وما الاتفاق؟" : "ملاحظة تظهر في سجل الملف"} />
        {noteMessage ? <Notice tone={noteMessage.tone}>{noteMessage.text}</Notice> : null}
        <button type="button" className={btn} disabled={noteBusy || !note.trim()} onClick={onAddNote}>
          {noteBusy ? <Loader2 className="size-4 animate-spin" /> : null} أضف إلى السجل
        </button>
      </div>
      <div>
        <h3 className="mb-2 text-[12px] font-bold text-[#185045]">سجل الملف</h3>
        {sorted.length === 0 ? <p className="text-sm font-semibold text-[#8aa29b]">لا أحداث بعد.</p> : (
          <ol className="space-y-2">
            {shown.map((e) => (
              <li key={e.id} className="flex gap-2 text-sm">
                <CircleDot className="mt-1 size-3.5 shrink-0 text-[#2aa87a]" />
                <div className="min-w-0">
                  <p className="font-semibold text-[#003c3a]"><span className="text-[#557d78]">{EVENT_LABEL[e.kind]}: </span>{e.text}</p>
                  <p className="text-xs text-[#8aa29b]">{fmtDateTime(e.at)}{whoText(e.by, people) ? ` · ${whoText(e.by, people)}` : ""}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {sorted.length > 12 && !all ? <button type="button" className={`${btn} mt-2`} onClick={() => setAll(true)}>عرض كل السجل ({sorted.length})</button> : null}
      </div>
    </Section>
  );
}

/** «الرسوم والمدفوعات»: the fees, what is paid and owed, the payments and a new one */
export function MoneySection({
  file, draft, set, payments, people, pay, onPay, payBusy, payMessage, onAddPayment, ...rest
}: SectionState<MoneyDraft> & {
  file: Pick<VisaFile, "feeService" | "feeEmbassy" | "paid" | "currency">;
  payments: VisaPayment[];
  people: Person[];
  pay: PaymentDraft;
  onPay: (patch: Partial<PaymentDraft>) => void;
  payBusy: boolean;
  payMessage: Message;
  onAddPayment: () => void;
}) {
  const state = paymentState(file);
  const cur = file.currency;
  return (
    <Section id="money" title="الرسوم والمدفوعات" {...rest}>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["الرسوم كلها", money(feeTotal(file), cur)], ["المدفوع", money(file.paid, cur)], ["المتبقي", money(dueAmount(file), cur)]] as const).map(([k, v]) => (
          <div key={k} className="rounded-[10px] bg-[#f7faf8] p-2.5">
            <dt className="text-[11px] font-bold text-[#8aa29b]">{k}</dt>
            <dd className="tv-tnum text-base font-extrabold text-[#185045]"><DirText>{v}</DirText></dd>
          </div>
        ))}
        <div className="flex items-center rounded-[10px] bg-[#f7faf8] p-2.5"><PaymentChip state={state} /></div>
      </dl>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>رسوم الخدمة<input className={field} dir="ltr" inputMode="decimal" value={draft.feeService} onChange={(e) => set({ feeService: e.target.value })} placeholder="0" /></label>
        <label className={label}>رسوم السفارة<input className={field} dir="ltr" inputMode="decimal" value={draft.feeEmbassy} onChange={(e) => set({ feeEmbassy: e.target.value })} placeholder="0" /></label>
        <label className={label}>العملة
          <select className={field} value={draft.currency} onChange={(e) => set({ currency: e.target.value })}>
            {[...new Set([...CURRENCIES, draft.currency])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="space-y-2 rounded-[12px] bg-[#f7faf8] p-3">
        <p className="flex items-center gap-2 text-[12px] font-bold text-[#185045]"><Wallet className="size-4" /> تسجيل دفعة</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>المبلغ ({cur})<input className={field} dir="ltr" inputMode="decimal" value={pay.amount} onChange={(e) => onPay({ amount: e.target.value })} placeholder={dueAmount(file) > 0 ? String(dueAmount(file)) : "0"} /></label>
          <label className={label}>الطريقة
            <select className={field} value={pay.method} onChange={(e) => onPay({ method: e.target.value })}>
              <option value="">غير محددة</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_AR[m]}</option>)}
            </select>
          </label>
          <label className={label}>التاريخ<input className={field} type="date" value={pay.paidAt} onChange={(e) => onPay({ paidAt: e.target.value })} /></label>
          <label className={label}>ملاحظة<input className={field} value={pay.note} onChange={(e) => onPay({ note: e.target.value })} /></label>
        </div>
        {payMessage ? <Notice tone={payMessage.tone}>{payMessage.text}</Notice> : null}
        <button type="button" className={btn} disabled={payBusy || !pay.amount.trim()} onClick={onAddPayment}>
          {payBusy ? <Loader2 className="size-4 animate-spin" /> : null} تسجيل الدفعة
        </button>
      </div>
      {payments.length > 0 ? (
        <ul className="divide-y divide-[#eef2f0] text-sm" aria-label="الدفعات">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
              <span className="font-extrabold text-[#0f7a52]"><DirText>{money(p.amount, cur)}</DirText></span>
              <span className="text-[#557d78]">{[p.method ? (METHOD_AR as Record<string, string>)[p.method] ?? p.method : null, p.note, whoText(p.by, people)].filter(Boolean).join(" · ")}</span>
              <span className="text-xs text-[#8aa29b]">{fmtDate(p.paidAt)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm font-semibold text-[#8aa29b]">لا دفعات مسجلة.</p>}
    </Section>
  );
}
