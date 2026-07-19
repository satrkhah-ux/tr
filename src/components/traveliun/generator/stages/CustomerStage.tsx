"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search, Tag, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import { searchCustomersFromTeletel, type TeletelCustomerHit } from "@/lib/data/teletel-actions";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass, type StageFormProps } from "../stage-props";

/**
 * Stage 1 — customer / company.
 * Primary path: pick the customer from Teletel (search by name/phone) — one tap
 * fills name+phone, and label-derived destinations («رحلة جورجيا») become chips
 * that fill the trip destination. Manual fields stay as the fallback.
 */
export function CustomerStage({ data, patch }: StageFormProps) {
  const { t } = useTraveliunUI();
  const customer = data.customer;

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TeletelCustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [open, setOpen] = useState(false);
  const [destinations, setDestinations] = useState<string[]>([]);
  const seqRef = useRef(0);

  function update(patchSlice: Partial<typeof customer>) {
    patch({ customer: { ...customer, ...patchSlice } });
  }

  // debounced Teletel search (350ms); stale responses dropped via seq counter.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const id = window.setTimeout(async () => {
      const res = await searchCustomersFromTeletel(q);
      if (seqRef.current !== seq) return;
      setSearching(false);
      if (!res.ok) return;
      setConfigured(res.configured);
      setHits(res.hits);
      setOpen(true);
    }, 350);
    return () => window.clearTimeout(id);
  }, [query]);

  function pick(hit: TeletelCustomerHit) {
    update({ customer_name: hit.name, customer_phone: hit.phone });
    setDestinations(hit.destinations);
    setQuery("");
    setHits([]);
    setOpen(false);
  }

  function applyDestination(name: string) {
    patch({ trip: { ...data.trip, country: name, destination: name } });
    setDestinations((prev) => prev.filter((d) => d !== name));
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.customerTitle")}</h2>

      {/* Teletel lookup */}
      <div className="relative mb-4">
        <span className="mb-1.5 block text-[12px] font-bold text-[#557d78]">{t("tl.search")}</span>
        <div className="relative">
          {searching ? (
            <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#8aa29b]" />
          ) : (
            <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => hits.length > 0 && setOpen(true)}
            placeholder={t("tl.searchPlaceholder")}
            className={`${fieldClass} pe-10`}
          />
        </div>
        {!configured ? (
          <p className="mt-1.5 text-[11.5px] font-semibold text-[#a86a10]">{t("tl.notConfigured")}</p>
        ) : null}
        {open && configured && query.trim().length >= 2 ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[11px] border border-[#e2ebe7] bg-white shadow-lg dark:border-[#294039] dark:bg-[#0f1f1b]">
            {hits.length === 0 && !searching ? (
              <p className="px-4 py-3 text-[12.5px] font-semibold text-[#93aaa3]">{t("tl.noResults")}</p>
            ) : (
              hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => pick(hit)}
                  className="flex w-full items-center gap-3 border-b border-[#f1f5f3] px-4 py-2.5 text-start last:border-b-0 hover:bg-[#f4f8f6] dark:border-[#1c302a] dark:hover:bg-[#12352c]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef4f1] text-[#185045] dark:bg-[#12352c] dark:text-[#7fd0b2]">
                    <UserRound className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-extrabold text-[#0f3d38] dark:text-[#eaf3ef]">
                      {hit.name || t("tl.unnamed")}
                    </span>
                    <span className="block truncate text-[12px] font-semibold text-[#8aa29b]">
                      <DirText dir="ltr">{hit.phone || hit.email}</DirText>
                    </span>
                  </span>
                  {hit.labels.length > 0 ? (
                    <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                      {hit.labels.slice(0, 2).map((label) => (
                        <span key={label} className="inline-flex items-center gap-1 rounded-full bg-[#fff4dd] px-2 py-0.5 text-[10.5px] font-bold text-[#8a5a0c]">
                          <Tag className="size-3" /> {label}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* destination suggestions pulled from the picked contact */}
      {destinations.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[11px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2.5">
          <span className="text-[12px] font-bold text-[#0f7a52]">{t("tl.destFromLabels")}</span>
          {destinations.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyDestination(name)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0f7a52] px-3 text-[12px] font-bold text-white hover:bg-[#0c6543]"
            >
              <MapPin className="size-3.5" /> {t("tl.addDestination", { name })}
            </button>
          ))}
        </div>
      ) : null}

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
