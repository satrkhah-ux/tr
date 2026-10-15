"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { DraftData, GeneratorLookups } from "@/lib/offer/draft-types";
import { cityPoints, implausibleOverlandHops, MAX_ROAD_KM } from "@/lib/offer/overland";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * A road hop nobody would drive (offer/overland.ts) — said beside the question
 * that chose it, in Basic's cities step and the generator's transport card.
 * Advice only: nothing is blocked and no price moves.
 */
export function OverlandHopNotice({
  data,
  countries,
  className = "",
}: {
  data: Pick<DraftData, "cities" | "transport_plan" | "flights" | "scope">;
  countries: GeneratorLookups["countries"];
  className?: string;
}) {
  const { t } = useTraveliunUI();
  const points = useMemo(() => cityPoints(countries), [countries]);
  const hops = implausibleOverlandHops(data, points);
  if (hops.length === 0) return null;
  return (
    <div role="note" className={`space-y-1 rounded-[10px] border border-[#f1dcae] bg-[#fff8e8] px-3 py-2 text-[12px] font-bold text-[#a86a10] ${className}`}>
      {hops.map((h) => {
        const params = { from: h.from, to: h.to, km: (h.km ?? 0).toLocaleString("en-US") };
        const far = h.km != null && h.km > MAX_ROAD_KM;
        const key = h.sea ? (far ? "pg.warn.overlandSeaFar" : "pg.warn.overlandSea") : "pg.warn.overlandFar";
        return (
          <p key={`${h.from}>${h.to}`} className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t(key, params)}
          </p>
        );
      })}
    </div>
  );
}
