import { redirect } from "next/navigation";
import { SupplierSearchTry } from "@/components/traveliun/SupplierSearchTry";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** «تجربة البحث في TBO» — admin-only, like the supplier registry it belongs to. */
export default async function TboSearchTryPage() {
  if (!await currentCan("settings.manage")) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("countries").select("arabic_name, iso2").order("arabic_name");
  // TBO looks a city up within a country by ISO-2, so a country without one cannot be searched
  const countries = ((data ?? []) as { arabic_name: string; iso2: string | null }[])
    .filter((c) => c.iso2?.trim())
    .map((c) => ({ name: c.arabic_name, iso2: (c.iso2 ?? "").trim().toUpperCase() }));
  return <SupplierSearchTry code="tbo" countries={countries} />;
}
