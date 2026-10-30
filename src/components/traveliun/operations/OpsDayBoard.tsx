"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ClipboardCheck, Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { OpsDay, OpsDayItem } from "@/lib/data/ops-day";
import { normAr } from "@/lib/catalog/norm";
import type { TranslationKey } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";

/** today's audit actions, in the clerk's words — anything unmapped shows its raw key */
const DONE_LABEL: Record<string, string> = {
  "dispatch.sent": "أُرسل طلب لمورّد",
  "visa.updated": "حُدّثت حالة تأشيرة",
  "operation.execution_status": "تحرّكت حالة ملف",
  "operation.client_status": "تحرّكت حالة عميل",
};

/**
 * «مهام اليوم» (the owner, 2026-10-26): every live case's missing items in one
 * quiet list, the urgent travel first; a row opens its case on the right step.
 * Done work is FOLLOWED, not ticked: an item vanishes when its evidence
 * exists, and «أنجزت اليوم» reads the clerk's own trail.
 */
export function OpsDayBoard({ day }: { day: OpsDay }) {
  const { t, language } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const folded = normAr(query);
  const shown = useMemo(
    () => day.items.filter((i) => !folded || normAr(`${i.customer} ${i.serial}`).includes(folded)),
    [day.items, folded],
  );
  const byCase = useMemo(() => {
    const groups = new Map<string, OpsDayItem[]>();
    for (const i of shown) groups.set(i.operationId, [...(groups.get(i.operationId) ?? []), i]);
    return [...groups.values()];
  }, [shown]);

  const when = (iso: string) =>
    new Date(iso).toLocaleTimeString(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });

  return (
    <TraveliunShell title="nav.opsDay">
      <div className="tv-fade-up mx-auto max-w-3xl space-y-3">
        <section className="rounded-2xl border border-[#e2ebe7] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-extrabold text-[#003c3a]">{t("ops.day.title")}</h1>
            <p className="tv-tnum text-[12px] font-semibold text-tv-text-faint">{t("ops.day.subtitle", { items: String(day.items.length), cases: String(day.cases) })}</p>
            <div className="relative ms-auto">
              <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("ops.list.searchHint")}
                className="h-9 w-56 rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]"
              />
            </div>
          </div>
        </section>

        {byCase.length === 0 ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState icon={ClipboardCheck} title={t("ops.day.empty")} description="" />
          </section>
        ) : (
          byCase.map((group) => {
            const head = group[0];
            const urgent = head.urgency !== "normal";
            return (
              <section key={head.operationId} className="rounded-2xl border border-[#e2ebe7] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-[13.5px] font-extrabold text-[#0f3d38]">
                    {head.customer}
                    <DirText dir="ltr" className="tv-tnum ms-2 text-[11.5px] font-bold text-tv-text-faint">{head.serial}</DirText>
                  </p>
                  {head.travelStart ? (
                    <span className={`tv-tnum rounded-full px-2.5 py-0.5 text-[11px] font-bold ${urgent ? "bg-[#fdeef2] text-[#c22850]" : "bg-[#eef5f2] text-[#557d78]"}`}>
                      {t("ops.travelWindow")} <DirText dir="ltr">{head.travelStart}</DirText>
                    </span>
                  ) : null}
                </div>
                <ul className="grid gap-1">
                  {group.map((i, n) => (
                    <li key={`${i.step}-${i.labelKey}-${n}`}>
                      <Link
                        href={`/operations/${i.operationId}`}
                        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-[#f6faf8]"
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-[#b9c8c3]" aria-hidden />
                        <span className="min-w-0 flex-1 text-[12.5px] font-bold text-[#185045]">
                          {t(i.labelKey)}
                          <span className="ms-2 text-[11px] font-semibold text-tv-text-faint">{t(`wz.step.${i.step}` as TranslationKey)}</span>
                        </span>
                        <ArrowLeft className="size-3.5 shrink-0 text-tv-text-faint ltr:rotate-180" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="flex w-full items-center gap-2 text-start">
            <Check className="size-4 text-[#0f7a52]" />
            <span className="flex-1 text-[13px] font-extrabold text-[#0f3d38]">{t("ops.day.done", { n: String(day.done.length) })}</span>
            <ChevronDown className={`size-4 text-tv-text-faint transition-transform ${showDone ? "rotate-180" : ""}`} />
          </button>
          {showDone && day.done.length > 0 ? (
            <ul className="mt-2 grid gap-1 border-t border-[#f0f4f2] pt-2">
              {day.done.map((d, n) => (
                <li key={n} className="flex items-center gap-2 px-1 text-[12px] font-semibold text-[#557d78]">
                  <span className="tv-tnum text-[11px] text-tv-text-faint">{when(d.at)}</span>
                  <span className="min-w-0 flex-1">{DONE_LABEL[d.action] ?? d.action}</span>
                  {d.operationId ? (
                    <Link href={`/operations/${d.operationId}`} className="text-[11px] font-bold text-[#185045] hover:underline">
                      {t("ops.openCase")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </TraveliunShell>
  );
}
