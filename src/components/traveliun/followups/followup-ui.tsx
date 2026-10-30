"use client";

import type { ReactNode } from "react";
import { HEAT_LABEL, type Heat } from "@/lib/followups/summary-core";
import { STEP_LABELS, todayGroup, type TodayGroup, type WorkRow } from "@/lib/followups/rules";

import { buttonTone } from "@/components/ui/button-variants";
/** «المتابعة»'s look (the owner's approved mockup, 2026-10-23): white cards on #F4F6F3, radius 16, 44 px targets. */
export const GREEN = "#185045";
export const CLAY = "#9A3412";
export const BLUE = "#1D4ED8";
export const card = "rounded-2xl border border-[#E3E8E4] bg-white";
export const btn = `${buttonTone({ variant: "secondary" })} inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors disabled:opacity-40`;
export const btnPrimary = `${buttonTone({ variant: "default" })} inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-opacity disabled:opacity-40`;
export const field = "tv-field w-full rounded-xl border p-3 text-sm";

export const when = (at: string | null) => at ? new Date(at).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }) : "—";
const riyadhDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(t);
export const isToday = (at: string | null, now: number) => Boolean(at) && riyadhDay(Date.parse(at!)) === riyadhDay(now);
/** An Arabic count: 1 ساعة, 2 ساعتان, 3–10 ساعات, 11+ ساعة (يوماً for days). */
export function count(n: number, [one, two, few, many]: readonly [string, string, string, string]): string {
  return n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}
const MINUTES = ["دقيقة", "دقيقتان", "دقائق", "دقيقة"] as const;
const HOURS = ["ساعة", "ساعتان", "ساعات", "ساعة"] as const;
const DAYS = ["يوم", "يومان", "أيام", "يوماً"] as const;
export const FILES = ["ملف", "ملفان", "ملفات", "ملفاً"] as const;
/** «3 ساعات» / «يومان» / «12 يوماً» */
export function since(at: string | null, now: number): string {
  if (!at) return "—";
  const min = Math.max(0, Math.round((now - Date.parse(at)) / 60000));
  if (min < 60) return min < 1 ? "الآن" : count(min, MINUTES);
  const h = Math.round(min / 60);
  if (h < 24) return count(h, HOURS);
  return count(Math.round(h / 24), DAYS);
}
export const GROUP: Record<TodayGroup, { label: string; color: string }> = {
  replied: { label: "رد العميل — ينتظر ردنا", color: BLUE },
  due: { label: "مستحقة اليوم", color: GREEN },
  late: { label: "متأخرة", color: CLAY },
};
const HEAT_TONE: Record<Heat, string> = { hot: "bg-[#FCE9E1] text-[#9A3412]", warm: "bg-[#FBF1D6] text-[#5C4300]", cold: "bg-[#E7EEF6] text-[#2F4F70]" };
export function HeatChip({ heat }: { heat: Heat | undefined }) {
  return heat ? <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${HEAT_TONE[heat]}`}>{HEAT_LABEL[heat]}</span> : null;
}
/** The step as its group colours it. */
export function StepLabel({ r, now }: { r: WorkRow; now: number }) {
  if (r.step === null) return <span className="text-xs text-slate-500">{r.source === "sla" ? "القائمة القديمة" : "تحويل"}</span>;
  const g = todayGroup(r, now);
  return <span className="text-xs font-extrabold" style={{ color: g ? GROUP[g].color : "#64748b" }}>{STEP_LABELS[r.step]}</span>;
}
/** بعد ساعتين / اليوم 1 / 3 / 7 / إغلاق: done ✓, today, late, next. */
export function StepChips({ r, now }: { r: WorkRow; now: number }) {
  if (r.step === null) return null;
  const g = todayGroup(r, now);
  return <div className="flex flex-wrap gap-1.5">{STEP_LABELS.map((label, s) => {
    const tone = s < r.step! ? "bg-[#E4F0EA] text-[#185045]" : s > r.step! ? "bg-slate-100 text-slate-500" : g === "late" ? "bg-[#9A3412] text-white" : g ? "bg-[#185045] text-white" : "bg-slate-100 text-slate-600";
    return <span key={label} className={`rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{s < r.step! ? "✓ " : ""}{label}</span>;
  })}</div>;
}
export function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 py-1.5 text-sm @min-[720px]:grid-cols-[7.5rem_minmax(0,1fr)] @min-[720px]:gap-2"><span className="text-xs text-slate-500 @min-[720px]:text-sm">{label}</span><span className={strong ? "font-extrabold text-[#185045]" : "text-slate-800"}>{children}</span></div>;
}
export const errors: Record<string, string> = {
  forbidden: "ليس لديك صلاحية لهذا الملف. قد يكون أُسند لموظف آخر.", claimed: "استلم موظف آخر هذا الملف.",
  due: "اختر موعدًا قادمًا.", note: "اكتب سبب الإغلاق.", reason: "اختر سبب الإغلاق.", busy: "يوجد إرسال قيد المعالجة. تحقّق من نتيجته أولًا.",
  uncertain: "لم تتأكد نتيجة الإرسال. لا نكرره. استخدم «تحقق من الإرسال».",
  window: "مرّت 24 ساعة على آخر رسالة من العميل ولا قالب لهذه الخطوة. اتصل بالعميل ثم سجّل النتيجة.",
  template: "قالب هذه الخطوة لم تعتمده واتساب بعد. اتصل بالعميل ثم سجّل النتيجة.",
  destination: "الوجهة غير معروفة، والقالب يحتاجها. انتظر ملخص مُراد أو اتصل بالعميل.",
  murad: "تعذّر على مُراد قراءة المحادثة الآن. حاول بعد قليل.",
  invalid: "راجع البيانات المطلوبة.", unreachable: "تعذر الاتصال بـTeletel. لم نؤكد نجاح العملية.", done: "هذه المتابعة مغلقة.", failed: "تعذر حفظ العملية.", conflict: "تغير الملف أثناء العمل. حدّث الصفحة.",
};
