"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { normAr } from "@/lib/catalog/norm";
import { currentCan } from "@/lib/roles/current";
import type { TourProgram } from "@/lib/offer/itinerary";
import type { TourPrice } from "@/lib/offer/pricing-suggest";

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

/**
 * The company's tours price list (/cars/tours) for these countries — what the
 * city card offers beside the programmes, a pick filling its price.
 */
export async function getTourPrices(countryNames: string[]): Promise<(TourPrice & { country: string })[]> {
  // the agency's own price list: staff who build offers, never a partner login
  if (!(await currentCan("offers.write"))) return [];
  const wanted = new Set(countryNames.map(normAr).filter(Boolean));
  if (wanted.size === 0) return [];
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const [{ data }, perCar] = await Promise.all([
      supabase.from("tours").select("arabic_name, price, currency, countries(arabic_name), cities(arabic_name)").not("price", "is", null),
      // a tour's price per vehicle (0072); absent before it is applied — then the list is as it was
      supabase.from("tour_prices").select("car_type, price, currency, provisional, tours!inner(arabic_name, program_id, countries(arabic_name), cities(arabic_name))"),
    ]);
    type Row = { arabic_name: string | null; price: number | string; currency: string | null; countries: { arabic_name: string } | null; cities?: { arabic_name: string } | null };
    type CarRow = { car_type: string; price: number | string; currency: string | null; provisional?: boolean | null; tours: (Row & { program_id: string | null }) | null };
    const inTrip = (r: Row | null): r is Row => Boolean(r?.arabic_name?.trim() && r.countries && wanted.has(normAr(r.countries.arabic_name)));
    const currency = (c: string | null) => (c || "SAR").trim().toUpperCase();
    return [
      ...((data ?? []) as unknown as Row[])
        .filter(inTrip)
        .map((r) => ({ name: r.arabic_name!.trim(), price: Number(r.price), currency: currency(r.currency), country: r.countries!.arabic_name, city: r.cities?.arabic_name ?? null })),
      ...(perCar.error ? [] : ((perCar.data ?? []) as unknown as CarRow[]))
        .filter((r) => inTrip(r.tours))
        .map((r) => ({
          name: r.tours!.arabic_name!.trim(),
          price: Number(r.price),
          currency: currency(r.currency),
          country: r.tours!.countries!.arabic_name,
          car_type: r.car_type,
          program_id: r.tours!.program_id,
          city: r.tours!.cities?.arabic_name ?? null,
          ...(r.provisional ? { provisional: true } : {}),
        })),
    ];
  } catch {
    return [];
  }
}

/**
 * The cars the company prices transfers in, for these countries — Turkey's list
 * names «فيتو» and «فان مرسيدس», never «سيارة صغيرة». The group's default car is
 * picked among them (BasicEditor), so the reception finds its price in the list
 * (the owner's review, 2026-10-18: every transfer typed by hand). Names only; no price.
 */
export async function getTransferCars(countryNames: string[]): Promise<string[]> {
  if (!(await currentCan("offers.write"))) return [];
  const wanted = new Set(countryNames.map(normAr).filter(Boolean));
  if (wanted.size === 0) return [];
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase.from("transfers").select("car_type, countries(arabic_name)").not("car_type", "is", null);
    type Row = { car_type: string | null; countries: { arabic_name: string } | null };
    return [...new Set(((data ?? []) as unknown as Row[]).filter((r) => r.car_type?.trim() && r.countries && wanted.has(normAr(r.countries.arabic_name))).map((r) => r.car_type!.trim()))];
  } catch {
    return [];
  }
}
