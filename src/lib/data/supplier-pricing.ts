"use server";

import { getServerUser } from "@/lib/supabase/server";
import { getHotelProvider } from "@/lib/providers/hotel";
import { getRates } from "./rates-actions";
import { getActiveMarkupRules } from "./markup-rules";
import { getDraft, saveDraftStages } from "./drafts";
import {
  deriveCityDates,
  type DraftHotel,
  type DraftHotelSourcing,
  type DraftPricingItem,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { groupComparable, normalizeRate, type NormalizedRate } from "@/lib/pricing/normalize";
import { priceSupplierRate } from "@/lib/pricing/price-line";
import type { MarkupContext } from "@/lib/pricing/markup";
import type { TranslationKey } from "@/lib/i18n";

const BASE = "SAR";

export type PriceFromSupplierResult =
  | { ok: true; priced: number; blocked: number }
  | { ok: false; error: TranslationKey };

/**
 * Price every hotel line in a draft from the LIVE supplier: fetch net rates,
 * normalize + group the comparable ones, pick the top of the chosen group,
 * apply the matching markup rule, and enforce the supplier floor + min margin.
 * The client-safe result (sell/cancellation/excluded surcharges) and the
 * internal cost basis (net/fx/rate_key/markup/floor) are stamped onto the draft
 * hotel; a matching hotel pricing item keeps the offer rollup in sync.
 */
export async function priceDraftHotelsFromSupplier(draftId: string): Promise<PriceFromSupplierResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await getDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };
    const data = record.data;
    if (data.hotels.length === 0) return { ok: false, error: "pg.hotelsNeedCities" };

    const [{ sarPer }, rules] = await Promise.all([getRates(), getActiveMarkupRules()]);
    const provider = getHotelProvider();
    const fxDate = new Date().toISOString().slice(0, 10);

    const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
    const cityByName = new Map(cities.map((c) => [c.city_name, c]));

    let priced = 0;
    let blocked = 0;
    const hotels: DraftHotel[] = [];
    const pricingItems: DraftPricingItem[] = [...data.pricing.items];

    for (const h of data.hotels) {
      const city = cityByName.get(h.city_name);
      const check_in = city?.check_in ?? data.trip.arrival_date;
      const check_out = city?.check_out ?? data.trip.departure_date;
      if (!h.hotel_name || !check_in || !check_out) {
        hotels.push({ ...h, sourcing: null });
        continue;
      }

      const rawRates = await provider.searchHotelRates({
        hotel_id: h.hotel_id || `custom-${h.city_name}-${h.hotel_name}`,
        hotel_name: h.hotel_name,
        check_in,
        check_out,
        adults: data.trip.adults,
        children: data.trip.children,
        rooms: h.rooms_count > 0 ? h.rooms_count : 1,
      });

      const normalized = rawRates
        .map((r) => normalizeRate(r, sarPer, BASE, fxDate))
        .filter((n): n is NormalizedRate => n != null);
      if (normalized.length === 0) {
        hotels.push({ ...h, sourcing: null });
        continue;
      }

      // Comparable grouping keeps e.g. the non-refundable RO out of the
      // refundable BB group. Prefer the group matching the chosen board, else a
      // refundable group, else the cheapest; take the cheapest rate in it.
      const groups = groupComparable(normalized);
      const chosenGroup =
        (h.board_type ? groups.find((g) => g.facets.board_type === h.board_type) : undefined) ??
        groups.find((g) => g.facets.refundable) ??
        groups[0];
      const topNorm = chosenGroup.rates[0];
      const raw = rawRates.find((r) => r.rate_key === topNorm.rate_key);
      if (!raw) {
        hotels.push({ ...h, sourcing: null });
        continue;
      }

      const ctx: MarkupContext = {
        country: data.trip.country || null,
        city: h.city_name || null,
        supplier_id: provider.id,
        stars: null,
        date: data.trip.arrival_date,
        customer_type: "individual",
      };
      const res = priceSupplierRate(raw, rules, ctx, sarPer, BASE, fxDate);
      if (!res.ok) {
        hotels.push({ ...h, sourcing: null });
        continue;
      }
      const line = res.line;

      const sourcing: DraftHotelSourcing = {
        supplier_id: line.supplier_id,
        supplier_name: line.supplier_name,
        rate_key: line.rate_key,
        net_base: line.net,
        net_source_currency: line.net_source_currency,
        fx_rate: line.fx_rate,
        fx_date: line.fx_date,
        ref_sell_base: line.ref_sell_base,
        sell_base: line.sell,
        markup_amount: line.markup_amount,
        markup_pct: line.markup_pct,
        margin_pct: line.margin_pct,
        min_margin_pct: line.rule_min_margin_pct,
        cancellation_policy: line.cancellation_policy,
        excluded_surcharges: line.excluded_surcharges.map((s) => ({ name: s.name, amount: s.amount, currency: s.currency })),
        valid_until: line.valid_until,
        room_category: line.room_category,
        room_name: raw.room_category_raw,
        refundable: line.refundable,
        blocked: line.blocks.length > 0,
        // the bulk pricer does not fetch static content (that happens on select)
        image_url: null,
        facilities: [],
        star_rating: null,
        supplier_hotel_id: raw.hotel_id,
        rate_fetched_at: fxDate,
      };
      // reflect the chosen board so the document matches the priced rate
      hotels.push({ ...h, board_type: line.board_type, sourcing });
      priced += 1;
      if (sourcing.blocked) blocked += 1;

      // keep the offer rollup in sync: one hotel pricing item per hotel line
      const desc = `${h.city_name} — ${h.hotel_name}`;
      const item: DraftPricingItem = {
        item_type: "hotel",
        description: desc,
        quantity: 1,
        buy_price: line.net,
        buy_currency: BASE,
        sell_price: line.sell,
        sell_currency: BASE,
      };
      const idx = pricingItems.findIndex((p) => p.item_type === "hotel" && p.description === desc);
      if (idx >= 0) pricingItems[idx] = item;
      else pricingItems.push(item);
    }

    if (priced === 0) return { ok: false, error: "pg.supplier.noRates" };

    await saveDraftStages(draftId, {
      hotels,
      pricing: { ...data.pricing, items: pricingItems, display_currency: BASE },
    });
    return { ok: true, priced, blocked };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
