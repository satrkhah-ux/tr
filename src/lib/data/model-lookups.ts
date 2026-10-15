import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GeneratorLookups } from "@/lib/offer/draft-types";

/**
 * The generator's lookups, narrowed by the data model (0072): where a flight asks
 * for an airport, only an airport — a train station, a bus station or a port on
 * /airports is not one (data order 5).
 *
 * A wrapper rather than a change to getGeneratorLookups (drafts.ts belongs to
 * another session). Fails open: before 0072 there is no `kind`, every row is an
 * airport, and the lookups pass through unchanged.
 */
export async function withModelLookups(lookups: GeneratorLookups): Promise<GeneratorLookups> {
  if (lookups.airports.length === 0) return lookups;
  try {
    const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data, error } = await db.from("airports").select("id").neq("kind", "airport");
    if (error || !data || data.length === 0) return lookups;
    const notAirports = new Set((data as { id: string }[]).map((r) => r.id));
    return { ...lookups, airports: lookups.airports.filter((a) => !notAirports.has(a.id)) };
  } catch {
    return lookups;
  }
}
