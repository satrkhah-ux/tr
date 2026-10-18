"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DirText } from "@/components/DirText";

/** Shared pieces of the «العمولات» pages — the operations money pages' look. */

export const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
export const th = "px-2.5 py-2 text-start text-[11px] font-bold text-[#93aaa3] whitespace-nowrap";
export const td = "px-2.5 py-2 text-[12px] font-bold text-[#0f3d38] whitespace-nowrap";
export const field = "h-10 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045]";
export const primary =
  "inline-flex h-10 items-center justify-center rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50";
export const secondary =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-[#dbe6e1] bg-white px-4 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-50";
export const danger =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-[#f3c7d2] bg-white px-4 text-[12.5px] font-bold text-[#c22850] hover:bg-[#fff5f7] disabled:opacity-50";

const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const sar = (n: number) => `${fmt.format(n)} ر.س`;

export const Num = ({ children, tone }: { children: string; tone?: string }) => (
  <span className={`tv-tnum ${tone ?? ""}`}>
    <DirText dir="ltr">{children}</DirText>
  </span>
);

export const STATUS: Record<string, { label: string; tone: string }> = {
  none: { label: "لم تُفتح بعد", tone: "bg-[#f1f5f3] text-[#557d78]" },
  draft: { label: "مسودة — تتحدث مع كل سداد", tone: "bg-[#f1f5f3] text-[#557d78]" },
  review: { label: "بانتظار الاعتماد", tone: "bg-[#fff8e8] text-[#a86a10]" },
  approved: { label: "معتمدة", tone: "bg-[#e8f6ef] text-[#17795a]" },
  paid: { label: "صُرفت", tone: "bg-[#e3f1ff] text-[#1f5fa8]" },
  void: { label: "ملغاة", tone: "bg-[#fff0f3] text-[#c22850]" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.none;
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${s.tone}`}>{s.label}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#e2ebe7] bg-[#fbfdfc] p-4">
      <div className="text-[11.5px] font-bold text-[#93aaa3]">{label}</div>
      <div className={`mt-1 text-[19px] font-extrabold ${tone ?? "text-[#003c3a]"}`}>
        <Num>{value}</Num>
      </div>
      {hint && <div className="mt-1 text-[11px] font-semibold text-[#93aaa3]">{hint}</div>}
    </div>
  );
}

export function MonthPicker({ month, action }: { month: string; action: string }) {
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      <input type="month" name="month" defaultValue={month} dir="ltr" className={field} aria-label="الشهر" />
      <button type="submit" className={secondary}>
        عرض
      </button>
    </form>
  );
}

export function Tabs({ active, manage }: { active: "mine" | "cycles" | "policy"; manage: boolean }) {
  const tabs: [string, string, typeof active][] = [["/commissions", "عمولتي", "mine"]];
  if (manage) tabs.push(["/commissions/cycles", "دورة العمولات", "cycles"], ["/commissions/policy", "سياسة العمولة", "policy"]);
  if (tabs.length < 2) return null;
  return (
    <nav className="flex flex-wrap gap-1.5">
      {tabs.map(([href, label, key]) => (
        <Link
          key={key}
          href={href}
          className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold ${
            key === active ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-[#185045]">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
