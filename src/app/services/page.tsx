import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { guardPath } from "@/lib/roles/current";

export default async function ServicesPage() {
  await guardPath("/services");
  return <TraveliunTablePage route="/services" />;
}
