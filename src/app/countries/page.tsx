import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { guardPath } from "@/lib/roles/current";

export default async function CountriesPage() {
  await guardPath("/countries");
  return <TraveliunTablePage route="/countries" />;
}
