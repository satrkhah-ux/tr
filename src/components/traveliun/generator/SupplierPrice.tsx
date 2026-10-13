"use client";

import { currencyOptions, type GeneratorLookups, type LookupCountry } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fieldClass } from "./stage-props";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";

/**
 * One price and who it was booked through — the pair every bought thing on a
 * file carries (a flight booking, a hotel room). The supplier list is the
 * agency's own (company_suppliers), narrowed to those who sell this kind of
 * thing; the client never sees which one it was.
 */

export type SupplierCategory = "طيران" | "فنادق";

export function suppliersFor(lookups: Pick<GeneratorLookups, "companySuppliers">, category: SupplierCategory) {
  const all = lookups.companySuppliers ?? [];
  const matching = all.filter((s) => s.categories.includes(category));
  // a list whose categories were never filled in still offers everyone
  return matching.length > 0 ? matching : all;
}

export function SupplierPrice({
  label,
  price,
  currency,
  supplier,
  category,
  lookups,
  countries,
  onChange,
}: {
  label: string;
  price: number | null;
  currency: string;
  supplier: string;
  category: SupplierCategory;
  lookups: Pick<GeneratorLookups, "companySuppliers">;
  countries: Pick<LookupCountry, "default_currency">[];
  onChange: (slice: { price?: number | null; currency?: string; supplier?: string }) => void;
}) {
  const { t } = useTraveliunUI();
  const partner = usePartnerBrand();
  const options = suppliersFor(lookups, category);
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)]">
      <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
        {label}
        <input
          type="number"
          min={0}
          dir="ltr"
          value={price ?? ""}
          onChange={(e) => onChange({ price: e.target.value === "" ? null : Number(e.target.value) })}
          className={`${fieldClass} tv-tnum text-center`}
          placeholder="0"
        />
      </label>
      <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
        {t("pg.currencyCol")}
        <select value={currency} onChange={(e) => onChange({ currency: e.target.value })} className={fieldClass}>
          {currencyOptions(countries, currency).map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </label>
      {/* our suppliers are not a partner's to see or pick */}
      {partner ? null : (
      <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
        {t("pg.supplierLabel")}
        <select value={supplier} onChange={(e) => onChange({ supplier: e.target.value })} className={fieldClass}>
          <option value="">{t("pg.chooseSupplier")}</option>
          {options.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
          {supplier && !options.some((s) => s.name === supplier) ? <option value={supplier}>{supplier}</option> : null}
        </select>
      </label>
      )}
    </div>
  );
}
