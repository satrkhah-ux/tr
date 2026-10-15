import { redirect } from "next/navigation";
import { PriceGrid } from "@/components/traveliun/PriceGrid";
import { getGridCities } from "@/lib/data/price-grid";
import { currentCan, guardPath } from "@/lib/roles/current";

/** «أسعار التوصيل والجولات» — a city's transfer and tour prices per car type, typed once. */
export default async function PriceGridPage() {
  await guardPath("/price-grid");
  if (!(await currentCan("data.write"))) redirect("/dashboard");
  return <PriceGrid cities={await getGridCities()} />;
}
