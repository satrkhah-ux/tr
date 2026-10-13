import { getFilterOptions } from "@/lib/data/actions";
import { isCostColumn, resolveTableConfig } from "@/lib/data/table-config";
import { currentCan } from "@/lib/roles/current";
import type { FilterOptions } from "@/lib/data/types";
import { TraveliunNotReady } from "./TraveliunNotReady";
import { TraveliunTable } from "./TraveliunTable";

const EMPTY_OPTIONS: FilterOptions = { countries: [], cities: [], employees: [], suppliers: [], static: [] };

/** Server wrapper: resolves the DB-backed config for a route, loads filter
 *  options, and renders the persistent client table. */
export async function TraveliunTablePage({ route }: { route: string }) {
  const resolved = resolveTableConfig(route);
  if (!resolved) return <TraveliunNotReady title={route.replace(/^\//, "").replace(/-/g, " ") || "Page"} />;
  // A buy-price column is not drawn for someone the engine will not send it to.
  const config = (await currentCan("pricing.internal"))
    ? resolved
    : { ...resolved, columns: resolved.columns.filter((c) => !isCostColumn(resolved.table, c.key)) };

  const needsOptions = Boolean(config.filters?.length) || Boolean(config.isOffers) || config.columns.some((c) => c.source);
  const filterOptions = needsOptions ? await getFilterOptions() : EMPTY_OPTIONS;

  return <TraveliunTable config={config} filterOptions={filterOptions} />;
}
