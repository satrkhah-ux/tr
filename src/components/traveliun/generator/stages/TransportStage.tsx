"use client";

import { FieldIssue } from "../FieldIssue";
import { TransportBlock } from "../TransportBlock";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * «التنقلات» — its own card now, after the cities.
 *
 * It lived on the trip card, asked before anyone knew how many cities the
 * group would sleep in or whether the hop between them is flown. Asked here,
 * the intercity question already knows both.
 */
export function TransportStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  return (
    <section className={sectionClass}>
      <h2 className="mb-3 text-base font-extrabold text-[#003c3a]">{t("pg.stage.transport")}</h2>
      <FieldIssue field="transport" className="mb-3" />
      <TransportBlock
        plan={data.transport_plan}
        carTypes={lookups.carTypes}
        cities={data.cities.map((c) => c.city_name)}
        onChange={(transport_plan) => patch({ transport_plan })}
      />
    </section>
  );
}
