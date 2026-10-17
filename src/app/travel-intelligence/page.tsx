import { TraveliunIntelligenceHub } from "@/components/traveliun/TraveliunIntelligenceHub";
import { getHubData } from "@/lib/data/offers";
import { guardPath } from "@/lib/roles/current";

export default async function TravelIntelligencePage() {
  await guardPath("/travel-intelligence");
  const data = await getHubData();
  return <TraveliunIntelligenceHub data={data} />;
}
