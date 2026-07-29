"use client";

import { MoonStar } from "lucide-react";
import { nightsStatus } from "@/lib/offer/schedule";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «توزيع الليالي» — allocated city nights vs the trip's total.
 *
 * On the cities stage this sits directly UNDER the last city rather than in the
 * side rail: it is the running total of the numbers the agent is typing, and a
 * counter you have to look away from is a counter you stop checking. The rail
 * keeps it on the hotels stage, where nothing on screen is being counted.
 */
export function NightsIndicator({
  used,
  total,
  match,
}: {
  used: number;
  total: number;
  match: boolean;
}) {
  const { t } = useTraveliunUI();
  const ns = nightsStatus(used, total);

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border px-4 py-3 ${
        match ? "border-[#bfe5d4] bg-[#e9f7f0]" : "border-[#f2e2b4] bg-[#fff8e8]"
      }`}
    >
      <p className="flex items-center gap-2 text-[12px] font-extrabold text-[#185045]">
        <MoonStar className="size-4" />
        {t("pg.nightsIndicator")}
      </p>
      <p className="tv-tnum text-[13px] font-bold text-[#0f3d38]">
        {t("pg.nightsOf", { used, total })}
      </p>
      <p className={`text-[11.5px] font-bold ${match ? "text-[#0f7a52]" : "text-[#a86a10]"}`}>
        {match
          ? t("pg.nightsComplete")
          : ns.status === "excess"
            ? t("pg.nightsExcessN", { n: ns.diff })
            : t("pg.nightsRemainingN", { n: ns.diff })}
      </p>
    </div>
  );
}
