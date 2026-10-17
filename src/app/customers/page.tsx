import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { guardPath } from "@/lib/roles/current";

export default async function CustomersPage() {
  await guardPath("/customers");
  return <TraveliunTablePage route="/customers" />;
}
