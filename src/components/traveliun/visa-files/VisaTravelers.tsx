"use client";

import { Plus, Trash2 } from "lucide-react";
import type { VisaTraveler } from "@/lib/visa-files/types";
import { blankTraveler } from "@/lib/visa-files/ui";
import { Section } from "./VisaFileSections";
import { btn, btnDanger, field, label, type Message } from "./visa-ui";

/**
 * «المسافرون»: one card per traveller. The passport number comes back masked («•••• 4567», it is stored encrypted):
 * leave it to keep it, type over it to change it. What «اقرأ الجواز» finds lands here as an edit, for the employee
 * to look at before «حفظ».
 */
export function VisaTravelers({
  value, onChange, applicants, dirty, busy, message, onSave,
}: {
  value: VisaTraveler[];
  onChange: (next: VisaTraveler[]) => void;
  applicants: number;
  dirty: boolean;
  busy: boolean;
  message: Message;
  onSave: () => void;
}) {
  const edit = (id: string, patch: Partial<VisaTraveler>) => onChange(value.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const text = (id: string, key: "fullName" | "passportNo" | "nationality" | "visaNo" | "note") => (e: { target: { value: string } }) => edit(id, { [key]: e.target.value });
  const gap = applicants - value.length;
  return (
    <Section
      id="travelers"
      title={`المسافرون (${value.length} من ${applicants})`}
      dirty={dirty}
      busy={busy}
      message={message}
      onSave={onSave}
      saveLabel="حفظ المسافرين"
      hint={gap !== 0 ? <p className="text-[13px] font-bold text-[#a86a10]">{gap > 0 ? `بقي ${gap} من المتقدمين لم تُدخل بياناتهم.` : "المدخلون أكثر من عدد المتقدمين في الملف."}</p> : null}
    >
      {value.length === 0 ? <p className="text-sm font-semibold text-[#8aa29b]">لم يُدخل مسافر بعد. أضف مسافراً، أو اقرأ جواز السفر من المستندات.</p> : null}
      <ul className="space-y-3">
        {value.map((t, i) => (
          <li key={t.id} className="space-y-3 rounded-[12px] border border-[#e2ebe7] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-[#185045]">المسافر <span className="tv-tnum">{i + 1}</span></p>
              <button type="button" className={btnDanger} aria-label={`حذف المسافر ${i + 1}`} onClick={() => onChange(value.filter((x) => x.id !== t.id))}><Trash2 className="size-4" /> حذف</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>الاسم كما في الجواز<input className={field} dir="auto" value={t.fullName} onChange={text(t.id, "fullName")} /></label>
              <label className={label}>رقم الجواز<input className={field} dir="ltr" autoComplete="off" value={t.passportNo ?? ""} onChange={text(t.id, "passportNo")} /></label>
              <label className={label}>الجنسية<input className={field} value={t.nationality ?? ""} onChange={text(t.id, "nationality")} /></label>
              <label className={label}>تاريخ الميلاد<input className={field} type="date" value={t.birthDate ?? ""} onChange={(e) => edit(t.id, { birthDate: e.target.value || null })} /></label>
              <label className={label}>انتهاء الجواز<input className={field} type="date" value={t.passportExpiry ?? ""} onChange={(e) => edit(t.id, { passportExpiry: e.target.value || null })} /></label>
              <label className={label}>نتيجة هذا المسافر
                <select className={field} value={t.result ?? ""} onChange={(e) => edit(t.id, { result: e.target.value === "approved" || e.target.value === "rejected" ? e.target.value : null })}>
                  <option value="">لم يردّ بعد</option>
                  <option value="approved">صدرت</option>
                  <option value="rejected">رُفضت</option>
                </select>
              </label>
              {t.result === "approved" ? <label className={label}>رقم التأشيرة<input className={field} dir="ltr" value={t.visaNo ?? ""} onChange={text(t.id, "visaNo")} /></label> : null}
              <label className={label}>ملاحظة<input className={field} value={t.note ?? ""} onChange={text(t.id, "note")} /></label>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className={btn} onClick={() => onChange([...value, blankTraveler(crypto.randomUUID())])}><Plus className="size-4" /> إضافة مسافر</button>
    </Section>
  );
}
