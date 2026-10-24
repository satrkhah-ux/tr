"use server";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { editedTotalSar, offerSarTotal } from "@/lib/offer/pricing";
import { getRates } from "./rates-actions";
import { allTableConfigs, DATA_TABLES, GRANTED_COLUMNS, INTERNAL_TABLES, SEARCH_KEY_TABLES, isCostColumn } from "./table-config";
import { FILTER_NOT_NULL, FILTER_NULL } from "./types";
import { catalogSkel, normAr } from "@/lib/catalog/norm";
import { hotelRuleError } from "@/lib/catalog/hotel-rules";
import { getHotelUsage } from "./hotel-tools";
import { issueVouchersForHotel } from "./wizard-sync";
import { logAudit } from "./audit";
import { diffRecord, issueRowsFunction } from "./quality";
import { OFFER_LOCKED_COLUMNS, OFFER_OWNER_COLUMNS, changedLockedColumns } from "@/lib/offer/locked-columns";
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
  "supervisors", "guide_informations", "profits", "care_tickets",
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

/**
 * Deleting a row, and importing a whole file, are the administration's
 * (settings.manage): «البيانات» is data.write for sales — view, add, edit — and
 * nothing more (owner, 2026-10-17). The database says the same for the
 * catalogue's DELETE (0079). The table hides the controls (TraveliunTable).
 */
async function manageAccess(table: AllowedTable): Promise<Access | TranslationKey> {
  const granted = await writeAccess(table);
  if (typeof granted === "string") return granted;
  return (await currentCan("settings.manage")) ? granted : "err.forbidden";
}

/** A write from someone who cannot see the cost never carries it. */
function writable(table: AllowedTable, values: DataRow, internal: boolean): DataRow {
  if (internal) return values;
  return Object.fromEntries(Object.entries(values).filter(([column]) => !isCostColumn(table, column)));
}

function without(values: DataRow, columns: readonly string[]): DataRow {
  return Object.fromEntries(Object.entries(values).filter(([column]) => !columns.includes(column)));
}

/**
 * Every create / update / delete is written to audit_logs (entity = the table,
 * entity_id = the row) — the change log in a record's details (data order 11.3).
 * Values a details screen must not read back — a cost, the margin policy, a
 * client's personal data — are logged by column name only.
 */
