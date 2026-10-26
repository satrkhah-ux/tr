import { redirect } from "next/navigation";
import { TransportPricesAdmin } from "@/components/traveliun/TransportPricesAdmin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentCan, guardPath } from "@/lib/roles/current";

/** «إدارة أسعار المواصلات» (the owner, 2026-10-26) — country ← line ← ends ← a price per vehicle. */
export default async function TransportPricesPage() {
  await guardPath("/transport-prices");
  if (!(await currentCan("data.write"))) redirect("/dashboard");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("countries").select("id, arabic_name, default_currency").order("arabic_name");
  const countries = ((data ?? []) as { id: string; arabic_name: string; default_currency: string | null }[]).map((c) => ({
    id: c.id,
    name: c.arabic_name,
    currency: c.default_currency,
  }));
  return <TransportPricesAdmin countries={countries} />;
}
