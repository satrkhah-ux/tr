"use client";

import { findLookupCountry, libraryForCountry, type DraftServices } from "@/lib/offer/draft-types";
import { FieldIssue } from "../FieldIssue";
import { ListEditor } from "../services/ListEditor";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * «يشمل / لا يشمل» — what the sale covers and what it does not.
 *
 * Both lists mirror the company's approved wording, administered at
 * /offers/offer-includes and /offers/offer-not-includes: a new draft opens with
 * the ticked rows already in place, and «اختر من القائمة المعتمدة» adds any of
 * the rest. Free text stays available for the one-off line a particular offer
 * needs. Both offer only the global lines and the trip country's own, and
 * «يشمل» adds a third source: «خدمات الدولة», the country's services by name.
 *
 * «الشروط» used to sit underneath, full-width, and read as a footnote to the
 * services. It is its own card now (TermsStage) — but it is still the same
 * `data.services` slice, so the two must never be mounted together.
 */
export function ServicesStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const services = data.services;
  const countryId = findLookupCountry(lookups.countries, data.trip.country)?.id ?? null;
  const library = libraryForCountry(lookups.termLibrary, countryId);
  const countryServices = lookups.countryServices.filter((s) => s.country_id === countryId).map((s) => s.name);

  function update(slice: Partial<DraftServices>) {
    patch({ services: { ...services, ...slice } });
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.servicesTitle")}</h2>
      <FieldIssue field="services.includes" className="mb-3" />
      <div className="grid gap-4 md:grid-cols-2">
        <ListEditor
          titleKey="pg.includes"
          variant="includes"
          items={services.includes}
          library={library.includes}
          countryServices={countryServices}
          onChange={(next) => update({ includes: next })}
        />
        <ListEditor
          titleKey="pg.excludes"
          variant="excludes"
          items={services.excludes}
          library={library.excludes}
          onChange={(next) => update({ excludes: next })}
        />
      </div>
    </section>
  );
}
