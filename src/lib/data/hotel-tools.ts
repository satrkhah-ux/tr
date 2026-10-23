"use server";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOTEL_ID_KEY } from "@/lib/operations/voucher-dto";
import { issueVouchersForHotel } from "./wizard-sync";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { normAr } from "@/lib/catalog/norm";
import { similarHotels, type HotelLite, type SimilarHotel } from "@/lib/catalog/hotel-rules";

/**
 * The /hotels tools: what uses a hotel, merging one into another, and «يوجد
 * فندق مشابه». Behind data.write — the gate of every data-section write —
 * except the merge, which deletes the merged hotels: settings.manage, like every
 * delete in «البيانات» (owner, 2026-10-17; merge_hotels checks it too, 0079).
 *
 * The counts read drafts and offer stays, which no session may read since 0047,
 * so they go through the service role AFTER the gate (as draft-store.ts does).
 * The merge itself is public.merge_hotels (0070), called with the caller's own
 * session: it checks is_staff() and writes its audit row in the same transaction.
 */

async function gate(permission: "data.write" | "settings.manage" = "data.write"): Promise<TranslationKey | null> {
  if (!(await getServerUser())) return "err.session";
  return (await currentCan(permission)) ? null : "err.forbidden";
}

function service(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

export type HotelUsage = {
  /** issued offers with a stay in it */
  offers: number;
  /** drafts (generator, /basic, partners) that picked it */
  drafts: number;
  /** remembered room prices */
  rates: number;
  /** operation bookings titled with its Arabic name */
  bookings: number;
};

export type HotelBrief = { id: string; arabic_name: string; english_name: string | null; city_id: string | null; stars: number | null };

async function usageOf(db: SupabaseClient, hotel: HotelBrief): Promise<HotelUsage> {
  const [offers, drafts, rates, bookings] = await Promise.all([
    db.from("offers").select("id, offer_hotels!inner(hotel_id)", { count: "exact", head: true }).eq("offer_hotels.hotel_id", hotel.id),
    db.from("offer_drafts").select("id", { count: "exact", head: true }).contains("data", { hotels: [{ hotel_id: hotel.id }] }),
    db.from("hotel_rate_memory").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id),
    db.from("operation_bookings").select("id", { count: "exact", head: true }).eq("kind", "hotel").eq("title", hotel.arabic_name.trim()),
  ]);
  const failed = [offers, drafts, rates, bookings].find((r) => r.error);
  if (failed) throw new Error(failed.error?.message);
  return { offers: offers.count ?? 0, drafts: drafts.count ?? 0, rates: rates.count ?? 0, bookings: bookings.count ?? 0 };
}

async function briefs(db: SupabaseClient, ids: string[]): Promise<HotelBrief[]> {
  const { data, error } = await db.from("hotels").select("id, arabic_name, english_name, city_id, stars").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as HotelBrief[];
}

export type UsageResult = { ok: true; usage: HotelUsage } | { ok: false; error: TranslationKey };

