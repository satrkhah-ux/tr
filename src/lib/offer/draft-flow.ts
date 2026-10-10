/**
 * The card flow's arithmetic — which card is open, and what a closed one says.
 *
 * Pure: no React, no Supabase. The active card is DERIVED from the draft rather
 * than stored anywhere, so a reload recomputes it and there is no second
 * pointer that can disagree with the data.
 */

import {
  MEAL_PLAN_AR,
  SCOPE_KEYS,
  totalCityNights,
  type DraftData,
  type StageKey,
  type StageMeta,
} from "./draft-types";
import type { StageStatus } from "./draft-validation";

/**
 * The first visible card that is not finished — where the agent picks up.
 *
 * Iterates the VISIBLE stages, never the whole registry: a role without
 * pricing.view would otherwise resume onto a card that renders nothing.
 */
export function resumeStage(visible: StageMeta[], statuses: Record<StageKey, StageStatus>): StageKey {
  const unfinished = visible.find((s) => statuses[s.key] !== "complete");
  if (unfinished) return unfinished.key;
  // Everything done: the last card is the one worth looking at.
  return visible[visible.length - 1]?.key ?? "customer";
}

/**
 * What a CLOSED card says about itself — one to three short chips.
 *
 * A card reading «العميل ✓» is a stepper row wearing a card's clothes. The
 * point of folding a finished card is that the answer stays visible, so the
 * agent can check it without opening anything.
 */
export function stageSummary(stage: StageKey, data: DraftData): string[] {
  switch (stage) {
    case "scope": {
      const on = SCOPE_KEYS.filter((k) => data.scope[k]).length + (data.transport_plan.tours.enabled ? 1 : 0);
      return [`${on} خدمة`];
    }
    case "customer": {
      const who = data.customer.company.trim() || data.customer.customer_name.trim();
      const people = [
        data.trip.adults > 0 ? `${data.trip.adults} كبار` : "",
        data.trip.children > 0 ? `${data.trip.children} أطفال` : "",
        data.trip.infants > 0 ? `${data.trip.infants} رضع` : "",
      ].filter(Boolean);
      return [
        who,
        people.join(" · "),
        data.trip.rooms > 0 ? `${data.trip.rooms} غرف` : "",
        data.trip.meal_plan ? MEAL_PLAN_AR[data.trip.meal_plan] : "",
      ].filter(Boolean);
    }
    case "trip":
      return [
        data.trip.destination.trim() || data.trip.country.trim(),
        data.trip.arrival_date ?? "",
        data.trip.nights > 0 ? `${data.trip.nights} ليالٍ / ${data.trip.days} أيام` : "",
      ].filter(Boolean);
    case "cities":
    case "hotels": {
      if (data.cities.length === 0) return [];
      const named = data.cities.map((c) => c.city_name.trim()).filter(Boolean);
      const used = totalCityNights(data.cities);
      return [named.join(" · "), `${used}/${data.trip.nights} ليالٍ`].filter(Boolean);
    }
    case "flights":
      return data.flights.length > 0 ? [`${data.flights.length} رحلة`] : [];
    case "services": {
      const parts = [
        data.services.includes.length > 0 ? `${data.services.includes.length} يشمل` : "",
        data.services.excludes.length > 0 ? `${data.services.excludes.length} لا يشمل` : "",
      ].filter(Boolean);
      return parts;
    }
    case "terms":
      return data.services.terms.length > 0 ? [`${data.services.terms.length} شرط`] : [];
    case "visas":
      return data.visas.length > 0 ? [`${data.visas.length} تأشيرة`] : [];
    case "itinerary": {
      const written = data.days.filter((d) => d.title.trim()).length;
      return data.days.length > 0 ? [`${written}/${data.days.length} يوم`] : [];
    }
    case "pricing":
      return data.pricing.items.length > 0 ? [`${data.pricing.items.length} بند`] : [];
    case "preview":
      return data.produced_serial ? [data.produced_serial] : [];
  }
}
