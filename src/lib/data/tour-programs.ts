"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { normAr } from "@/lib/catalog/norm";
import type { TourProgram } from "@/lib/offer/itinerary";

/**
 * The ready-made day programmes (0052) for the cities of one trip.
 *
 * Text only — no price lives on these rows — so whoever may build a programme
 * may read them. Matched by folded name because the draft carries city NAMES.
 */
export async function getTourPrograms(cityNames: string[]): Promise<TourProgram[]> {
  if (!(await getServerUser())) return [];
  const wanted = new Set(cityNames.map(normAr).filter(Boolean));
  if (wanted.size === 0) return [];
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase
      .from("tour_programs")
      .select("id, title, description_ar, is_free_day, sort_order, cities(arabic_name)")
      .eq("status", "Active")
      .order("sort_order", { ascending: true, nullsFirst: false });
    type Row = {
      id: string;
      title: string;
      description_ar: string;
      is_free_day: boolean;
      sort_order: number | null;
      cities: { arabic_name: string } | null;
    };
    return ((data ?? []) as unknown as Row[])
      .filter((r) => r.cities && wanted.has(normAr(r.cities.arabic_name)))
      .map((r) => ({
        id: r.id,
        city_name: r.cities!.arabic_name,
        title: r.title,
        description: r.description_ar,
        is_free_day: r.is_free_day,
        sort_order: r.sort_order,
      }));
  } catch {
    return [];
  }
}
