import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normAr } from "@/lib/catalog/norm";
import { hotelIdOf } from "@/lib/operations/voucher-dto";

/**
 * The /hotels row a hotel booking is — what the voucher, the driver's hotels
 * message and a supplier's request print its address, phone, map and English
 * name from. By the booking's catalogue id (HOTEL_ID_KEY — the pull and the
 * pickers write it) when it has one; else by its name IN its city, and by name
 * alone only when one hotel in the catalogue carries it. A name two cities
 * share used to hand one city's address to the other's booking.
 */

export type HotelBookingRef = { title: string; city_name: string; detail?: Record<string, string> | null };
type CatalogRow = { id: string; arabic_name: string; city_id: string | null };

/** «كوالالمبور» and «كوالا لمبور», «جدة» and «جده» — one city. */
const place = (s: string | null | undefined) => normAr(s).replace(/\s+/g, "");

/** Pure: the row among `rows` the booking is, or null when none — or more than one — could be. */
export function pickCatalogHotel<T extends CatalogRow>(rows: T[], b: HotelBookingRef, cityName: (cityId: string | null) => string): T | null {
  const id = hotelIdOf(b.detail);
  const own = id ? rows.find((r) => r.id === id) : undefined;
  if (own) return own;
  const named = rows.filter((r) => normAr(r.arabic_name) === normAr(b.title));
  const city = place(b.city_name || b.detail?.["المدينة"]);
  const here = city ? named.filter((r) => place(cityName(r.city_id)) === city) : [];
  if (here.length === 1) return here[0];
  // a city on both sides that differs is another hotel; one namesake and no city to say otherwise is this one
  return named.length === 1 && (!city || !cityName(named[0].city_id)) ? named[0] : null;
}

/**
 * The catalogue rows for these bookings (their ids and their names, with each
 * row's city), and the picker over them. `columns`: what the caller prints.
 */
export async function catalogHotelsFor<T extends CatalogRow>(
  supabase: SupabaseClient,
  bookings: HotelBookingRef[],
  columns: string,
): Promise<{ rows: T[]; pick: (b: HotelBookingRef) => T | null; cityName: (cityId: string | null) => string }> {
  const ids = [...new Set(bookings.map((b) => hotelIdOf(b.detail)).filter((x): x is string => Boolean(x)))];
  const names = [...new Set(bookings.map((b) => b.title.trim()).filter(Boolean))];
  const select = `id, arabic_name, city_id, ${columns}`;
  const [byId, byName] = await Promise.all([
    ids.length > 0 ? supabase.from("hotels").select(select).in("id", ids) : Promise.resolve({ data: [] }),
    names.length > 0 ? supabase.from("hotels").select(select).in("arabic_name", names) : Promise.resolve({ data: [] }),
  ]);
  const rows = [...new Map(([...(byId.data ?? []), ...(byName.data ?? [])] as unknown as T[]).map((r) => [r.id, r])).values()];
  const cityIds = [...new Set(rows.map((r) => r.city_id).filter((x): x is string => Boolean(x)))];
  const { data: cities } = cityIds.length > 0 ? await supabase.from("cities").select("id, arabic_name").in("id", cityIds) : { data: [] };
  const cityOf = new Map(((cities ?? []) as { id: string; arabic_name: string }[]).map((c) => [c.id, c.arabic_name]));
  const cityName = (cityId: string | null) => (cityId ? (cityOf.get(cityId) ?? "") : "");
  return { rows, pick: (b) => pickCatalogHotel(rows, b, cityName), cityName };
}
