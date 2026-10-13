"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { editedTotalSar, offerSarTotal } from "@/lib/offer/pricing";
import { getRates } from "./rates-actions";
import { allTableConfigs, GRANTED_COLUMNS, INTERNAL_TABLES, isCostColumn } from "./table-config";
import { FILTER_NOT_NULL, FILTER_NULL } from "./types";
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

/**
 * Tables the engine may touch. Not the offer's cost tables (offer_hotels,
 * offer_pricing_items, pricings, offer_renders): no screen edits them, and a
 * generic editor is the wrong door to what an offer was bought at.
 */
const ALLOWED_TABLES: AllowedTable[] = [
  "countries", "cities", "hotels", "room_types", "services", "service_types", "terms", "flights",
  "customers", "roles", "employees", "offers", "offer_cities", "offer_flights",
  "offer_services", "offer_terms", "offer_revisions",
  "airports", "airlines", "transportation_types", "markup_rules", "ports", "drivers", "tours", "transfers", "statuses",
  "supervisors", "guide_informations", "profits", "ready_offers", "care_tickets",
  "city_climate_notes", "tour_programs", "company_suppliers", "visas",
];

/**
 * Readable by the generic engine, but NEVER writable through it.
 *
 * A permission row and an employee's section decide what a person can do, so they
 * are edited only by src/lib/data/team.ts — which checks `employees.manage` and
 * writes an audit row. The generic editor's gate is data.write, which every
 * section holds, and the database refuses these writes too (0030's RLS, 0047's
 * privileges), so this guard is the third lock rather than the only one.
 */
const READ_ONLY_TABLES: AllowedTable[] = ["employees", "roles"];

