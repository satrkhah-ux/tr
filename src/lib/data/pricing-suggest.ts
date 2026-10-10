"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getDraft } from "./drafts";
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
 * and only the handful of figures this draft actually needs comes back.
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
  const record = await getDraft(draftId);
  if (!record) return { ok: false, error: "err.db" };
  const data = record.data;

  try {
    const supabase = await db();

    // The country scopes the price lists — a transfer in Tbilisi is not a
    // transfer in Istanbul, and the same service costs differently per market.
    const { data: countryRows } = await supabase.from("countries").select("id, arabic_name");
    const country = ((countryRows ?? []) as { id: string; arabic_name: string }[]).find(
      (c) => c.arabic_name?.trim() === data.trip.country?.trim(),
    );

    const hotelIds = [...new Set(data.hotels.map((h) => h.hotel_id).filter((id): id is string => Boolean(id)))];

    const [transfersRes, servicesRes, memoryRes, historyRes] = await Promise.all([
      country
        ? supabase
            .from("transfers")
            .select("from_city, to_city, car_type, price, currency")
            .eq("country_id", country.id)
            .not("price", "is", null)
        : Promise.resolve({ data: [] }),
      country
        ? supabase
            .from("services")
            .select("service_type, arabic_name, buy_price, buy_currency, sell_price, sell_currency")
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

    const reference: PricingReference = {
      transfers: ((transfersRes.data ?? []) as TransferPrice[]).map((r) => ({ ...r, price: Number(r.price) })),
      services: (servicesRes.data ?? []) as ServicePrice[],
      rooms,
    };

    return { ok: true, items: suggestPricing(data, reference, labels) };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
