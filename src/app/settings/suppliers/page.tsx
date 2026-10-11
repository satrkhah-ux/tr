import { redirect } from "next/navigation";
import { listMarkupRuleOptions, listSuppliers } from "@/lib/data/suppliers";
import { HotelSuppliersAdmin } from "@/components/traveliun/HotelSuppliersAdmin";
import { currentCan } from "@/lib/roles/current";
import { getHotelSearchSource } from "@/lib/data/app-settings";

/**
 * Admin-only: hotel supplier registry ("ربط مزوّدي الفنادق"). Gated THREE ways —
 * this route (redirect below), the data actions (requireAdmin), and RLS. Non-admins
 * are bounced to the dashboard; they never see the page or its data.
 */
export default async function HotelSuppliersSettingsPage() {
  if (!await currentCan("settings.manage")) redirect("/dashboard");

  const [suppliers, markupRules, searchSource] = await Promise.all([
    listSuppliers(),
    listMarkupRuleOptions(),
    getHotelSearchSource(),
  ]);
  return <HotelSuppliersAdmin suppliers={suppliers} markupRules={markupRules} searchSource={searchSource} />;
}
