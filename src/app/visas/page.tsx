import { TraveliunDataPage } from "@/components/traveliun/TraveliunDataPage";
import { getTraveliunPage } from "@/lib/traveliun-data";

export default function VisasPage() {
  return <TraveliunDataPage page={getTraveliunPage("/visas")} />;
}
