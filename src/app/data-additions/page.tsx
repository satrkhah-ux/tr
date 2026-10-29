import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { DataAdditionsReview } from "@/components/traveliun/DataAdditionsReview";
import { listCatalogAdditions } from "@/lib/data/catalog-additions";
import { guardPath } from "@/lib/roles/current";

/** «إضافات الموظفين»: what staff added mid-programme, for the data team to correct and approve. */
export default async function DataAdditionsPage() {
  await guardPath("/data-additions");
  const list = await listCatalogAdditions();
  if (!list) redirect("/dashboard");
  return (
    <TraveliunShell title="nav.dataAdditions">
      <DataAdditionsReview initial={list.rows} enabled={list.enabled} />
    </TraveliunShell>
  );
}
