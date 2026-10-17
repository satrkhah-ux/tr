import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { guardPath } from "@/lib/roles/current";

export default async function CustomersCarePage() {
  await guardPath("/customers-care");
  return <TraveliunTablePage route="/customers_care" />;
}
