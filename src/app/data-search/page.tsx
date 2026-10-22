import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { DataSearchBox } from "@/components/traveliun/DataSearchBox";
import { guardPath } from "@/lib/roles/current";

/** «ابحث عن دولة أو خدمة» — what «البيانات» holds for a place or a service, in one place. */
export default async function DataSearchPage() {
  await guardPath("/data-search");
  return (
    <TraveliunShell title="nav.dataSearch">
      <DataSearchBox />
    </TraveliunShell>
  );
}