function assertTable(table: AllowedTable): void {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Table not allowed: ${table}`);
  }
}

function assertWritable(table: AllowedTable): void {
  assertTable(table);
  if (READ_ONLY_TABLES.includes(table)) {
    throw new Error(`Table is managed elsewhere: ${table}`);
  }
}

type Access = { supabase: SupabaseClient<Database>; columns: string; internal: boolean };

/**
 * The client this caller reads and writes a table through, and the columns it
 * may name (0047). pricing.internal reads the cost tables whole, through the
 * service role; anyone else uses their own session and the granted columns —
 * and gets nothing of markup_rules / profits, which ARE the margin policy.
 */
async function access(table: AllowedTable): Promise<Access | null> {
  const internal = await currentCan("pricing.internal");
  const internalOnly = INTERNAL_TABLES.includes(table);
  if (internal && (internalOnly || GRANTED_COLUMNS[table])) {
    return { supabase: createSupabaseServiceClient(), columns: "*", internal };
  }
  if (internalOnly) return null;
  return { supabase: await createSupabaseServerClient(), columns: GRANTED_COLUMNS[table]?.join(", ") ?? "*", internal };
}

/** Signed in, holds data.write, may write this table — or why not. */
async function writeAccess(table: AllowedTable): Promise<Access | TranslationKey> {
  assertWritable(table);
  const user = await getServerUser();
  if (!user) return "err.session";
  if (!(await currentCan("data.write"))) return "err.forbidden";
  return (await access(table)) ?? "err.forbidden";
}

/** A write from someone who cannot see the cost never carries it. */
function writable(table: AllowedTable, values: DataRow, internal: boolean): DataRow {
  if (internal) return values;
  return Object.fromEntries(Object.entries(values).filter(([column]) => !isCostColumn(table, column)));
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
    if (f.value === FILTER_NULL) q = q.is(f.column, null);
    else if (f.value === FILTER_NOT_NULL) q = q.not(f.column, "is", null);
    else if (f.op === "in" && Array.isArray(f.value)) q = q.in(f.column, f.value);
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
    const granted = await access(input.table);
    if (!granted) return { ok: false, error: "err.forbidden" };
    const { supabase, columns } = granted;
    const from = Math.max(input.page - 1, 0) * input.pageSize;
    const to = from + input.pageSize - 1;

    // an embed only as a screen's config names it — never a relation the browser chose
    const embed = input.select && allTableConfigs().some((c) => c.table === input.table && c.select === input.select) ? input.select : null;
    let query = supabase.from(input.table).select(embed ? `${columns}, ${embed}` : columns, { count: "exact" });
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
    const granted = await writeAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
    const { supabase, columns, internal } = granted;
    const { data, error } = await supabase
      .from(table)
      .insert(writable(table, values, internal) as never)
      .select(columns)
      .single();
    if (error) return { ok: false, error: "err.createFailed" };
    return { ok: true, row: data as unknown as DataRow };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function updateRow(table: AllowedTable, id: string, values: DataRow): Promise<MutateResult> {
  try {
    const granted = await writeAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
    const { supabase, columns, internal } = granted;
    values = writable(table, values, internal);
    // An offer total edited on /offers takes its riyal figure along, or the
    // KPIs (offerSarTotal) keep counting the one it was issued at.
    if (table === "offers" && "total" in values) {
      const { data: was } = await supabase.from("offers").select("total, total_sar, currency").eq("id", id).maybeSingle();
      if (was) {
        const row = was as { total: number | null; total_sar: number | null; currency: string | null };
        const total = values.total == null || values.total === "" ? null : Number(values.total);
        const today = row.currency && row.currency !== "SAR" ? (await getRates()).sarPer[row.currency] : 1;
        values = { ...values, total_sar: editedTotalSar(row, total, today) };
      }
    }
    const { data, error } = await supabase
      .from(table)
      .update(values as never)
      .eq("id", id)
      .select(columns)
      .single();
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true, row: data as unknown as DataRow };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteRow(table: AllowedTable, id: string): Promise<DeleteResult> {
  try {
    const granted = await writeAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
    const { error } = await granted.supabase.from(table).delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Duplicate a row (used by the "نسخ" action). */
export async function duplicateRow(table: AllowedTable, id: string): Promise<MutateResult> {
  try {
    const granted = await writeAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
    const { data, error } = await granted.supabase.from(table).select(granted.columns).eq("id", id).single();
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
  const empty: FilterOptions = { countries: [], cities: [], employees: [], suppliers: [], static: [] };
  try {
    const supabase = await createSupabaseServerClient();
    const [countries, cities, employees, suppliers] = await Promise.all([
      supabase.from("countries").select("id, arabic_name").order("arabic_name"),
      supabase.from("cities").select("id, arabic_name").order("arabic_name"),
      supabase.from("employees").select("id, arabic_name").order("arabic_name"),
      supabase.from("company_suppliers").select("id, arabic_name").order("arabic_name"),
    ]);
    type NamedRow = { id: string; arabic_name: string };
    const toOptions = (rows: unknown): { value: string; label: string }[] =>
      ((rows ?? []) as NamedRow[]).map((r) => ({ value: r.id, label: r.arabic_name }));
    return {
      countries: toOptions(countries.data),
      cities: toOptions(cities.data),
      employees: toOptions(employees.data),
      suppliers: toOptions(suppliers.data),
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
    const revenueQ = offerFilter(supabase.from("offers").select("total, total_sar, currency").eq("status", "confirmed"));
    const customersQ = supabase.from("customers").select("id", { count: "exact", head: true });
    const recentQ = offerFilter(
      supabase.from("offers").select("serial, destination, total, status, offer_date").order("offer_date", { ascending: false }).limit(6),
    );

    const [total, confirmed, revenue, customers, recent] = await Promise.all([
      totalQ, confirmedQ, revenueQ, customersQ, recentQ,
    ]);

    // labelled ر.س, so summed in riyals — never a USD total added in as SAR
    const revenueRows = (revenue.data ?? []) as Parameters<typeof offerSarTotal>[0][];
    const revenueSum = revenueRows.reduce((sum, r) => sum + offerSarTotal(r), 0);

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
