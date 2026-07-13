import { listClimateCities } from "@/lib/data/climate-actions";
import { TraveliunClimateAdmin } from "@/components/traveliun/TraveliunClimateAdmin";

/** Admin CRUD for editorial monthly city climate notes. Auth-guarded by middleware. */
export default async function ClimateAdminPage() {
  const cities = await listClimateCities();
  return <TraveliunClimateAdmin cities={cities} />;
}
