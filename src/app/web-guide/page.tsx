import { TraveliunGuide } from "@/components/traveliun/TraveliunGuide";
import { listGuideFiles } from "@/lib/data/guide-actions";

export default async function WebGuidePage() {
  const files = await listGuideFiles();
  return <TraveliunGuide files={files} />;
}
