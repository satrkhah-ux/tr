/**
 * Ready-made seasonal offers («العروض الجاهزة») — the company-prepared packages
 * marketing publishes in a Google Sheet and sales must quote verbatim.
 *
 * Pure module: no React, no Supabase, no `node:*` — importable from the client,
 * the server actions and the tests alike (mirrors lib/offer/draft-types.ts).
 */

import { AGE_BANDS, emptyDraftData, normalizeDraftHotel, resizeAges, type DraftData } from "@/lib/offer/draft-types";

export const TIERS = ["economy", "premium"] as const;
export type Tier = (typeof TIERS)[number];

/** `ready` = has a final price and can seed a draft; `coming_soon` = announced, unpriced. */
export type ReadyOfferStatus = "ready" | "coming_soon";

export type ParsedCity = { city_name: string; nights: number };

export type ParsedOffer = {
  /** stable sync key — survives row reordering (the sheet's own `#` column repeats). */
  code: string;
  /** the old sheet's tab; the owner's sheet of 2026-10-18 has none. */
  tier: Tier | null;
  title: string;
  /** destination country, stripped of any variant label. */
  country: string;
  /** «الباقة المتوسطة» / «عرض مميز (جزيرة)» when the destination cell carries one. */
  variant: string | null;
  cities_summary: string;
  main_hotels: string;
  tours_text: string;
  domestic_flight: string;
  days: number | null;
  nights: number | null;
  price: number | null;
  currency: string;
  includes: string[];
  excludes: string[];
  includes_text: string;
  excludes_text: string;
  validity_raw: string;
  valid_from: string | null;
  valid_to: string | null;
  design_url: string | null;
  status: ReadyOfferStatus;
  /**
   * Night-by-night city split — null when the cell carries no per-city nights
   * (or they don't add up to the trip nights). Null means DO NOT seed cities:
   * `sum(city nights) === trip nights` is a blocking rule in validateDraft.
   */
  cities: ParsedCity[] | null;
  /** main_hotels split per city, aligned to `cities`; empty when cities is null. */
  hotels_by_city: string[];
  /** non-fatal parse notes, surfaced in the sync preview. */
  warnings: string[];
  /**
   * Where the sheet contradicts itself — imported, shown red with these reasons,
   * and starts no file until the sheet is corrected (the owner, 2026-10-18).
   */
  problems: string[];
  /** «ملاحظات = لم يتم النشر» → false: imported, never offered to sales. */
  published: boolean;
  /** «أساس التسعير» as written, and the party it prices (null when it does not say). */
  price_basis: string;
  adults: number | null;
  children: number | null;
  notes: string;
  source_row: Record<string, string>;
};

/** One row as stored in `public.ready_offers`. */
export type ReadyOfferRecord = {
  id: string;
  code: string | null;
  tier: Tier | null;
  title: string;
  country: string | null;
  variant: string | null;
  cities_summary: string | null;
  main_hotels: string | null;
  tours_text: string | null;
  domestic_flight: string | null;
  days: number | null;
  nights: number | null;
  price: number | null;
  currency: string | null;
  includes_text: string | null;
  excludes_text: string | null;
  validity_raw: string | null;
  valid_from: string | null;
  valid_to: string | null;
  design_url: string | null;
  status: ReadyOfferStatus | null;
  active: boolean;
  seed: Partial<DraftData> | null;
  synced_at: string | null;
  published?: boolean | null;
  problems?: string[] | null;
  price_basis?: string | null;
  adults?: number | null;
  children?: number | null;
  notes?: string | null;
};

/** A ready offer a file may start from: live, priced, published, and not contradicting itself. */
export function canStartFrom(row: Pick<ReadyOfferRecord, "active" | "status" | "published" | "problems">): boolean {
  return row.active && row.status !== "coming_soon" && row.published !== false && !row.problems?.length;
}

export type SyncChange = {
  code: string;
  title: string;
  /** field names that differ from the stored row. */
  fields: string[];
};

