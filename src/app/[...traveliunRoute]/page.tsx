import { TraveliunDataPage } from "@/components/traveliun/TraveliunDataPage";
import { TraveliunNotReady } from "@/components/traveliun/TraveliunNotReady";
import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { resolveTableConfig } from "@/lib/data/table-config";
import { guardPath } from "@/lib/roles/current";
import { getTraveliunPage } from "@/lib/traveliun-data";
import { movedTo } from "@/lib/nav/consolidated";
import { redirect } from "next/navigation";

export default async function TraveliunRoutePage({
  params,
}: {
  params: Promise<{ traveliunRoute: string[] }>;
}) {
  const { traveliunRoute } = await params;
  const route = `/${traveliunRoute.join("/")}`;
  // a page merged away (the owner, 2026-10-19): the old link lands where it went
  const moved = movedTo(route);
  if (moved) redirect(moved);
  // most of «قسم البيانات» and every /setting/* screen is served from here
  await guardPath(route);

  // 1) DB-backed table (real + persistent) if the route has a config.
  if (resolveTableConfig(route)) {
    return <TraveliunTablePage route={route} />;
  }

  // 2) Legacy static table for routes not yet migrated to the DB.
  const page = getTraveliunPage(route);
  if (!page) {
    return <TraveliunNotReady title={traveliunRoute.at(-1)?.replace(/-/g, " ") ?? "Page"} />;
  }

  return <TraveliunDataPage page={page} />;
}
