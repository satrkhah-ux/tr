"use client";

import { findLookupCountry, libraryForCountry, type DraftServices } from "@/lib/offer/draft-types";
import { ListEditor } from "../services/ListEditor";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * «الشروط» — its own card.
 *
 * These lines decide what happens when a trip goes wrong: cancellation, the
 * payment schedule, what the client carries themselves. Under the services
 * they read as a footnote to a list of inclusions and got skimmed; asked on
 * their own they get read.
 *
 * It writes the SAME top-level slice as ServicesStage (`data.services`), which
 * is safe only because the two are never mounted at the same time — the shell
 * merges pending patches by top-level key, so a live pair would have the last
 * one win on the whole object.
 */
export function TermsStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const services = data.services;
  const countryId = findLookupCountry(lookups.countries, data.trip.country)?.id ?? null;

  function update(slice: Partial<DraftServices>) {
    patch({ services: { ...services, ...slice } });
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-1 text-base font-extrabold text-[#003c3a]">{t("pg.terms")}</h2>
      <p className="mb-4 text-[12.5px] font-semibold text-tv-text-faint">{t("pg.termsHint")}</p>
      <ListEditor
        titleKey="pg.terms"
        variant="terms"
        items={services.terms}
        library={libraryForCountry(lookups.termLibrary, countryId).terms}
        onChange={(next) => update({ terms: next })}
      />
    </section>
  );
}
