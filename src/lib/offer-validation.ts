/**
 * Smart pre-send checks for an offer. Pure functions — they SUGGEST, never edit.
 * Each rule returns one actionable note as an i18n KEY (+ params), so the
 * Intelligence Hub can render it in the active language. Consumed only by the UI.
 */

import type { TranslationKey, Translator } from "@/lib/i18n";

export type CheckLevel = "ok" | "warn" | "error";
export type OfferCheck = {
  level: CheckLevel;
  key: TranslationKey;
  /** interpolated into the message; `cities` holds raw (data) city names. */
  params?: Record<string, string | number>;
  /** field keys translated + joined into the `{fields}` placeholder at render. */
  fieldKeys?: TranslationKey[];
};

export type ValidatableCity = {
  city_name: string;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
  hotel_name: string | null;
};

export type ValidatableOffer = {
  destination: string | null;
  offer_date: string | null;
  total: number | null;
  currency: string | null;
  adults: number;
  cities: ValidatableCity[];
  includes: string[];
  terms: string[];
};

const ARABIC = /[؀-ۿ]/;

function daysBetween(from: string, to: string): number | null {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Number.isFinite(diff) ? diff : null;
}

export function validateOffer(offer: ValidatableOffer): OfferCheck[] {
  const checks: OfferCheck[] = [];

  // 1) Nights match the hotel check-in/check-out dates.
  const nightMismatches: string[] = [];
  for (const city of offer.cities) {
    if (city.check_in && city.check_out && city.nights != null) {
      const span = daysBetween(city.check_in, city.check_out);
      if (span != null && span !== city.nights) nightMismatches.push(city.city_name);
    }
  }
  checks.push(
    nightMismatches.length === 0
      ? { level: "ok", key: "check.nightsOk" }
      : { level: "error", key: "check.nightsMismatch", params: { cities: nightMismatches.join(", ") } },
  );

  // 2) Continuous itinerary — each city starts where the previous ended.
  const gaps: string[] = [];
  for (let i = 1; i < offer.cities.length; i += 1) {
    const prev = offer.cities[i - 1];
    const current = offer.cities[i];
    if (prev.check_out && current.check_in && prev.check_out !== current.check_in) {
      gaps.push(current.city_name);
    }
  }
  if (offer.cities.length > 1) {
    checks.push(
      gaps.length === 0
        ? { level: "ok", key: "check.sequenceOk" }
        : { level: "warn", key: "check.sequenceGap", params: { cities: gaps.join(", ") } },
    );
  }

  // 3) Completeness of the essential fields.
  const missing: TranslationKey[] = [];
  if (!offer.destination?.trim()) missing.push("field.destination");
  if (offer.cities.length === 0) missing.push("field.cities");
  if (offer.total == null || offer.total <= 0) missing.push("field.total");
  if (!offer.currency?.trim()) missing.push("field.currency");
  if (offer.includes.length === 0) missing.push("field.includes");
  checks.push(
    missing.length === 0
      ? { level: "ok", key: "check.completeOk" }
      : { level: "error", key: "check.missingFields", fieldKeys: missing },
  );

  // 4) Offer date consistency with the first hotel check-in.
  const firstCheckIn = offer.cities.find((c) => c.check_in)?.check_in ?? null;
  if (offer.offer_date && firstCheckIn) {
    const gap = daysBetween(offer.offer_date, firstCheckIn);
    checks.push(
      gap != null && gap >= 0
        ? { level: "ok", key: "check.dateOk" }
        : { level: "warn", key: "check.dateBefore" },
    );
  } else if (!offer.offer_date) {
    checks.push({ level: "warn", key: "check.noStartDate" });
  }

  // 5) Arabic text quality of the client-facing destination.
  const dest = offer.destination?.trim() ?? "";
  checks.push(
    dest && ARABIC.test(dest)
      ? { level: "ok", key: "check.arabicOk" }
      : { level: "warn", key: "check.arabicMissing" },
  );

  // 6) At least one adult traveller.
  if (offer.adults <= 0) {
    checks.push({ level: "error", key: "check.noAdults" });
  }

  return checks;
}

/** Render a check to a localized string using the active-language translator. */
export function checkText(t: Translator, check: OfferCheck): string {
  const params: Record<string, string | number> = { ...check.params };
  if (check.fieldKeys && check.fieldKeys.length > 0) {
    params.fields = check.fieldKeys.map((key) => t(key)).join(t("listSep"));
  }
  return t(check.key, params);
}

export function checkSummary(checks: OfferCheck[]): { errors: number; warnings: number; passed: boolean } {
  const errors = checks.filter((c) => c.level === "error").length;
  const warnings = checks.filter((c) => c.level === "warn").length;
  return { errors, warnings, passed: errors === 0 };
}