function auditMask(table: AllowedTable): (column: string) => boolean {
  return (column) => table === "customers" || INTERNAL_TABLES.includes(table) || isCostColumn(table, column);
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

/** How the search box matches: on the folded `search_key` (0070), or ilike on the columns. */
type SearchPlan = { key: string } | { columns: string[]; term: string } | null;

/**
 * On a SEARCH_KEY_TABLES table the box first matches the folded term (ة/ه، ى/ي،
 * أ/إ/آ/ا، diacritics); only when that finds nothing, its skeleton («ملينيوم» →
 * «ميلينيوم»). Plain ilike on `searchable` everywhere else — and wherever the
 * computed field errors, i.e. a database 0070 has not reached.
 */
function searchPlans(input: ListInput): { folded: SearchPlan; skeleton: SearchPlan; plain: SearchPlan } {
  const term = input.search ? sanitizeSearch(input.search) : "";
  const plain: SearchPlan = term && input.searchColumns?.length ? { columns: input.searchColumns, term } : null;
  if (!term || !SEARCH_KEY_TABLES.includes(input.table)) return { folded: plain, skeleton: null, plain };
  const skeleton = catalogSkel(term);
  return { folded: { key: sanitizeSearch(normAr(term)) }, skeleton: skeleton.length >= 3 ? { key: skeleton } : null, plain };
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

    // A data-quality card's rows (/hotels?issue=…): the table's own row type out
    // of 0071's function, so the filters, search, paging and count apply
    // unchanged — and the card's number is this list's count.
    const issueFn = input.issue ? issueRowsFunction(input.table, input.issue) : null;
    if (input.issue && !issueFn) return { ok: false, error: "err.forbidden" };
    // an embed only as a screen's config names it — never a relation the browser chose
    const embed = input.select && allTableConfigs().some((c) => c.table === input.table && c.select === input.select) ? input.select : null;
    const selection = embed ? `${columns}, ${embed}` : columns;

    const run = (plan: SearchPlan) => {
      let query = supabase.from(input.table).select(selection, { count: "exact" });
      if (issueFn) {
        query = (supabase as unknown as SupabaseClient)
          .rpc(issueFn, { p_issue: input.issue }, { count: "exact" })
          .select(selection) as unknown as typeof query;
      }
      query = applyFilters(query, input.filters);
      if (plan && "key" in plan) query = query.ilike("search_key" as never, `%${plan.key}%`);
      else if (plan) query = query.or(plan.columns.map((col) => `${col}.ilike.%${plan.term}%`).join(","));
      // an issue list comes ranked by the function (hotels: most used first)
      if (input.sort && !issueFn) query = query.order(input.sort.column, { ascending: input.sort.ascending });
      return query.range(from, to);
    };

    const plans = searchPlans(input);
    let result = await run(plans.folded);
    if (plans.folded && "key" in plans.folded) {
      if (result.error) result = await run(plans.plain);
      else if (result.count === 0 && plans.skeleton) result = await run(plans.skeleton);
    }
    if (result.error) return { ok: false, error: "err.loadFailed" };
    return { ok: true, rows: (result.data ?? []) as unknown as DataRow[], count: result.count ?? 0 };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Every row the screen's search and filters select — for «تصدير Excel». Capped at 20,000. */
export async function exportRows(input: Omit<ListInput, "page" | "pageSize">): Promise<ListResult> {
  if (!DATA_TABLES.includes(input.table)) return { ok: false, error: "err.forbidden" };
  const rows: DataRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await listRows({ ...input, page, pageSize: 1000 });
    if (!result.ok) return result;
    rows.push(...result.rows);
    if (rows.length >= result.count || result.rows.length < 1000) break;
  }
  return { ok: true, rows, count: rows.length };
}

/** The rows an import names by id — what its diff is taken against. */
export async function getRowsByIds(table: AllowedTable, ids: string[], fixedValues?: DataRow): Promise<ListResult> {
  try {
    assertTable(table);
    const granted = await access(table);
    if (!granted) return { ok: false, error: "err.forbidden" };
    const fixed: Filter[] = Object.entries(fixedValues ?? {}).map(([column, value]) => ({ column, op: "eq", value }));
    const rows: DataRow[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const query = applyFilters(granted.supabase.from(table).select(granted.columns).in("id", ids.slice(i, i + 150)), fixed);
      const { data, error } = await query;
      if (error) return { ok: false, error: "err.loadFailed" };
      rows.push(...((data ?? []) as unknown as DataRow[]));
    }
    return { ok: true, rows, count: rows.length };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ImportRowsResult =
  | { ok: true; created: number; updated: number; failed: { index: number; kind: "create" | "update"; error: TranslationKey }[] }
  | { ok: false; error: TranslationKey };

/**
 * Save a previewed import: new rows added, changed fields written — nothing
 * deleted. settings.manage to start (manageAccess); then row by row through
 * createRow / updateRow, so every rule (data.write,
 * the cost columns, the hotel rules) holds exactly as for the form. Not one
 * transaction: a row that fails is reported and the others stand.
 */
export async function importRows(
  table: AllowedTable,
  creates: DataRow[],
  updates: { id: string; changes: DataRow }[],
): Promise<ImportRowsResult> {
  if (!DATA_TABLES.includes(table)) return { ok: false, error: "err.forbidden" };
  try {
    const granted = await manageAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
  } catch {
    return { ok: false, error: "err.forbidden" };
  }
  if (creates.length + updates.length > 5000) return { ok: false, error: "data.tools.import.tooMany" };
  const failed: { index: number; kind: "create" | "update"; error: TranslationKey }[] = [];
  const jobs = [
    ...creates.map((values, index) => async () => {
      const r = await createRow(table, values);
      if (!r.ok) failed.push({ index, kind: "create", error: r.error });
    }),
    ...updates.map((u, index) => async () => {
      const r = await updateRow(table, u.id, u.changes);
      if (!r.ok) failed.push({ index, kind: "update", error: r.error });
    }),
  ];
  // eight at a time: a few hundred rows in seconds, without flooding PostgREST
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((job) => job()));
  const created = creates.length - failed.filter((f) => f.kind === "create").length;
  const updated = updates.length - failed.filter((f) => f.kind === "update").length;
  await logAudit({ action: "catalog.imported", entity: table, entity_id: "table-import", meta: { created, updated, failed: failed.length } });
  return { ok: true, created, updated, failed };
}

/** The /hotels rules (hotel-rules.ts), and the country taken from the city. */
async function hotelWrite(
  supabase: SupabaseClient<Database>,
  values: DataRow,
  creating: boolean,
): Promise<DataRow | TranslationKey> {
  const broken = hotelRuleError(values, creating);
  if (broken) return broken;
  if (!values.city_id) return values;
  const { data } = await supabase.from("cities").select("country_id").eq("id", String(values.city_id)).maybeSingle();
  if (!data) return "data.tools.err.cityRequired";
  return { ...values, country_id: (data as { country_id: string | null }).country_id };
}

/**
 * A visa's country: picked, and its name written from the pick. Murad opens the
 * client's answer with `country` («تأشيرة فرنسا») and matches on it, so a copy of
 * France switched to Spain must not go on saying France.
 */
async function visaWrite(
  supabase: SupabaseClient<Database>,
  values: DataRow,
  creating: boolean,
): Promise<DataRow | TranslationKey> {
  if (!("country_id" in values)) return creating ? "data.visas.err.country" : values;
  if (!values.country_id) return "data.visas.err.country";
  const { data } = await supabase.from("countries").select("arabic_name").eq("id", String(values.country_id)).maybeSingle();
  if (!data) return "data.visas.err.country";
  return { ...values, country: (data as { arabic_name: string }).arabic_name };
}

export async function createRow(table: AllowedTable, values: DataRow): Promise<MutateResult> {
  try {
    const granted = await writeAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
    const { supabase, columns, internal } = granted;
    if (table === "hotels" || table === "visas") {
      const checked = await (table === "hotels" ? hotelWrite : visaWrite)(supabase, values, true);
      if (typeof checked === "string") return { ok: false, error: checked };
      values = checked;
    }
    // an offer's company and what it owes are the producer's (offer-insert.ts) —
    // never a form's, nor a copy's (duplicateRow) of a partner's file
    const written = writable(table, table === "offers" ? without(values, OFFER_OWNER_COLUMNS) : values, internal);
    const { data, error } = await supabase
      .from(table)
      .insert(written as never)
      .select(columns)
      .single();
    if (error) return { ok: false, error: "err.createFailed" };
    const row = data as unknown as DataRow;
    await logAudit({ action: "data.created", entity: table, entity_id: String(row.id), meta: { changes: diffRecord({}, written, auditMask(table)) } });
    return { ok: true, row };
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
    // 0073: sessions cannot UPDATE an offer's owner or money. The total and the
    // customer move for offers.write, through the service role; the company and
    // what it owes, never from here. Untouched ones are dropped — the form sends
    // every field it shows, total included.
    let writer = supabase;
    if (table === "offers") {
      const { data: stored } = await supabase.from("offers").select([...OFFER_LOCKED_COLUMNS, "employee_id"].join(", ")).eq("id", id).maybeSingle();
      const changed = changedLockedColumns(values, stored as unknown as Record<string, unknown> | null);
      if (changed.some((column) => (OFFER_OWNER_COLUMNS as readonly string[]).includes(column))) return { ok: false, error: "err.forbidden" };
      // the issuer is «my file» in operations (0078/0080). No form carries it, and
      // a total edit below goes through the service role, past the database's check.
      const issuer = (stored as { employee_id?: string | null } | null)?.employee_id ?? null;
      if ("employee_id" in values && (values.employee_id || null) !== issuer && !(await currentCan("operations.write"))) {
        return { ok: false, error: "err.forbidden" };
      }
      if (changed.length === 0) values = without(values, OFFER_LOCKED_COLUMNS);
      else if (await currentCan("offers.write")) writer = createSupabaseServiceClient();
      else return { ok: false, error: "err.forbidden" };
    }
    if (table === "hotels" || table === "visas") {
      const checked = await (table === "hotels" ? hotelWrite : visaWrite)(supabase, values, false);
      if (typeof checked === "string") return { ok: false, error: checked };
      values = checked;
    }
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
    // what the row held, for the change log
    const fields = Object.keys(values).filter((column) => /^[a-z_][a-z0-9_]*$/.test(column));
    const { data: before } = fields.length
      ? await writer.from(table).select(fields.join(", ")).eq("id", id).maybeSingle()
      : { data: null };
    const { data, error } = await writer
      .from(table)
      .update(values as never)
      .eq("id", id)
      .select(columns)
      .single();
    if (error) return { ok: false, error: "err.updateFailed" };
    const changes = diffRecord((before ?? {}) as unknown as DataRow, values, auditMask(table));
    if (Object.keys(changes).length > 0) {
      await logAudit({ action: "data.updated", entity: table, entity_id: id, meta: { changes } });
    }
    // a hotel's name given: the vouchers that waited on it go out (the owner, 2026-10-23)
    if (table === "hotels" && ("english_name" in changes || "arabic_name" in changes)) after(() => issueVouchersForHotel(id));
    return { ok: true, row: data as unknown as DataRow };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteRow(table: AllowedTable, id: string): Promise<DeleteResult> {
  try {
    const granted = await manageAccess(table);
    if (typeof granted === "string") return { ok: false, error: granted };
    // A hotel an offer, a draft, a remembered price or a booking uses is merged or
    // stopped, never deleted: the FKs would quietly null the offers' hotel.
    if (table === "hotels") {
      const used = await getHotelUsage(id);
      if (!used.ok) return { ok: false, error: used.error };
      if (Object.values(used.usage).some((n) => n > 0)) return { ok: false, error: "data.tools.err.hotelInUse" };
    }
    const { error } = await granted.supabase.from(table).delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };
    await logAudit({ action: "data.deleted", entity: table, entity_id: id });
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
      supabase.from("cities").select("id, arabic_name, country_id").order("arabic_name"),
      supabase.from("employees").select("id, arabic_name").order("arabic_name"),
      supabase.from("company_suppliers").select("id, arabic_name").order("arabic_name"),
    ]);
    type NamedRow = { id: string; arabic_name: string };
    const toOptions = (rows: unknown): { value: string; label: string }[] =>
      ((rows ?? []) as NamedRow[]).map((r) => ({ value: r.id, label: r.arabic_name }));
    return {
      countries: toOptions(countries.data),
      // a city carries its country: the hotel form shows it, the country filter goes through it
      cities: ((cities.data ?? []) as (NamedRow & { country_id: string | null })[]).map((r) => ({
        value: r.id,
        label: r.arabic_name,
        parent: r.country_id,
      })),
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
