"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { MySalesCard } from "@/lib/data/commissions";
import { askMurad } from "./secretary/send-error";

const n = (x: number) => Math.round(x).toLocaleString("en-US");

/**
 * «مبيعاتك / حققت من هدفك / العملاء المؤكدون / عمولتك» (the owner, 2026-10-30) — the employee's own month,
 * from «عمولتي»: a file counts in the month its client finished paying. Nothing of a colleague's.
 */
export function SalesTargetCard({ data }: { data: MySalesCard }) {
  const p = data.progress;
  return (
    <section dir="rtl" className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] sm:p-5">
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-4">
        <Figure label="مبيعاتك هذا الشهر" value={n(data.sales)} unit="ر.س" />
        <div className="order-first col-span-3 rounded-xl border border-[#e2ebe7] bg-[#fbfdfc] p-3 lg:order-none lg:col-span-1">
          <div className="text-[11.5px] font-bold text-tv-text-faint">حققت من هدفك</div>
          {p ? (
            <>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="tv-tnum text-[22px] font-extrabold text-[#17795a]" dir="ltr">{p.pct}%</span>
                <span className="text-[11px] font-semibold text-tv-text-faint">من <span className="tv-tnum" dir="ltr">{n(data.target ?? 0)}</span> ر.س</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e7efec]" role="progressbar" aria-valuenow={p.bar} aria-valuemin={0} aria-valuemax={100} aria-label="التقدم نحو الهدف">
                <div className="h-full rounded-full bg-[#17795a]" style={{ width: `${p.bar}%` }} />
              </div>
              <div className="mt-1.5 text-[11px] font-semibold text-tv-text-faint">
                {p.left > 0 ? <>الباقي <span className="tv-tnum" dir="ltr">{n(p.left)}</span> ر.س · {data.daysLeft} يوماً</> : "بلغت هدفك — استمر"}
              </div>
            </>
          ) : (
            <div className="mt-1 text-[13px] font-bold text-tv-text-faint">لم يُحدَّد لك هدف بعد</div>
          )}
        </div>
        <Figure label="عدد العملاء المؤكدين" value={String(data.clients)} hint="أكملوا الدفع هذا الشهر" />
        <Figure label={data.frozen ? "عمولتك" : "عمولتك (تقديرية)"} value={n(data.commission)} unit="ر.س" tone="text-[#17795a]" href="/commissions" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f0f7f4] px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#185045]">
          <Sparkles className="size-4 shrink-0" /> مُراد يساعدك للوصول إلى هدفك
        </span>
        <button
          type="button"
          onClick={() => askMurad("كيف أصل إلى هدفي هذا الشهر؟")}
          className="min-h-10 rounded-[10px] bg-[var(--tv-brand)] px-4 text-[12.5px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          اسأل مُراد
        </button>
      </div>
    </section>
  );
}

function Figure({ label, value, unit, hint, tone, href }: { label: string; value: string; unit?: string; hint?: string; tone?: string; href?: string }) {
  const body = (
    <>
      <div className="text-[11px] font-bold leading-4 text-tv-text-faint sm:text-[11.5px]">{label}</div>
      <div className={`mt-1 break-words text-[16px] font-extrabold sm:text-[20px] ${tone ?? "text-[#003c3a]"}`}>
        <span className="tv-tnum" dir="ltr">{value}</span>
        {unit && <span className="ms-1 text-[11px] font-bold text-tv-text-faint">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] font-semibold text-tv-text-faint">{hint}</div>}
    </>
  );
  const cls = "min-w-0 rounded-xl border border-[#e2ebe7] bg-[#fbfdfc] p-2.5 sm:p-3";
  return href ? <Link href={href} className={`${cls} hover:bg-[#f4f8f6]`}>{body}</Link> : <div className={cls}>{body}</div>;
}
