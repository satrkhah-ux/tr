import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HotelSupplier } from "@/lib/providers/hotel-supplier";
import { getSupplierAdapterLogged } from "@/lib/providers/hotel-registry";
import type { SupplierCallRecord } from "@/lib/providers/hotel-supplier";
import { cityCountry, type DraftData, type DraftHotel } from "@/lib/offer/draft-types";
import { normAr } from "@/lib/catalog/norm";
import type { SuggestSourceKey } from "./core";
import { memoryAlternatives, stayBaseline, stayStars, type CandidateHotel, type StayAlternative } from "./suggest-core";

/**
 * Where a cheaper stay may come from (the owner, 2026-10-26: «يبدأ بالبحث
 * بمواقع خارجية ويجد فنادق أقل وعلى الموظف التأكد من ذلك»): pluggable sources
 * behind one interface — the company's own rate memory (trusted, writes its
 * prices) and TBO's live search (official API, NO scraping of public sites; its
 * quote is shown but never written: the employee verifies and types the price).
 * A source that fails answers with nothing, silently — never an error in the
 * sweep. Adding a supplier later = one more entry here.
 */

export type SuggestContext = {
  draft: DraftData;
  stay: DraftHotel;
  cityName: string;
  nights: number;
  checkIn: string | null;
  checkOut: string | null;
  /** the city's catalogue hotels with remembered rates — also the baseline and the stars for every source */
  memoryMarket: CandidateHotel[];
  sarPer: Record<string, number>;
  db: SupabaseClient;
  /** tests inject a fake adapter; undefined means use the real registry */
  tboAdapter?: HotelSupplier | null;
};

export type SuggestSource = {
  key: SuggestSourceKey;
  alternativesFor(ctx: SuggestContext): Promise<StayAlternative[]>;
};

const toSar = (amount: number, currency: string, sarPer: Record<string, number>) =>
  currency === "SAR" ? amount : sarPer[currency] ? amount * sarPer[currency] : null;

export const memorySource: SuggestSource = {
  key: "memory",
  alternativesFor: async (ctx) => memoryAlternatives(ctx.stay, ctx.nights, ctx.memoryMarket, ctx.sarPer),
};

const fold = (s: string) => normAr(s).replace(/^ال/, "");

/** the service-client twins of hotel-search's session-bound lookups (the sweep has no session) */
async function tboCityQuery(db: SupabaseClient, draft: DraftData, cityName: string): Promise<{ iso2: string; city: string } | null> {
  const countryName = cityCountry(draft, cityName) || draft.trip.country;
  if (!countryName?.trim()) return null;
  const { data: countries } = await db.from("countries").select("id, arabic_name, iso2");
  const country = ((countries ?? []) as { id: string; arabic_name: string; iso2: string | null }[]).find((c) => fold(c.arabic_name) === fold(countryName));
  if (!country?.iso2?.trim()) return null;
  const { data: cities } = await db.from("cities").select("arabic_name, english_name").eq("country_id", country.id);
  const hit = ((cities ?? []) as { arabic_name: string; english_name: string | null }[]).find((c) => fold(c.arabic_name) === fold(cityName));
  return { iso2: country.iso2.trim().toUpperCase(), city: hit?.english_name?.trim() || cityName };
}

export const tboSource: SuggestSource = {
  key: "tbo",
  async alternativesFor(ctx): Promise<StayAlternative[]> {
    try {
      const stars = stayStars(ctx.stay, ctx.memoryMarket);
      const base = stayBaseline(ctx.stay, ctx.nights, ctx.memoryMarket);
      if (!stars || !base || !ctx.checkIn || !ctx.checkOut) return [];
      const baseSar = toSar(base.perNightTotal * ctx.nights, base.currency, ctx.sarPer);
      if (baseSar == null || baseSar <= 0) return [];
      const sink: SupplierCallRecord[] = [];
      const adapter = ctx.tboAdapter !== undefined ? ctx.tboAdapter : await getSupplierAdapterLogged("tbo", sink);
      if (!adapter) return [];
      const where = await tboCityQuery(ctx.db, ctx.draft, ctx.cityName);
      if (!where) return [];
      // their Search still answers 500 for our account — any failure is «مصدر غير متاح», silently
      const results = await adapter.searchHotels({
        city: where.city,
        check_in: ctx.checkIn,
        check_out: ctx.checkOut,
        adults: ctx.draft.trip.adults || 2,
        children: ctx.draft.trip.children || 0,
        children_ages: ctx.draft.trip.children_ages ?? null,
        rooms: ctx.draft.trip.rooms || 1,
        country_code: where.iso2,
      });
      const out: StayAlternative[] = [];
      for (const h of results) {
        if (h.star_rating !== stars || fold(h.name_ar) === fold(ctx.stay.hotel_name)) continue;
        let best: { sar: number; board: string | null; cancellation: string | null; refundable: boolean | null } | null = null;
        for (const r of h.rates) {
          const sar = toSar(r.inclusive, r.currency, ctx.sarPer);
          if (sar == null) continue;
          if (!best || sar < best.sar) best = { sar, board: r.board_type ?? null, cancellation: r.cancellation_policy || null, refundable: r.refundable ?? null };
        }
        if (!best || best.sar >= baseSar) continue;
        out.push({
          source: "tbo",
          hotelId: null,
          supplierHotelId: h.supplier_hotel_id,
          hotelName: h.name_ar,
          stars,
          staySar: Math.round(best.sar),
          saveSar: Math.round(baseSar - best.sar),
          // NO roomPrices on purpose: the quote is told to the employee, never written — verifying and typing it is their act
          board: best.board,
          cancellation: best.cancellation,
          refundable: best.refundable,
        });
      }
      return out.sort((a, b) => a.staySar - b.staySar).slice(0, 3);
    } catch {
      return [];
    }
  },
};

const SOURCES: Record<SuggestSourceKey, SuggestSource> = { memory: memorySource, tbo: tboSource };

/** One stay's alternatives from every enabled source, cheapest first. */
export async function alternativesFor(keys: SuggestSourceKey[], ctx: SuggestContext): Promise<StayAlternative[]> {
  const lists = await Promise.all(keys.map((k) => SOURCES[k].alternativesFor(ctx).catch(() => [])));
  return lists.flat().sort((a, b) => a.staySar - b.staySar);
}
