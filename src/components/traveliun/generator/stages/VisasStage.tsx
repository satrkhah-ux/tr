"use client";

import { Plus } from "lucide-react";
import type { DraftVisa } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

/** Stage 8 — visas. Edits ONLY data.visas. */
export function VisasStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const visas = data.visas;

  function setVisas(next: DraftVisa[]) {
    patch({ visas: next });
  }

  function updateRow(index: number, slice: Partial<DraftVisa>) {
    setVisas(visas.map((visa, i) => (i === index ? { ...visa, ...slice } : visa)));
  }

  function addRow() {
    setVisas([
      ...visas,
      {
        country: data.trip.country ?? "",
        visa_type: "",
        count: Math.max(data.trip.adults + data.trip.children, 1),
        note: "",
      },
    ]);
  }

  function removeRow(index: number) {
    setVisas(visas.filter((_, i) => i !== index));
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.visasTitle")}</h2>

      <datalist id="pg-visa-countries">
        {lookups.countries.map((country) => (
          <option key={country.id} value={country.name} />
        ))}
      </datalist>

      {visas.length === 0 ? (
        <p className="mb-4 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.noVisasYet")}
        </p>
      ) : (
        <div className="mb-4 space-y-3">
          {visas.map((visa, index) => (
            <div
              key={index}
              className="grid items-end gap-3 rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 md:grid-cols-[1fr_1fr_110px_1fr_auto]"
            >
              <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                {t("pg.visaCountry")}
                <input
                  list="pg-visa-countries"
                  value={visa.country}
                  onChange={(e) => updateRow(index, { country: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                {t("pg.visaType")}
                <input
                  value={visa.visa_type}
                  onChange={(e) => updateRow(index, { visa_type: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                {t("pg.visaCount")}
                <input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={visa.count}
                  onChange={(e) => updateRow(index, { count: Math.max(Number(e.target.value) || 1, 1) })}
                  className={`${fieldClass} tv-tnum text-center`}
                />
              </label>
              <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                {t("pg.note")}
                <input
                  value={visa.note}
                  onChange={(e) => updateRow(index, { note: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <button type="button" onClick={() => removeRow(index)} className={removeButtonClass}>
                {t("pg.removeRow")}
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={addRow} className={addButtonClass}>
        <Plus className="size-4" />
        {t("pg.addVisa")}
      </button>
    </section>
  );
}
