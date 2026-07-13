"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Sparkles } from "lucide-react";
import { DirText } from "@/components/DirText";
import { copyProgramIntoDraft, findReusablePrograms, getDraft } from "@/lib/data/drafts";
import { deriveCityDates, type DraftCity, type ReusableProgram } from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

/**
 * Stage 3 — cities + nights. Check-in/check-out are DERIVED from the trip
 * arrival date and the nights chain (never hand-typed). Also hosts the
 * "start from a previous program" panel (same country + same day count,
 * exact traveler matches ranked first).
 */
export function CitiesStage({ draftId, data, patch, replace, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const [programs, setPrograms] = useState<ReusableProgram[] | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const country = lookups.countries.find((c) => c.name === data.trip.country);
  const cityOptions = country?.cities ?? [];

  // reuse eligibility is DERIVED (no synchronous setState); the async load only
  // runs when eligible, and stale results are ignored via the `active` flag.
  const reuseEligible = Boolean(data.trip.country && data.trip.days > 0);
  useEffect(() => {
    if (!reuseEligible) return;
    let active = true;
    findReusablePrograms(draftId).then((result) => {
      if (active) setPrograms(result);
    });
    return () => {
      active = false;
    };
  }, [draftId, reuseEligible]);

  function setCities(next: DraftCity[]) {
    // check-in chain starts at the itinerary start (outbound flight's local
    // landing date, or the trip arrival when no flight is set yet).
    patch({ cities: deriveCityDates(itineraryStartDate(data.trip, data.flights), next) });
  }

  function updateRow(index: number, slice: Partial<DraftCity>) {
    setCities(data.cities.map((c, i) => (i === index ? { ...c, ...slice } : c)));
  }

  function addRow() {
    setCities([...data.cities, { city_name: cityOptions[0]?.name ?? "", nights: 1, check_in: null, check_out: null }]);
  }

  function removeRow(index: number) {
    setCities(data.cities.filter((_, i) => i !== index));
  }

  async function copyProgram(serial: string) {
    setCopying(serial);
    const result = await copyProgramIntoDraft(draftId, serial);
    if (result.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) {
        replace(fresh.data);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    }
    setCopying(null);
  }

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.citiesTitle")}</h2>
          <p className="text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.datesAuto")}</p>
        </div>

        {data.cities.length === 0 ? (
          <p className="mb-4 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
            {t("pg.err.noCities")}
          </p>
        ) : (
          <div className="mb-4 space-y-3">
            {data.cities.map((city, index) => (
              <div
                key={index}
                className="grid items-end gap-3 rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 md:grid-cols-[1fr_110px_130px_130px_auto]"
              >
                <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                  {t("pg.city")}
                  <select
                    value={city.city_name}
                    onChange={(e) => updateRow(index, { city_name: e.target.value })}
                    className={fieldClass}
                  >
                    <option value="">{t("pg.chooseCity")}</option>
                    {cityOptions.map((option) => (
                      <option key={option.id} value={option.name}>{option.name}</option>
                    ))}
                    {city.city_name && !cityOptions.some((o) => o.name === city.city_name) ? (
                      <option value={city.city_name}>{city.city_name}</option>
                    ) : null}
                  </select>
                </label>
                <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                  {t("pg.cityNights")}
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={city.nights}
                    onChange={(e) => updateRow(index, { nights: Math.max(Number(e.target.value) || 0, 0) })}
                    className={`${fieldClass} tv-tnum text-center`}
                  />
                </label>
                <div className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                  {t("pg.checkIn")}
                  <p className="tv-tnum flex h-11 items-center rounded-[10px] bg-[#eef4f1] px-3 text-sm text-[#557d78]">
                    {city.check_in ? <DirText dir="ltr">{city.check_in}</DirText> : "—"}
                  </p>
                </div>
                <div className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                  {t("pg.checkOut")}
                  <p className="tv-tnum flex h-11 items-center rounded-[10px] bg-[#eef4f1] px-3 text-sm text-[#557d78]">
                    {city.check_out ? <DirText dir="ltr">{city.check_out}</DirText> : "—"}
                  </p>
                </div>
                <button type="button" onClick={() => removeRow(index)} className={removeButtonClass}>
                  {t("pg.removeRow")}
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={addRow} className={addButtonClass}>
          <Plus className="size-4" />
          {t("pg.addCity")}
        </button>
      </section>

      {/* reuse a previous program */}
      <section className={sectionClass}>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-[#185045]">
          <Sparkles className="size-4 text-[#2aa87a]" />
          {t("pg.reuseTitle")}
        </h3>
        <p className="mb-3 text-[12px] font-semibold text-[#93aaa3]">{t("pg.reuseHint")}</p>
        {copied ? (
          <p className="mb-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-2.5 text-[12.5px] font-bold text-[#0f7a52]">
            {t("pg.reuseCopied")}
          </p>
        ) : null}
        {!reuseEligible ? (
          <p className="text-[12.5px] text-[#93aaa3]">{t("pg.reuseNoMatches")}</p>
        ) : programs === null ? (
          <div className="tv-shimmer h-16 rounded-[10px]" />
        ) : programs.length === 0 ? (
          <p className="text-[12.5px] text-[#93aaa3]">{t("pg.reuseNoMatches")}</p>
        ) : (
          <ul className="space-y-2">
            {programs.map((program) => (
              <li
                key={program.serial}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-[#e2ebe7] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="tv-tnum text-[12.5px] font-extrabold text-[#185045]">
                    <DirText dir="ltr">{program.serial}</DirText>
                    {program.samePeople ? (
                      <span className="ms-2 rounded-full bg-[#e4f6ef] px-2 py-0.5 text-[10px] font-bold text-[#10966b]">
                        {t("pg.reuseMatchPeople")}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[#557d78]">
                    {program.cities.join(" · ") || program.destination || "—"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={copying !== null}
                  onClick={() => void copyProgram(program.serial)}
                  className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-60"
                >
                  {copying === program.serial ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                  {t("pg.reuseCopy")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
