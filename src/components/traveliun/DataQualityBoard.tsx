"use client";

import Link from "next/link";
import { CheckCircle2, Wrench } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { QUALITY_ISSUES, issueHref, type IssueGroup } from "@/lib/data/quality";
import type { QualityCard, QualityReport } from "@/lib/data/quality-actions";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

const GROUPS: { key: IssueGroup; labelKey: TranslationKey }[] = [
  { key: "hotels", labelKey: "data.quality.group.hotels" },
  { key: "cities", labelKey: "data.quality.group.cities" },
  { key: "catalog", labelKey: "data.quality.group.catalog" },
  { key: "transport", labelKey: "data.quality.group.transport" },
];

/**
 * /data-quality (data section order 3): what the reference data lacks, each
 * number counted by the database and each card opening the table on exactly
 * those rows. Hotel cards name the five most-used offenders — a client is
 * likeliest to see those.
 */
export function DataQualityBoard({ report }: { report: QualityReport }) {
  const { t } = useTraveliunUI();
  const cards = new Map<string, QualityCard>(report.ok ? report.cards.map((c) => [c.key, c]) : []);

  return (
    <TraveliunShell title="data.quality.title">
      <div className="tv-fade-up space-y-4">
        <p className="text-[12.5px] font-semibold text-[#6d8a84]">{t("data.quality.subtitle")}</p>
        {!report.ok ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
            {t(report.error)}
          </p>
        ) : (
          GROUPS.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 text-[13px] font-extrabold text-[#003c3a]">{t(group.labelKey)}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {QUALITY_ISSUES.filter((issue) => issue.group === group.key).map((issue) => {
                  const card = cards.get(issue.key);
                  const total = card?.total ?? null;
                  return (
                    <article key={issue.key} className="flex flex-col rounded-[14px] border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
                      <p className="text-[12.5px] font-bold text-[#557d78]">{t(issue.labelKey)}</p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <DirText dir="ltr" className={`tv-tnum text-[26px] font-extrabold ${total ? "text-[#c2410c]" : "text-[#0f7a52]"}`}>
                          {total ?? "—"}
                        </DirText>
                        {total === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-bold text-[#0f7a52]">
                            <CheckCircle2 className="size-3.5" />
                            {t("data.quality.clear")}
                          </span>
                        ) : null}
                      </div>
                      {total && card?.used != null ? (
                        <p className="text-[11.5px] font-semibold text-[#a86a10]">{t("data.quality.used", { n: card.used })}</p>
                      ) : null}
                      {card && card.top.length > 0 ? (
                        <div className="mt-2 border-t border-dashed border-[#e2ebe7] pt-2">
                          <p className="mb-1 text-[11px] font-bold text-[#93aaa3]">{t("data.quality.top")}</p>
                          <ul className="space-y-1 text-[12px]">
                            {card.top.map((hotel) => (
                              <li key={hotel.id} className="flex items-center gap-2">
                                <Link href={`/hotels?id=${hotel.id}`} className="min-w-0 truncate font-semibold text-[#185045] hover:underline">
                                  <DirText dir="auto">{hotel.name}</DirText>
                                </Link>
                                <span className="ms-auto shrink-0 text-[11px] font-semibold text-[#93aaa3]">{t("data.quality.uses", { n: hotel.uses })}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {total ? (
                        <Link
                          href={issueHref(issue)}
                          className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
                        >
                          <Wrench className="size-3.5" />
                          {t("data.quality.fix")}
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </TraveliunShell>
  );
}
