import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { Campaigns } from "@/components/traveliun/discounts/Campaigns";
import { listCampaigns } from "@/lib/data/discounts";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";
export default async function DiscountsPage() {
  await guardPath("/discounts");
  return <TraveliunShell title="nav.discounts"><Campaigns rows={await listCampaigns()} /></TraveliunShell>;
}
