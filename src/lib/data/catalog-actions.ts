"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { closestName, normEn } from "@/lib/catalog/norm";
import { logAudit } from "./audit";

/**
 * Add a hotel or a room type WITHOUT leaving the package.
 *
 * The catalogue has 2,406 hotels and it is still not every hotel. When the one
 * the client asked for is missing, the agent used to abandon a half-built
 * programme, walk to «قسم البيانات», add a row, walk back and find their place
 * again — which is the scattering the generator exists to end. The row is
 * created from here, in the city being priced, and selected on the spot.
 *
 * The city is created too when it is new: a hotel with no city_id is invisible
 * to the generator's own search forever, so «add the hotel» has to mean the
 * whole chain or it means nothing.
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

/** The country, matched the way the generator matches it everywhere else. */
async function matchCountry(supabase: SupabaseClient, name: string): Promise<{ id: string; arabic_name: string } | undefined> {
  const { data } = await supabase.from("countries").select("id, arabic_name");
  return ((data ?? []) as { id: string; arabic_name: string }[]).find(
    (c) => normalizeName(c.arabic_name) === normalizeName(name),
  );
}

export type CreatedHotel = { id: string; name: string; name_en: string | null; stars: number | null };

export type CreateHotelResult =
  | { ok: true; hotel: CreatedHotel; cityCreated: boolean }
  | { ok: false; error: "err.session" | "err.db" | "pg.err.hotelNameRequired" | "pg.err.cityRequired" }
  /** a near-identical hotel already exists in this city — ask before creating a second one. */
  | { ok: false; error: "pg.err.didYouMean"; suggestion: CreatedHotel };

export async function createHotelForCity(input: {
  countryName: string;
  cityName: string;
  arabicName: string;
  englishName?: string;
  stars?: number | null;
  address?: string;
  contactNumber?: string;
  website?: string;
  /** the agent saw «هل تقصد …؟» and said no — create it anyway. */
  force?: boolean;
}): Promise<CreateHotelResult> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  const name = input.arabicName.trim();
  const city = input.cityName.trim();
  if (!name) return { ok: false, error: "pg.err.hotelNameRequired" };
  if (!city) return { ok: false, error: "pg.err.cityRequired" };

  try {
    const supabase = await db();

    const country = await matchCountry(supabase, input.countryName);

    // The city, found or created. Matched on the normalized name because the
    // draft carries whatever the agent typed, and a second «إسطنبول» beside
    // «اسطنبول» would split that city's hotels across two rows.
    const cityQuery = supabase.from("cities").select("id, arabic_name, country_id");
    const { data: cityRows } = await (country ? cityQuery.eq("country_id", country.id) : cityQuery);

    let cityId =
      ((cityRows ?? []) as { id: string; arabic_name: string }[]).find(
        (c) => normalizeName(c.arabic_name) === normalizeName(city),
      )?.id ?? null;

    let cityCreated = false;
    if (!cityId) {
      const { data: inserted, error } = await supabase
        .from("cities")
        .insert({ arabic_name: city, country_id: country?.id ?? null })
        .select("id")
        .single();
      if (error || !inserted) return { ok: false, error: "err.db" };
      cityId = (inserted as { id: string }).id;
      cityCreated = true;
    }

    // Already there under the same name in the same city? Hand that one back
    // rather than making a duplicate the search will show twice.
    const { data: existing } = await supabase
      .from("hotels")
      .select("id, arabic_name, english_name, stars")
      .eq("city_id", cityId);
    const rows = (existing ?? []) as CreatedHotelRow[];
    const en = normEn(input.englishName);
    const match = rows.find(
      (h) => normalizeName(h.arabic_name) === normalizeName(name) || (en !== "" && normEn(h.english_name) === en),
    );
    if (match) {
      return { ok: true, hotel: toHotel(match), cityCreated };
    }
    // «ليكسيز» beside «ليكسيس»: the same building one letter apart. Asked, not
    // assumed — two real hotels can be one letter apart too.
    const near = input.force ? null : closestName(name, rows, (h) => h.arabic_name, 0.85);
    if (near) return { ok: false, error: "pg.err.didYouMean", suggestion: toHotel(near.row) };

    const { data: created, error: hotelError } = await supabase
      .from("hotels")
      .insert({
        arabic_name: name,
        english_name: input.englishName?.trim() || null,
        stars: input.stars && input.stars >= 1 && input.stars <= 7 ? input.stars : null,
        address: input.address?.trim() || null,
        contact_number: input.contactNumber?.trim() || null,
        website: input.website?.trim() || null,
        city_id: cityId,
        country_id: country?.id ?? null,
      })
      .select("id, arabic_name, english_name, stars")
      .single();

    if (hotelError || !created) return { ok: false, error: "err.db" };
    // the hotel's change log starts here, as it does for one added on /hotels
    await logAudit({ action: "data.created", entity: "hotels", entity_id: (created as CreatedHotelRow).id, meta: { from: "generator" } });
    return { ok: true, hotel: toHotel(created as CreatedHotelRow), cityCreated };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

type CreatedHotelRow = { id: string; arabic_name: string; english_name: string | null; stars: number | null };

function toHotel(row: CreatedHotelRow): CreatedHotel {
  return { id: row.id, name: row.arabic_name, name_en: row.english_name, stars: row.stars };
}

export type CreateCityResult =
  | { ok: true; name: string; created: boolean }
  | { ok: false; error: "err.session" | "err.db" | "pg.err.cityNameRequired" | "pg.err.countryFirst" }
  | { ok: false; error: "pg.err.didYouMean"; suggestion: string };

/**
 * A city the country does not have yet.
 *
 * 30 of the 57 countries came over with no city at all (the legacy system held
 * cities for 27), so for Spain or France the list was empty and the agent could
 * not even start the programme. The city goes into THAT country's catalogue
 * here and is in the list for every package after.
 *
 * It needs a country: a city with no country_id is invisible to the
 * generator's list forever, which is the same dead end with extra steps.
 */
export async function createCityForCountry(
  countryName: string,
  cityName: string,
  force = false,
): Promise<CreateCityResult> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  const name = cityName.trim();
  if (!name) return { ok: false, error: "pg.err.cityNameRequired" };

  try {
    const supabase = await db();
    const country = await matchCountry(supabase, countryName);
    if (!country) return { ok: false, error: "pg.err.countryFirst" };

    // «إسطنبول» typed beside an existing «اسطنبول» is the SAME city — hand back
    // the catalogue's spelling so the stays and the hotels stay on one row.
    const { data: rows } = await supabase.from("cities").select("arabic_name").eq("country_id", country.id);
    const list = (rows ?? []) as { arabic_name: string }[];
    const same = list.find((c) => normalizeName(c.arabic_name) === normalizeName(name));
    if (same) return { ok: true, name: same.arabic_name, created: false };
    // «كوالالامبور» is «كوالالمبور» with one alef too many — ask before a second row.
    const near = force ? null : closestName(name, list, (c) => c.arabic_name, 0.8);
    if (near) return { ok: false, error: "pg.err.didYouMean", suggestion: near.row.arabic_name };

    const { error } = await supabase.from("cities").insert({ arabic_name: name, country_id: country.id });
    return error ? { ok: false, error: "err.db" } : { ok: true, name, created: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
