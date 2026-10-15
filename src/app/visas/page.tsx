import type { SupabaseClient } from "@supabase/supabase-js";
import { TraveliunDataPage } from "@/components/traveliun/TraveliunDataPage";
import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTraveliunPage } from "@/lib/traveliun-data";

/**
 * /visas — the visas table (0072, its country one of /countries) once data-texts
 * has moved the old rows into it; until then the old static page, so the screen
 * never goes blank between the migration and the move.
 */
export default async function VisasPage() {
  const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
  const { count, error } = await db.from("visas").select("id", { count: "exact", head: true });
  if (!error && (count ?? 0) > 0) return <TraveliunTablePage route="/visas" />;
  return <TraveliunDataPage page={getTraveliunPage("/visas")} />;
}
