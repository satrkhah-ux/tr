"use client";

import { useId } from "react";
import { Plus } from "lucide-react";
import type { DraftTransport } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

const rowLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/** Stage 6 — transport & transfers. Edits ONLY data.transport. */
export function TransportStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const carTypesListId = useId();
  const transfers = data.transport;

  function setTransfers(next: DraftTransport[]) {
    patch({ transport: next });
  }

  function updateRow(index: number, slice: Partial<DraftTransport>) {
    setTransfers(transfers.map((row, i) => (i === index ? { ...row, ...slice } : row)));
  }

  function addRow() {
    setTransfers([
      ...transfers,
      {
        from_place: "",
        to_place: "",
        car_type: lookups.carTypes[0] ?? "",
        date: null,
        note: "",
      },
    ]);
  }

  function removeRow(index: number) {
    setTransfers(transfers.filter((_, i) => i !== index));
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.transportTitle")}</h2>

      <datalist id={carTypesListId}>
        {lookups.carTypes.map((carType) => (
          <option key={carType} value={carType} />
        ))}
      </datalist>

      {transfers.length === 0 ? (
        <p className="mb-4 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.noTransportYet")}
        </p>
      ) : (
        <div className="mb-4 space-y-3">
          {transfers.map((transfer, index) => (
            <div
              key={index}
              className="space-y-3 rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3"
            >
              <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_150px_150px]">
                <label className={rowLabelClass}>
                  {t("pg.fromPlace")}
                  <input
                    value={transfer.from_place}
                    onChange={(e) => updateRow(index, { from_place: e.target.value })}
                    className={fieldClass}
                  />
                </label>
                <label className={rowLabelClass}>
                  {t("pg.toPlace")}
                  <input
                    value={transfer.to_place}
                    onChange={(e) => updateRow(index, { to_place: e.target.value })}
                    className={fieldClass}
                  />
                </label>
                <label className={rowLabelClass}>
                  {t("pg.carType")}
                  <input
                    list={carTypesListId}
                    value={transfer.car_type}
                    onChange={(e) => updateRow(index, { car_type: e.target.value })}
                    className={fieldClass}
                  />
                </label>
                <label className={rowLabelClass}>
                  {t("pg.transferDate")}
                  <input
                    type="date"
                    dir="ltr"
                    value={transfer.date ?? ""}
                    onChange={(e) => updateRow(index, { date: e.target.value === "" ? null : e.target.value })}
                    className={`${fieldClass} tv-tnum text-start`}
                  />
                </label>
              </div>
              <div className="grid items-end gap-3 md:grid-cols-[1fr_auto]">
                <label className={rowLabelClass}>
                  {t("pg.note")}
                  <input
                    value={transfer.note}
                    onChange={(e) => updateRow(index, { note: e.target.value })}
                    className={fieldClass}
                  />
                </label>
                <button type="button" onClick={() => removeRow(index)} className={removeButtonClass}>
                  {t("pg.removeRow")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={addRow} className={addButtonClass}>
        <Plus className="size-4" />
        {t("pg.addTransfer")}
      </button>
    </section>
  );
}
