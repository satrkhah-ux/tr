import { TraveliunGuide } from "@/components/traveliun/TraveliunGuide";
import { listGuideFiles } from "@/lib/data/guide-actions";
import { guardPath } from "@/lib/roles/current";

export default async function WebGuidePage() {
  await guardPath("/web-guide");
  const files = await listGuideFiles();
  return <TraveliunGuide files={files} />;
}
