"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { loadDraft } from "./draft-store";
import { findLookupCountry } from "@/lib/offer/draft-types";
import {
  suggestPricing,
  type PricingReference,
  type RoomPrice,
  type ServicePrice,
  type SuggestedItem,
  type TransferPrice,
} from "@/lib/offer/pricing-suggest";

/**
 * Load the agency's own price lists and build the pricing sheet from them.
 *
 * Server-side because the lists are large and internal: 879 transfer prices
 * and the buy side of every service. None of it belongs in a browser bundle,
 * and only the handful of figures this draft actually needs comes back — the
 * buy side of those only to someone holding pricing.internal.
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

export type SuggestPricingResult =
  | { ok: true; items: SuggestedItem[] }
  | { ok: false; error: "err.session" | "err.db" };

export async function suggestPricingForDraft(
  draftId: string,
  labels: { hotel: string; airline: string },
): Promise<SuggestPricingResult> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  // The full draft: a supplier-priced stay's net is what its line is bought at.
  const record = await loadDraft(draftId);
  if (!record) return { ok: false, error: "err.db" };
  const data = record.data;

  try {
    const supabase = await db();

    // The country scopes the price lists — a transfer in Tbilisi is not a
    // transfer in Istanbul, and the same service costs differently per market.
    // Matched the way the generator matches it, so «تايلند» still finds «تايلاند».
    const { data: countryRows } = await supabase.from("countries").select("id, arabic_name");
    const country = findLookupCountry(
      ((countryRows ?? []) as { id: string; arabic_name: string }[]).map((c) => ({ id: c.id, name: c.arabic_name })),
      data.trip.country?.trim() ?? "",
    );

    const hotelIds = [...new Set(data.hotels.map((h) => h.hotel_id).filter((id): id is string => Boolean(id)))];

    const [transfersRes, servicesRes, memoryRes, historyRes, fleetRes, legacyRes, legacyServiceRes] = await Promise.all([
      country
        ? supabase
            .from("transfers")
            .select("id, from_city, to_city, car_type, price, currency, created_at")
            .eq("country_id", country.id)
            .not("price", "is", null)
        : Promise.resolve({ data: [] }),
      // Service role: 0047 withholds services.buy_price from every session. The
      // buy side leaves this function only for pricing.internal (below).
      country
        ? (createSupabaseServiceClient() as unknown as SupabaseClient)
            .from("services")
            .select("id, service_type, arabic_name, buy_price, buy_currency, sell_price, sell_currency, created_at")
            .eq("country_id", country.id)
        : Promise.resolve({ data: [] }),
      hotelIds.length > 0
        ? supabase
            .from("hotel_rate_memory")
            .select("hotel_id, room_type_name, board_type, price, currency")
            .in("hotel_id", hotelIds)
        : Promise.resolve({ data: [] }),
      // The last price actually quoted for these hotels, as a final fallback —
      // the same history the hotel search already shows as «آخر عرض».
      hotelIds.length > 0
        ? supabase
            .from("offer_hotels")
            .select("hotel_id, hotel_name, room_type_name, board_type, sell_price, sell_currency, check_in")
            .in("hotel_id", hotelIds)
            .not("sell_price", "is", null)
            .order("check_in", { ascending: false, nullsFirst: false })
            .limit(200)
        : Promise.resolve({ data: [] }),
      // The agency's own vehicles — what a transfer is priced in when the agent
      // has not chosen one yet: the smallest that seats the group.
      supabase
        .from("transportation_types")
        .select("arabic_name, pax_capacity")
        .eq("category", "fleet")
        .neq("status", "Disabled"),
      // The legacy import stamped every transfer with one timestamp and kept the
      // retired prices; the old system's own row id is what tells the current
      // one apart. ponytail: the whole map in one read (~885 rows, under the API's
      // 1000-row cap, and only a legacy import adds to it) — filter by the
      // transfer ids if it ever grows past that.
      country
        ? supabase.from("legacy_id_map").select("legacy_id, new_id").eq("entity", "transfer").eq("source", "app")
        : Promise.resolve({ data: [] }),
      // The services were imported the same way (58 rows, one timestamp).
      country
        ? supabase.from("legacy_id_map").select("legacy_id, new_id").eq("entity", "service").eq("source", "app")
        : Promise.resolve({ data: [] }),
    ]);

    const rooms: RoomPrice[] = [
      // Memory first: it is what a human last decided for this exact room.
      ...((memoryRes.data ?? []) as {
        hotel_id: string;
        room_type_name: string;
        board_type: string | null;
        price: number;
        currency: string;
      }[]).map((r) => ({
        hotel_id: r.hotel_id,
        hotel_name: "",
        room_type_name: r.room_type_name,
        board_type: r.board_type,
        price: Number(r.price),
        currency: r.currency || "SAR",
      })),
      ...((historyRes.data ?? []) as {
        hotel_id: string | null;
        hotel_name: string | null;
        room_type_name: string | null;
        board_type: string | null;
        sell_price: number;
        sell_currency: string | null;
      }[])
        .filter((r) => r.room_type_name)
        .map((r) => ({
          hotel_id: r.hotel_id,
          hotel_name: r.hotel_name ?? "",
          room_type_name: r.room_type_name as string,
          board_type: r.board_type,
          price: Number(r.sell_price),
          currency: r.sell_currency || "SAR",
        })),
    ];

    // Any ISO code is fine: the dropdowns now hold whatever a line carries, and
    // a code with no rate is reported, never converted as something else. The
    // legacy list wrote Saudi riyals out in words; anything else that is not a
    // code — a blank included — is dropped (the line stays unpriced, which the
    // screen says). Never guessed: the six Moscow transfers have no currency,
    // and as roubles their 1,000 for Moscow → St Petersburg would be ~44 SAR.
    const knownCurrency = (code: string | null): string | null => {
      const c = code?.trim() === "ريال سعودي" ? "SAR" : (code?.trim().toUpperCase() ?? "");
      return /^[A-Z]{3}$/.test(c) ? c : null;
    };
    const legacyId = new Map(
      ([...(legacyRes.data ?? []), ...(legacyServiceRes.data ?? [])] as { legacy_id: number; new_id: string }[]).map((m) => [
        m.new_id,
        Number(m.legacy_id),
      ]),
    );
    const transfers: TransferPrice[] = ((transfersRes.data ?? []) as (TransferPrice & { id: string })[]).flatMap((r) => {
      const currency = knownCurrency(r.currency);
      return currency ? [{ ...r, price: Number(r.price), currency, legacy_id: legacyId.get(r.id) ?? null }] : [];
    });
    const services: ServicePrice[] = ((servicesRes.data ?? []) as (ServicePrice & { id: string })[]).flatMap((r) => {
      const buy = knownCurrency(r.buy_currency);
      const sell = knownCurrency(r.sell_currency);
      if ((r.buy_price != null && !buy) || (r.sell_price != null && !sell)) return [];
      return [{ ...r, buy_currency: buy, sell_currency: sell, legacy_id: legacyId.get(r.id) ?? null }];
    });

    const reference: PricingReference = {
      transfers,
      services,
      rooms,
      fleet: ((fleetRes.data ?? []) as { arabic_name: string | null; pax_capacity: number | null }[]).flatMap((v) =>
        v.arabic_name?.trim() && v.pax_capacity != null ? [{ name: v.arabic_name.trim(), pax: v.pax_capacity }] : [],
      ),
    };

    const items = suggestPricing(data, reference, labels);
    if (await currentCan("pricing.internal")) return { ok: true, items };
    // Whoever cannot see a buy price is not sent one. Saving keeps the stored
    // buy of a line that already had one (keepDraftCost); a line they add from
    // this list is saved without its buy, which pricing.internal can fill in.
    return { ok: true, items: items.map((item) => ({ ...item, buy_price: null, buy_currency: "" })) };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
