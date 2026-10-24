import type { SupabaseClient } from "@supabase/supabase-js";
import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { VisaListReview } from "@/components/traveliun/VisaListReview";
import { reviewVisas, type VisaReviewInput } from "@/lib/data/visa-review";
import { guardPath } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * /visas — the visas table (0072), what Murad answers a visa client with, and
 * above it «مراجعة القائمة»: the countries it would answer badly, and why.
 */
export default async function VisasPage() {
  await guardPath("/visas");
  const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
  // the session's own columns (0072 grants no buy price here)
  const { data, error } = await db
    .from("visas")
    .select("id, country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, status");
  const rows = (data ?? []) as VisaReviewInput[];
  const review = error ? null : <VisaListReview total={rows.length} reviews={reviewVisas(rows)} />;
  return <TraveliunTablePage route="/visas" extra={review} />;
}
