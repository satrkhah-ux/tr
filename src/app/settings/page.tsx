import { TraveliunDataPage } from "@/components/traveliun/TraveliunDataPage";
import { getTraveliunPage } from "@/lib/traveliun-data";

export default function SettingsPage() {
  return <TraveliunDataPage page={getTraveliunPage("/setting/currencies")} />;
}
