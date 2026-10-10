"use client";

import { ScopeTiles } from "../ScopeTiles";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * The old «/scope» route.
 *
 * The switches themselves moved onto the TRIP card — the country, the dates and
 * what the sale covers are one thought, and asking them on a screen of their
 * own was a gate to click through before any work started. This page stays so
 * the eleven stage URLs keep resolving, and renders the same component.
 */
export function ScopeStage({ data, patch }: StageFormProps) {
  const { t } = useTraveliunUI();

  return (
    <section className={sectionClass}>
      <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.scopeTitle")}</h2>
      <p className="mb-4 mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("pg.scopeStageHint")}</p>
      <ScopeTiles data={data} patch={patch} />
    </section>
  );
}
