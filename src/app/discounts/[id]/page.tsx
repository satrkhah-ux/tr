import { notFound } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { CampaignView } from "@/components/traveliun/discounts/CampaignView";
import { getCampaign } from "@/lib/data/discounts";
import { previewMessage } from "@/lib/data/discounts-actions";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";
export default async function DiscountCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await guardPath("/discounts");
  const { id } = await params;
  const [data, preview] = await Promise.all([getCampaign(id), previewMessage(id)]);
  if (!data) notFound();
  return <TraveliunShell title="nav.discounts"><CampaignView {...data} preview={preview} /></TraveliunShell>;
}