export type SyncDiff = {
  added: ParsedOffer[];
  changed: { offer: ParsedOffer; fields: string[] }[];
  /** stored rows no longer present in the sheet — deactivated, never deleted. */
  deactivated: { code: string; title: string }[];
  unchanged: number;
  /** rows that could not be parsed at all (skipped). */
  errors: { row: number; tab: string; reason: string }[];
  /** parse notes on rows that WERE imported (e.g. city nights didn't add up). */
  warnings: { code: string; title: string; notes: string[] }[];
  /** offers imported «بها خطأ» — the sheet contradicts itself. */
  problems: { code: string; title: string; reasons: string[] }[];
};

/**
 * Management's standing rules, printed as numbered clauses in section 10 of the
 * client document. Seeded into `services.terms` so they travel with the offer.
 */
export const READY_OFFER_TERMS = {
  installments:
    "جميع الأسعار المعلنة تشمل رسوم التقسيط عبر تابي وتمارا، ولا تُضاف أي رسوم إضافية على السعر المعلن.",
  optionalServices:
    "يمكن إضافة خدمات اختيارية (جولات، ترقية فنادق، أنشطة) وتُحتسب كتكلفة إضافية مستقلة بعد موافقة العميل.",
  refundGeneral:
    "سياسات الاسترجاع تختلف حسب مكونات البرنامج؛ الفنادق والخدمات تخضع لسياسات الموردين.",
  refundDomesticFlight:
    "الطيران الداخلي غير قابل للاسترجاع بعد الإصدار.",
} as const;

/** True when the domestic-flight cell describes an actual flight (not «لا يوجد»). */
export function hasDomesticFlight(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return !/لا\s*يوجد|لايوجد|^لا(?:\s|$|[–—-])|^[❌✖—-]+$/u.test(t);
}

/**
 * Build the draft seed for a ready offer.
 *
 * Deliberately NOT seeded — each would break a downstream contract:
 *   • `customer` / `trip.arrival_date` — dates drive deriveCityDates and are the
 *     salesperson's input; arrival_date is a blocking field anyway.
 *   • `days[]` — derived by draftDaySkeleton from trip + cities.
 *   • `hotels[].sourcing` — supplier rates expire and produceOfferFromDraft
 *     hard-blocks on a stale `valid_until`. Hotels seed as name-only shells,
 *     exactly like copyProgramIntoDraft does for reused programs.
 *
 * The party: the sheet's «أساس التسعير» when it says («لشخصين وطفلين»), else
 * the system default (2 adults).
 */
export function buildSeed(offer: ParsedOffer, readyOfferId: string): Partial<DraftData> {
  const cities = offer.cities ?? [];
  const terms: string[] = [READY_OFFER_TERMS.installments, READY_OFFER_TERMS.optionalServices];
  if (hasDomesticFlight(offer.domestic_flight)) terms.push(READY_OFFER_TERMS.refundDomesticFlight);
  terms.push(READY_OFFER_TERMS.refundGeneral);

  return {
    // spread the system defaults so a field added to DraftTrip later (room
    // defaults, traveler ages) is inherited rather than silently missing here.
    trip: {
      ...emptyDraftData().trip,
      country: offer.country,
      destination: offer.cities_summary || offer.country,
      days: offer.days ?? 0,
      nights: offer.nights ?? 0,
      ...(offer.adults ? { adults: offer.adults } : {}),
      ...(offer.children != null
        ? { children: offer.children, children_ages: resizeAges([], offer.children, AGE_BANDS.children.fallback) }
        : {}),
    },
    cities: cities.map((c) => ({ city_name: c.city_name, nights: c.nights, check_in: null, check_out: null })),
    hotels: cities.map((c, i) =>
      normalizeDraftHotel({
        city_name: c.city_name,
        hotel_name: offer.hotels_by_city[i] ?? offer.main_hotels,
      }),
    ),
    services: { includes: offer.includes, excludes: offer.excludes, terms },
    pricing: { items: [], display_currency: offer.currency, final_total: offer.price },
    source: {
      ready_offer_id: readyOfferId,
      code: offer.code,
      tier: offer.tier ?? "",
      title: offer.title,
      valid_from: offer.valid_from,
      valid_to: offer.valid_to,
    },
  };
}
