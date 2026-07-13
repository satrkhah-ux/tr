import { TraveliunOfferBuilder } from "@/components/traveliun/TraveliunOfferBuilder";
import { getBuilderData } from "@/lib/data/offers";

export default async function OfferPage() {
  const data = await getBuilderData();
  return <TraveliunOfferBuilder data={data} />;
}
