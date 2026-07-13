import { TraveliunIntelligenceHub } from "@/components/traveliun/TraveliunIntelligenceHub";
import { getHubData } from "@/lib/data/offers";

export default async function TravelIntelligencePage() {
  const data = await getHubData();
  return <TraveliunIntelligenceHub data={data} />;
}
