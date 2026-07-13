"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server";
import type {
  DataRow,
  DataValue,
  DeleteResult,
  Filter,
  FilterOptions,
  ListInput,
  ListResult,
  MutateResult,
  AllowedTable,
} from "./types";

/** Tables the engine may touch — everything in the typed schema. */
const ALLOWED_TABLES: AllowedTable[] = [
  "countries", "cities", "hotels", "room_types", "services", "terms", "flights",
  "customers", "roles", "employees", "offers", "offer_cities", "offer_flights",
  "offer_hotels", "offer_services", "offer_terms", "offer_pricing_items",
  "offer_renders", "pricings", "offer_revisions",
  "airports", "transportation_types", "markup_rules", "ports", "drivers", "tours", "transfers", "statuses",
  "supervisors", "guide_informations", "profits", "ready_offers", "care_tickets",
  "city_climate_notes",
];

function assertTable(table: AllowedTable): void {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Table not allowed: ${table}`);
  }
}

function sanitizeSearch(value: string): string {
  // strip characters that would break PostgREST .or() syntax
  return value.replace(/[%,()*]/g, " ").trim();
}

function applyFilters<T>(query: T, filters: Filter[] | undefined): T {
  if (!filters) return query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  for (const f of filters) {
    if (f.value === null || f.value === "" || (Array.isArray(f.value) && f.value.length === 0)) continue;
    if (f.op === "in" && Array.isArray(f.value)) q = q.in(f.column, f.value);
    else if (f.op === "gte") q = q.gte(f.column, f.value);
    else if (f.op === "lte") q = q.lte(f.column, f.value);
    else if (f.op === "ilike") q = q.ilike(f.column, `%${f.value}%`);
    else q = q.eq(f.column, f.value);
  }
  return q as T;
}

/** Paginated, filtered, searchable list for any allowed table. */
export async function listRows(input: ListInput): Promise<ListResult> {
  try {
    assertTable(input.table);
    const supabase = await createSupabaseServerClient();
    const from = Math.max(input.page - 1, 0) * input.pageSize;
    const to = from + input.pageSize - 1;

    let query = supabase.from(input.table).select("*", { count: "exact" });
    query = applyFilters(query, input.filters);

    const search = input.search ? sanitizeSearch(input.search) : "";
    if (search && input.searchColumns && input.searchColumns.length > 0) {
      const or = input.searchColumns.map((col) => `${col}.ilike.%${search}%`).join(",");
      query = query.or(or);
    }

    if (input.sort) query = query.order(input.sort.column, { ascending: input.sort.ascending });
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) return { ok: false, error: "err.loadFailed" };
    return { ok: true, rows: (data ?? []) as unknown as DataRow[], count: count ?? 0 };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function createRow(table: AllowedTable, values: DataRow): Promise<MutateResult> {
  try {
    assertTable(table);
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from(table)
      .insert(values as never)
      .select("*")
      .single();
    if (error) return { ok: false, error: "err.createFailed" };
    return { ok: true, row: data as unknown as DataRow };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function updateRow(table: AllowedTable, id: string, values: DataRow): Promise<MutateResult> {
  try {
    assertTable(table);
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from(table)
      .update(values as never)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true, row: data as unknown as DataRow };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteRow(table: AllowedTable, id: string): Promise<DeleteResult> {
  try {
    assertTable(table);
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Duplicate a row (used by the "نسخ" action). */
export async function duplicateRow(table: AllowedTable, id: string): Promise<MutateResult> {
  try {
    assertTable(table);
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from(table).select("*").eq("id", id).single();
    if (error || !data) return { ok: false, error: "err.copyFailed" };
    const source = data as Record<string, DataValue>;
    const clone: DataRow = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === "id" || key === "created_at") continue;
      clone[key] = value;
    }
    return createRow(table, clone);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Options for the filter selects (countries / cities / employees). */
export async function getFilterOptions(): Promise<FilterOptions> {
  const empty: FilterOptions = { countries: [], cities: [], employees: [], static: [] };
  try {
    const supabase = await createSupabaseServerClient();
    const [countries, cities, employees] = await Promise.all([
      supabase.from("countries").select("id, arabic_name").order("arabic_name"),
      supabase.from("cities").select("id, arabic_name").order("arabic_name"),
      supabase.from("employees").select("id, arabic_name").order("arabic_name"),
    ]);
    type NamedRow = { id: string; arabic_name: string };
    const toOptions = (rows: unknown): { value: string; label: string }[] =>
      ((rows ?? []) as NamedRow[]).map((r) => ({ value: r.id, label: r.arabic_name }));
    return {
      countries: toOptions(countries.data),
      cities: toOptions(cities.data),
      employees: toOptions(employees.data),
      static: [],
    };
  } catch {
    return empty;
  }
}

export type DashboardFilters = {
  from?: string | null;
  to?: string | null;
  employeeId?: string | null;
  countryId?: string | null;
};

export type DashboardStats = {
  ok: boolean;
  offersTotal: number;
  confirmed: number;
  revenue: number;
  currency: string;
  customers: number;
  recent: DataRow[];
};

/** KPI aggregates for the dashboard, honouring the filter bar. */
export async function getDashboardStats(filters: DashboardFilters): Promise<DashboardStats> {
  const base: DashboardStats = {
    ok: false, offersTotal: 0, confirmed: 0, revenue: 0, currency: "ر.س", customers: 0, recent: [],
  };
  try {
    const supabase = await createSupabaseServerClient();

    const offerFilter = <T,>(q: T): T => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = q as any;
      if (filters.from) query = query.gte("offer_date", filters.from);
      if (filters.to) query = query.lte("offer_date", filters.to);
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      return query as T;
    };

    const totalQ = offerFilter(supabase.from("offers").select("id", { count: "exact", head: true }));
    const confirmedQ = offerFilter(
      supabase.from("offers").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    );
    const revenueQ = offerFilter(supabase.from("offers").select("total").eq("status", "confirmed"));
    const customersQ = supabase.from("customers").select("id", { count: "exact", head: true });
    const recentQ = offerFilter(
      supabase.from("offers").select("serial, destination, total, status, offer_date").order("offer_date", { ascending: false }).limit(6),
    );

    const [total, confirmed, revenue, customers, recent] = await Promise.all([
      totalQ, confirmedQ, revenueQ, customersQ, recentQ,
    ]);

    const revenueRows = (revenue.data ?? []) as { total: number | null }[];
    const revenueSum = revenueRows.reduce((sum, r) => sum + (r.total ?? 0), 0);

    return {
      ok: true,
      offersTotal: total.count ?? 0,
      confirmed: confirmed.count ?? 0,
      revenue: revenueSum,
      currency: "ر.س",
      customers: customers.count ?? 0,
      recent: (recent.data ?? []) as unknown as DataRow[],
    };
  } catch {
    return base;
  }
}