/** What a hotel is used by — shown in its details, and the reason a delete is refused. */
export async function getHotelUsage(id: string): Promise<UsageResult> {
  const denied = await gate();
  if (denied) return { ok: false, error: denied };
  try {
    const db = service();
    const [hotel] = await briefs(db, [id]);
    if (!hotel) return { ok: false, error: "data.tools.err.hotelGone" };
    return { ok: true, usage: await usageOf(db, hotel) };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type MergePreview = {
  keep: HotelBrief;
  drops: HotelBrief[];
  usage: HotelUsage;
  /** room types that move to the kept hotel / that become one it already has */
  rooms: { moved: number; merged: number };
};

export type PreviewResult = { ok: true; preview: MergePreview } | { ok: false; error: TranslationKey };

/** What «دمج» would move — counted, nothing changed. */
export async function previewHotelMerge(keepId: string, dropIds: string[]): Promise<PreviewResult> {
  const denied = await gate("settings.manage");
  if (denied) return { ok: false, error: denied };
  const drops = [...new Set(dropIds)].filter((id) => id && id !== keepId);
  if (!keepId || drops.length === 0) return { ok: false, error: "data.tools.err.nothingToMerge" };
  try {
    const db = service();
    const rows = await briefs(db, [keepId, ...drops]);
    const keep = rows.find((r) => r.id === keepId);
    const dropped = drops.map((id) => rows.find((r) => r.id === id)).filter((r): r is HotelBrief => Boolean(r));
    if (!keep || dropped.length !== drops.length) return { ok: false, error: "data.tools.err.hotelGone" };

    const usage: HotelUsage = { offers: 0, drafts: 0, rates: 0, bookings: 0 };
    for (const u of await Promise.all(dropped.map((h) => usageOf(db, h)))) {
      usage.offers += u.offers;
      usage.drafts += u.drafts;
      usage.rates += u.rates;
      usage.bookings += u.bookings;
    }

    // the same walk merge_hotels makes: a name the kept hotel has (by then) is merged, the rest move
    const { data: roomRows, error } = await db.from("room_types").select("hotel_id, arabic_name").in("hotel_id", [keepId, ...drops]);
    if (error) throw new Error(error.message);
    const rooms = (roomRows ?? []) as { hotel_id: string; arabic_name: string }[];
    const kept = new Set(rooms.filter((r) => r.hotel_id === keepId).map((r) => normAr(r.arabic_name)));
    let moved = 0;
    let merged = 0;
    for (const id of drops) {
      for (const room of rooms.filter((r) => r.hotel_id === id)) {
        const name = normAr(room.arabic_name);
        if (name && kept.has(name)) {
          merged += 1;
        } else {
          moved += 1;
          kept.add(name);
        }
      }
    }
    return { ok: true, preview: { keep, drops: dropped, usage, rooms: { moved, merged } } };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type MergeResult = { ok: true; removed: number } | { ok: false; error: TranslationKey };

/** Merge `dropIds` into `keepId` — one transaction in the database (0070), audited there. */
export async function mergeHotels(keepId: string, dropIds: string[]): Promise<MergeResult> {
  const denied = await gate("settings.manage");
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data, error } = await supabase.rpc("merge_hotels", { p_keep: keepId, p_drop: dropIds });
    if (error) {
      // PGRST202: the function is not in the schema — 0070 has not been applied
      if (error.code === "PGRST202") return { ok: false, error: "data.tools.err.notMigrated" };
      if (error.code === "42501") return { ok: false, error: "err.forbidden" };
      if (error.message === "hotel_not_found") return { ok: false, error: "data.tools.err.hotelGone" };
      if (error.message === "nothing_to_merge") return { ok: false, error: "data.tools.err.nothingToMerge" };
      return { ok: false, error: "err.db" };
    }
    // a booking that knows its hotel by id (HOTEL_ID_KEY) follows it too — merge_hotels moves the
    // offers' lines, not the cases' — and a voucher that waited on the dropped row goes out
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: moved } = await service.from("operation_bookings").select("id, detail").eq("kind", "hotel").in(`detail->>${HOTEL_ID_KEY}`, dropIds);
    for (const b of (moved ?? []) as { id: string; detail: Record<string, string> }[]) {
      await service.from("operation_bookings").update({ detail: { ...b.detail, [HOTEL_ID_KEY]: keepId } }).eq("id", b.id);
    }
    after(() => issueVouchersForHotel(keepId));
    return { ok: true, removed: Number((data as { hotels_removed?: number } | null)?.hotels_removed ?? dropIds.length) };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** «يوجد فندق مشابه» while the form is typed: same city first, then elsewhere. */
export async function findSimilarHotels(input: {
  arabic: string;
  english: string;
  cityId: string | null;
  excludeId?: string | null;
}): Promise<SimilarHotel[]> {
  if (await gate()) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const rows: HotelLite[] = [];
    // ponytail: the whole catalogue (~2,400 rows) per debounced check; a catalog_norm RPC if it grows past ~20k
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("hotels")
        .select("id, arabic_name, english_name, city_id")
        .order("id")
        .range(from, from + 999);
      if (error) return [];
      rows.push(...((data ?? []) as HotelLite[]));
      if (!data || data.length < 1000) break;
    }
    return similarHotels(input, rows);
  } catch {
    return [];
  }
}
