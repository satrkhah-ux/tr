"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import type { VisaIssue, VisaReview } from "@/lib/data/visa-review";
import { useTraveliunUI } from "./TraveliunUIProvider";

const TONE: Record<VisaIssue, string> = {
  lostWhenHidden: "border-[#f2c9d3] bg-[#fdf3f5] text-[#c22850]",
  noRequirements: "border-[#f2c9d3] bg-[#fdf3f5] text-[#c22850]",
  noCountry: "border-[#f2c9d3] bg-[#fdf3f5] text-[#c22850]",
  noPrice: "border-[#f1dca7] bg-[#fff8e6] text-[#7a5a12]",
  notSar: "border-[#f1dca7] bg-[#fff8e6] text-[#7a5a12]",
  runOn: "border-[#f1dca7] bg-[#fff8e6] text-[#7a5a12]",
  pricesInside: "border-[#f1dca7] bg-[#fff8e6] text-[#7a5a12]",
  inactive: "border-[#dbe6e1] bg-[#f4f8f6] text-[#557d78]",
};

/**
 * «مراجعة قائمة التأشيرات» above the /visas table: each country Murad would
 * answer badly, and why — the list goes to the client on WhatsApp as it is.
 */
export function VisaListReview({ total, reviews }: { total: number; reviews: VisaReview[] }) {
  const { t } = useTraveliunUI();
  const todo = reviews.length;
  return (
    <details open={todo > 0} className="mb-4 rounded-2xl border border-[#e2ebe7] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
        {todo ? <AlertTriangle className="size-4 text-[#b7791f]" aria-hidden /> : <CheckCircle2 className="size-4 text-[#0f7a52]" aria-hidden />}
        <span className="text-[14px] font-extrabold text-[#003c3a]">{t("data.visas.review.title")}</span>
        <span className="tv-tnum text-[12.5px] font-bold text-[#557d78]">
          {t("data.visas.review.summary", { total, ready: total - todo, todo })}
        </span>
      </summary>
      <p className="mt-2 text-[12px] font-semibold text-[#93aaa3]">{todo ? t("data.visas.review.hint") : t("data.visas.review.clean")}</p>
      {todo ? (
        <ul className="mt-3 grid gap-2">
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-[#eef4f1] pt-2">
              {/* the table opens that one row's details from ?id= */}
              <a href={`/visas?id=${r.id}`} className="min-w-[110px] text-[13px] font-extrabold text-[#185045] underline-offset-4 hover:underline">
                {r.country}
                {r.visa_type ? <span className="font-semibold text-[#93aaa3]"> · {r.visa_type}</span> : null}
              </a>
              <span className="flex flex-1 flex-wrap gap-1.5">
                {r.issues.map((issue) => (
                  <span key={issue} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${TONE[issue]}`}>
                    {t(`data.visas.issue.${issue}` as TranslationKey)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
