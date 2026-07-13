"use client";

import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass, type StageFormProps } from "../stage-props";

/** Stage 1 — customer / company. Edits ONLY data.customer. */
export function CustomerStage({ data, patch }: StageFormProps) {
  const { t } = useTraveliunUI();
  const customer = data.customer;

  function update(patchSlice: Partial<typeof customer>) {
    patch({ customer: { ...customer, ...patchSlice } });
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.customerTitle")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          {t("pg.customerName")}
          <input
            value={customer.customer_name}
            onChange={(e) => update({ customer_name: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          {t("pg.customerPhone")}
          <input
            dir="ltr"
            inputMode="tel"
            value={customer.customer_phone}
            onChange={(e) => update({ customer_phone: e.target.value })}
            className={`${fieldClass} tv-tnum text-start`}
            placeholder="05xxxxxxxx"
          />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          {t("pg.company")}
          <input
            value={customer.company}
            onChange={(e) => update({ company: e.target.value })}
            className={fieldClass}
          />
        </label>
      </div>
    </section>
  );
}
