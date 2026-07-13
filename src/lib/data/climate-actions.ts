"use server";

import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { CityClimateNote, ClimateLevel } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

export type ClimateCity = { id: string; name: string; country: string | null };

export type ClimateNoteInput = {
  city_id: string;
  month: number;
  avg_high_c: number | null;
  avg_low_c: number | null;
  rain_level: ClimateLevel | null;
  humidity_level: ClimateLevel | null;
  advice_ar: string | null;
  advice_en: string | null;
};

/**
 * Read access to the editorial climate notes. Writes (create/update/delete) go
 * through the generic data engine (actions.ts) via the admin CRUD screen.
 * Climate notes carry no pricing and have an anon read policy, so the public
 * offer preview/PDF can read them too.
 */

/** The climate note for one city + month (1–12), or null if none is set. */
export async function getClimateNote(cityId: string, month: number): Promise<CityClimateNote | null> {
  if (!cityId || !Number.isInteger(month) || month < 1 || month > 12) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("city_climate_notes")
      .select("*")
      .eq("city_id", cityId)
      .eq("month", month)
      .maybeSingle();
    return (data as CityClimateNote | null) ?? null;
  } catch {
    return null;
  }
}

/** All 12 months of climate notes for a city, ordered by month. */
export async function getClimateNotesForCity(cityId: string): Promise<CityClimateNote[]> {
  if (!cityId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("city_climate_notes")
      .select("*")
      .eq("city_id", cityId)
      .order("month");
    return (data as CityClimateNote[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Cities for the admin selector, labeled "City — Country". */
export async function listClimateCities(): Promise<ClimateCity[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const [citiesRes, countriesRes] = await Promise.all([
      supabase.from("cities").select("id, arabic_name, country_id").order("arabic_name"),
      supabase.from("countries").select("id, arabic_name"),
    ]);
    const countryNames = new Map<string, string>();
    for (const c of (countriesRes.data ?? []) as { id: string; arabic_name: string }[]) countryNames.set(c.id, c.arabic_name);
    return ((citiesRes.data ?? []) as { id: string; arabic_name: string; country_id: string | null }[]).map((row) => ({
      id: row.id,
      name: row.arabic_name,
      country: row.country_id ? (countryNames.get(row.country_id) ?? null) : null,
    }));
  } catch {
    return [];
  }
}

/** Create/update one city+month climate note (unique on city_id, month). Requires auth. */
export async function upsertClimateNote(
  input: ClimateNoteInput,
): Promise<{ ok: boolean; error?: TranslationKey }> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  if (!input.city_id || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { ok: false, error: "err.createFailed" };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const payload = {
      city_id: input.city_id,
      month: input.month,
      avg_high_c: input.avg_high_c,
      avg_low_c: input.avg_low_c,
      rain_level: input.rain_level,
      humidity_level: input.humidity_level,
      advice_ar: input.advice_ar,
      advice_en: input.advice_en,
      updated_by: null,
      updated_at: new Date().toISOString(),
    };
    // supabase-js collapses this typed insert to `never`; cast like actions.ts does.
    const { error } = await supabase.from("city_climate_notes").upsert(payload as never, { onConflict: "city_id,month" });
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
