"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/data/metrics";
import { can } from "@/lib/roles/roles";
import { getSupplierAdapter } from "@/lib/providers/hotel-registry";
import type { HotelContentCacheRow } from "@/lib/types";

/**
 * STATIC hotel content cache. Content (name/stars/images/facilities/room
 * catalogue) is fetched ONCE per (supplier, hotel) and reused — it is NEVER
 * refetched per search. Live RATES are handled elsewhere (hotel-search.ts) and
 * are never cached. Room type and board type belong to the RATE, not here.
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

/** Cached content older than this is refreshed on next access (scheduled-ish refresh). */
const CONTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function isContentStale(syncedAt: string): boolean {
  const t = Date.parse(syncedAt);
  return Number.isNaN(t) || Date.now() - t > CONTENT_TTL_MS;
}

/** The client-safe slice used by the UI + offer (no supplier internals). */
export type CachedHotelContent = {
  supplier: string;
  supplier_hotel_id: string;
  name_ar: string | null;
  star_rating: number | null;
  image_url: string | null; // primary image
  facilities: string[];
  room_type_catalogue: { code: string; name_ar: string; name_en: string | null }[];
  check_in_time: string | null;
  check_out_time: string | null;
  content_synced_at: string;
};

function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const sorted = [...images].filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  sorted.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  const first = sorted[0];
  return first && typeof first.url === "string" ? first.url : null;
}

function toCached(row: HotelContentCacheRow): CachedHotelContent {
  return {
    supplier: row.supplier,
    supplier_hotel_id: row.supplier_hotel_id,
    name_ar: row.name_ar,
    star_rating: row.star_rating,
    image_url: firstImageUrl(row.images),
    facilities: Array.isArray(row.facilities) ? (row.facilities as unknown[]).filter((f): f is string => typeof f === "string") : [],
    room_type_catalogue: Array.isArray(row.room_type_catalogue)
      ? (row.room_type_catalogue as { code: string; name_ar: string; name_en: string | null }[])
      : [],
    check_in_time: row.check_in_time,
    check_out_time: row.check_out_time,
    content_synced_at: row.content_synced_at,
  };
}

/** Read cached content — NO supplier call. Returns null when not yet cached. */
export async function getCachedContent(supplier: string, supplierHotelId: string): Promise<CachedHotelContent | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("hotel_content_cache")
      .select("*")
      .eq("supplier", supplier)
      .eq("supplier_hotel_id", supplierHotelId)
      .maybeSingle();
    return data ? toCached(data as HotelContentCacheRow) : null;
  } catch {
    return null;
  }
}

/**
 * Ensure content is cached, fetching from the supplier ONLY on the first miss.
 * On a cache hit it returns immediately with NO supplier content call — this is
 * what makes a second visit issue zero content calls.
 */
export async function ensureHotelContentCached(
  supplier: string,
  supplierHotelId: string,
): Promise<CachedHotelContent | null> {
  // Cache hit AND fresh → return with NO supplier call. Stale content is refreshed
  // on next access (the "refreshed on a schedule" half of the content/rate split).
  const existing = await getCachedContent(supplier, supplierHotelId);
  if (existing && !isContentStale(existing.content_synced_at)) return existing;

  const adapter = await getSupplierAdapter(supplier);
  if (!adapter) return null;
  const content = await adapter.fetchContent(supplierHotelId);
  if (!content) return null;

  try {
    const supabase = await db();
    await supabase.from("hotel_content_cache").upsert(
      {
        supplier,
        supplier_hotel_id: supplierHotelId,
        name_ar: content.name_ar,
        name_en: content.name_en,
        star_rating: content.star_rating,
        address: content.address,
        lat: content.lat,
        lng: content.lng,
        description: content.description,
        images: content.images,
        facilities: content.facilities,
        room_type_catalogue: content.room_type_catalogue,
        check_in_time: content.check_in_time,
        check_out_time: content.check_out_time,
        content_synced_at: new Date().toISOString(),
        content_source: supplier,
      },
      { onConflict: "supplier,supplier_hotel_id" },
    );
  } catch {
    /* if the upsert fails we still return the fetched content */
  }
  return (await getCachedContent(supplier, supplierHotelId)) ?? {
    supplier,
    supplier_hotel_id: supplierHotelId,
    name_ar: content.name_ar,
    star_rating: content.star_rating,
    image_url: content.images[0]?.url ?? null,
    facilities: content.facilities,
    room_type_catalogue: content.room_type_catalogue,
    check_in_time: content.check_in_time,
    check_out_time: content.check_out_time,
    content_synced_at: new Date().toISOString(),
  };
}

/** Admin: force a content re-sync ("تحديث المحتوى"). */
export async function refreshHotelContent(supplier: string, supplierHotelId: string): Promise<{ ok: boolean }> {
  const user = await getServerUser();
  if (!user) return { ok: false };
  const role = await getCurrentRole();
  if (!can(role, "settings.manage")) return { ok: false };
  const adapter = await getSupplierAdapter(supplier);
  if (!adapter) return { ok: false };
  const content = await adapter.fetchContent(supplierHotelId);
  if (!content) return { ok: false };
  try {
    const supabase = await db();
    await supabase.from("hotel_content_cache").upsert(
      {
        supplier,
        supplier_hotel_id: supplierHotelId,
        name_ar: content.name_ar,
        name_en: content.name_en,
        star_rating: content.star_rating,
        images: content.images,
        facilities: content.facilities,
        room_type_catalogue: content.room_type_catalogue,
        check_in_time: content.check_in_time,
        check_out_time: content.check_out_time,
        content_synced_at: new Date().toISOString(),
        content_source: supplier,
      },
      { onConflict: "supplier,supplier_hotel_id" },
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
