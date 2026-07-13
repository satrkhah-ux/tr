import { getFilterOptions } from "@/lib/data/actions";
import { resolveTableConfig } from "@/lib/data/table-config";
import type { FilterOptions } from "@/lib/data/types";
import { TraveliunNotReady } from "./TraveliunNotReady";
import { TraveliunTable } from "./TraveliunTable";

const EMPTY_OPTIONS: FilterOptions = { countries: [], cities: [], employees: [], static: [] };

/** Server wrapper: resolves the DB-backed config for a route, loads filter
 *  options, and renders the persistent client table. */
export async function TraveliunTablePage({ route }: { route: string }) {
  const config = resolveTableConfig(route);
  if (!config) return <TraveliunNotReady title={route.replace(/^\//, "").replace(/-/g, " ") || "Page"} />;

  const needsOptions = Boolean(config.filters?.length) || Boolean(config.isOffers);
  const filterOptions = needsOptions ? await getFilterOptions() : EMPTY_OPTIONS;

  return <TraveliunTable config={config} filterOptions={filterOptions} />;
}
