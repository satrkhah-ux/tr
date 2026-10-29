"use client";

import { useEffect, useState } from "react";
import { createRow, getFilterOptions } from "@/lib/data/actions";
import { recordReferenceAddition } from "@/lib/data/catalog-additions";
import { resolveTableConfig } from "@/lib/data/table-config";
import type { DataRow, FilterOptions } from "@/lib/data/types";
import { RecordForm } from "./TraveliunTable";
import { useTraveliunUI } from "./TraveliunUIProvider";

/** Same catalogue form and permission checks everywhere an agent adds a missing reference. */
export function CatalogAddDialog({ table, countryId, onClose, onCreated }: {
  table: "cities" | "countries";
  countryId?: string;
  onClose: () => void;
  onCreated: (row: DataRow, countries: DataRow[]) => void;
}) {
  const { t } = useTraveliunUI();
  const [options, setOptions] = useState<FilterOptions | null>(null);
  useEffect(() => { let alive = true; void getFilterOptions().then(o => { if (alive) setOptions(o); }); return () => { alive = false; }; }, []);
  const config = resolveTableConfig(`/${table}`)!;
  if (!options) return <div role="dialog" aria-label={t("data.form.otherAdd")} className="fixed inset-0 z-[150] grid place-items-center bg-black/25"><div className="rounded-2xl bg-white p-6"><p>{t("team.tg.loading")}</p><button type="button" onClick={onClose} className="mt-4 underline">{t("cancel")}</button></div></div>;
  return <RecordForm title={t("data.form.otherAdd")} config={config} filterOptions={options} initial={{ country_id: countryId ?? null }} onClose={onClose} onSubmit={async values => {
    const result = await createRow(table, values);
    if (!result.ok) return t(result.error);
    // the data team reviews what an employee added (catalog-additions.ts); never waited on
    void recordReferenceAddition(table, result.row).catch(() => undefined);
    const refreshed = await getFilterOptions();
    onCreated(result.row, refreshed.countries.map(country => ({ id: country.value, arabic_name: country.label, default_currency: country.currency ?? null })));
    return null;
  }} />;
}
