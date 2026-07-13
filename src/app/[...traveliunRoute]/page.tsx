import { TraveliunDataPage } from "@/components/traveliun/TraveliunDataPage";
import { TraveliunNotReady } from "@/components/traveliun/TraveliunNotReady";
import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { resolveTableConfig } from "@/lib/data/table-config";
import { getTraveliunPage } from "@/lib/traveliun-data";

export default async function TraveliunRoutePage({
  params,
}: {
  params: Promise<{ traveliunRoute: string[] }>;
}) {
  const { traveliunRoute } = await params;
  const route = `/${traveliunRoute.join("/")}`;

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
