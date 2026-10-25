import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { VisaBoard } from "@/components/traveliun/visa-files/VisaBoard";
import { getVisaBoard } from "@/lib/data/visa-files";
import { guardPath } from "@/lib/roles/current";
import { defaultBoardFilter, settle, toVisaFilter } from "@/lib/visa-files/ui";

export const dynamic = "force-dynamic";

/**
 * /visa-files — «لوحة التأشيرات». The first board is read here; a failure (the data layer not ready, the database
 * away) reaches the screen as its own error with «إعادة المحاولة», never as a crashed page.
 */
export default async function VisaFilesPage() {
  await guardPath("/visa-files");
  const initial = await settle(() => getVisaBoard(toVisaFilter(defaultBoardFilter())));
  return (
    <TraveliunShell title="nav.visaBoard">
      <VisaBoard initial={initial} />
    </TraveliunShell>
  );
}
