"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  GitMerge,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { airlineLogoUrl } from "@/components/offer-doc/brand";
import {
  createRow,
  deleteRow,
  duplicateRow,
  listRows,
  updateRow,
} from "@/lib/data/actions";
import { qualityIssue } from "@/lib/data/quality";
import { BOOLEAN_KEYS, coerceCell, refId } from "@/lib/data/table-csv";
import { DATA_TABLES } from "@/lib/data/table-config";
import { hotelRuleError } from "@/lib/catalog/hotel-rules";
import { normAr } from "@/lib/catalog/norm";
import type {
  ListResult,
  ColumnDef,
  DataRow,
  DataValue,
  Filter,
  FilterOption,
  FilterOptions,
  TableConfig,
} from "@/lib/data/types";
import { DataRecordExtras } from "./DataRecordExtras";
import { HotelMergeDialog, HotelUsageLine, SimilarHotelsHint, usageTotal, useHotelUsage } from "./HotelTools";
import { TableTransfer } from "./TableTransfer";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { useSafeTransition } from "./useSafeTransition";

const PAGE_SIZES = [10, 25, 50, 100];
const LTR_TYPES = new Set(["serial", "number", "currency", "date", "phone", "url"]);
/** matches nothing: a country filter on a country with no cities */
const NO_ROW = "00000000-0000-0000-0000-000000000000";

/** A cell's value — a dotted key («hotels.arabic_name») reads a row embedded by the config's `select`. */
function cellValue(row: DataRow, key: string): DataValue {
  if (!key.includes(".")) return row[key];
  let value: unknown = row;
  for (const part of key.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : null;
  return (value ?? null) as DataValue;
}

type OffersMode = "confirmed" | "unconfirmed";

/** The id → name lists (the filters' own options): a `ref` or `source` column is shown and edited by them. */
const RefOptionsContext = createContext<FilterOptions | null>(null);

export function TraveliunTable({
  config,
  filterOptions,
  initialSearch = "",
}: {
  config: TableConfig;
  filterOptions: FilterOptions;
  /** «/hotels?q=…» — a link from «يوجد فندق مشابه» opens the table on that hotel. */
  initialSearch?: string;
}) {
  const { view, t } = useTraveliunUI();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(25);
  const [search, setSearch] = useState(initialSearch);
  const [debounced, setDebounced] = useState(initialSearch.trim());
  const [filterValues, setFilterValuesState] = useState<Record<string, string>>({});
  const [dateFrom, setDateFromState] = useState("");
  const [dateTo, setDateToState] = useState("");
  const [offersMode, setOffersModeState] = useState<OffersMode>("confirmed");
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // every query input starts again from the first page
  const setPageSize = (value: number) => { setPageSizeState(value); setPage(1); };
  const setFilterValues = (updater: (prev: Record<string, string>) => Record<string, string>) => { setFilterValuesState(updater); setPage(1); };
  const setDateFrom = (value: string) => { setDateFromState(value); setPage(1); };
  const setDateTo = (value: string) => { setDateToState(value); setPage(1); };
  const setOffersMode = (value: OffersMode) => { setOffersModeState(value); setPage(1); };

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DataRow | null>(null);
  const [viewing, setViewing] = useState<DataRow | null>(null);

  // A data-quality card (/hotels?issue=…) lists the rows that have the issue; a
  // fix link (/hotels?id=…) opens one record's details straight away.
  const params = useSearchParams();
  const issueParam = qualityIssue(params.get("issue"));
  const issue = issueParam && issueParam.table === config.table ? issueParam : null;
  const onlyId = params.get("id") ?? "";
  /** the ?id= whose details already opened once — closing them must not reopen them */
  const autoOpened = useRef("");

  // «دمج» in /hotels: the rows ticked, kept across pages
  const isHotels = config.table === "hotels";
  const [selected, setSelected] = useState<Map<string, DataRow>>(new Map());
  const [merging, setMerging] = useState<DataRow[] | null>(null);

  const urlQuery = `${issue?.key ?? ""}|${onlyId}`;
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (seenUrlQuery !== urlQuery) {
    setSeenUrlQuery(urlQuery);
    setPage(1);
  }

  const hasFilters = Boolean(config.filters?.length) || config.isOffers;

  const buildFilters = useCallback((): Filter[] => {
    const list: Filter[] = [];
    if (config.fixedValues) {
      for (const [column, value] of Object.entries(config.fixedValues)) list.push({ column, op: "eq", value });
    }
    for (const def of config.filters ?? []) {
      const value = filterValues[def.key];
      if (!value) continue;
      if (def.viaCity) {
        // the row's country is its city's: the cities of that country
        const ids = filterOptions.cities.filter((c) => c.parent === value).map((c) => c.value);
        list.push({ column: "city_id", op: "in", value: ids.length ? ids : [NO_ROW] });
      } else list.push({ column: def.column ?? def.key, op: "eq", value });
    }
    if (onlyId) list.push({ column: "id", op: "eq", value: onlyId });
    if (config.isOffers) {
      // ISSUED offers only. A `draft` row was created and never published — it is
      // work in progress, and it belongs in the generator's drafts list, not in a
      // screen the office reads as "what the clients have". `cancelled` stays:
      // it WAS issued, and its own status badge says what became of it.
      list.push(
        offersMode === "confirmed"
          ? { column: "status", op: "eq", value: "confirmed" }
          : { column: "status", op: "in", value: ["sent", "cancelled"] },
      );
      if (dateFrom) list.push({ column: "offer_date", op: "gte", value: dateFrom });
      if (dateTo) list.push({ column: "offer_date", op: "lte", value: dateTo });
    }
    return list;
  }, [config, filterOptions, filterValues, offersMode, dateFrom, dateTo, onlyId]);

  // the list the screen asks for; a result belongs to exactly one request
  const request = useMemo(
    () => ({
      input: {
        table: config.table,
        page,
        pageSize,
        search: debounced || undefined,
        searchColumns: config.searchable,
        select: config.select,
        filters: buildFilters(),
        sort: config.defaultSort,
        issue: issue?.key,
      },
      reload,
    }),
    [config, page, pageSize, debounced, buildFilters, issue, reload],
  );
  const [loaded, setLoaded] = useState<{ request: typeof request; result: ListResult } | null>(null);

  useEffect(() => {
    let live = true;
    listRows(request.input)
      .then((result) => {
        if (!live) return;
        setLoaded({ request, result });
        if (onlyId && result.ok && result.rows.length === 1 && autoOpened.current !== onlyId) {
          autoOpened.current = onlyId;
          setViewing(result.rows[0]);
        }
      })
      .catch(() => live && setLoaded({ request, result: { ok: false, error: "err.db" } }));
    return () => {
      live = false;
    };
  }, [request, onlyId]);

  const current = loaded && loaded.request === request ? loaded.result : null;
  const loading = current === null;
  const rows = current?.ok ? current.rows : [];
  const count = current?.ok ? current.count : 0;
  const shownError = error ?? (current && !current.ok ? t(current.error) : null);

  function refresh() {
    setError(null);
    setReload((n) => n + 1);
  }

  // debounce the search box
  useEffect(() => {
    const next = search.trim();
    if (next === debounced) return;
    const id = window.setTimeout(() => {
      setDebounced(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, debounced]);

  const totalPages = Math.max(Math.ceil(count / pageSize), 1);
  const filtersActive = Boolean(debounced) || Object.values(filterValues).some(Boolean) || Boolean(dateFrom) || Boolean(dateTo);

  function clearFilters() {
    setSearch("");
    setDebounced("");
    setFilterValuesState({});
    setDateFromState("");
    setDateToState("");
    setPage(1);
  }

  async function onDelete(row: DataRow) {
    const id = String(row.id);
    const result = await deleteRow(config.table, id);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setViewing(null);
    refresh();
  }

  async function onDuplicate(row: DataRow) {
    const result = await duplicateRow(config.table, String(row.id));
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setViewing(null);
    refresh();
  }

  async function onStatus(row: DataRow, status: "Active" | "Inactive") {
    const result = await updateRow(config.table, String(row.id), { status });
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setViewing(null);
    refresh();
  }

  function toggle(row: DataRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      const id = String(row.id);
      if (next.has(id)) next.delete(id);
      else next.set(id, row);
      return next;
    });
  }

  const pageSelected = rows.length > 0 && rows.every((r) => selected.has(String(r.id)));
  const columnCount = config.columns.length + 1 + (isHotels ? 1 : 0);

  return (
    <RefOptionsContext.Provider value={filterOptions}>
    <TraveliunShell title={config.titleKey}>
      <div className="tv-fade-up">
        {config.isOffers ? (
          <div className="mb-3 flex justify-center">
            <div className="inline-flex overflow-hidden rounded-[11px] bg-[#e2ede9] p-1 text-sm text-[#185045]">
              {(["unconfirmed", "confirmed"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setOffersMode(mode)}
                  className={`rounded-lg px-8 py-3 font-bold transition-colors ${
                    offersMode === mode ? "bg-white text-[#185045] shadow-[0_1px_3px_rgba(0,60,58,0.12)]" : "text-[#6f8f88]"
                  }`}
                >
                  {mode === "confirmed" ? t("offers.confirmedTab") : t("offers.unconfirmedTab")}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {hasFilters ? (
          <FilterBar
            config={config}
            filterOptions={filterOptions}
            filterValues={filterValues}
            setFilterValues={setFilterValues}
            dateFrom={dateFrom}
            dateTo={dateTo}
            setDateFrom={setDateFrom}
            setDateTo={setDateTo}
          />
        ) : null}

        {issue || onlyId ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[#f3dfb0] bg-[#fff8e6] px-4 py-2.5 text-[13px] font-bold text-[#8a5a00]">
            <span>{issue ? t("data.quality.filtered", { label: t(issue.labelKey) }) : t("data.quality.oneRecord")}</span>
            <Link href={config.route} className="ms-auto text-[#185045] underline">{t("data.quality.showAll")}</Link>
          </div>
        ) : null}

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-[15px] shadow-[0_1px_2px_rgba(0,60,58,0.04),0_8px_24px_rgba(0,60,58,0.05)]">
          <div className="mb-[21px] flex flex-col flex-wrap gap-4 sm:flex-row sm:items-center">
            <div className="relative h-[46px] w-full max-w-[280px]">
              <Search className="absolute end-3 top-1/2 size-5 -translate-y-1/2 text-[#8aa29b]" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="h-full w-full rounded-[11px] border border-[#dbe6e1] bg-[#f5f8f7] pe-11 ps-4 text-sm text-[#557d78] outline-none transition-colors focus:border-[#2aa87a]"
              />
            </div>
            <button
              type="button"
              onClick={refresh}
              title={t("refresh")}
              aria-label={t("refresh")}
              className="flex size-[46px] items-center justify-center rounded-[11px] border border-[#dbe6e1] bg-white text-[#557d78] transition-colors hover:bg-[#f1f6f4] hover:text-[#185045]"
            >
              <RefreshCw className={`size-5 ${loading ? "animate-spin" : ""}`} />
            </button>
            {DATA_TABLES.includes(config.table) ? (
              <TableTransfer
                config={config}
                filterOptions={filterOptions}
                importColumns={editableColumns(config)}
                query={() => ({
                  table: config.table,
                  search: debounced || undefined,
                  searchColumns: config.searchable,
                  filters: buildFilters(),
                  sort: config.defaultSort,
                })}
                onImported={refresh}
              />
            ) : null}
            {isHotels && selected.size > 0 ? (
              <button
                type="button"
                onClick={() => setMerging([...selected.values()])}
                className="inline-flex h-[46px] items-center gap-2 rounded-[11px] border border-[#185045] bg-[#eef5f2] px-4 text-sm font-bold text-[#185045] transition-colors hover:bg-[#e2ede9]"
              >
                <GitMerge className="size-4" aria-hidden />
                {t("data.tools.merge.button", { count: selected.size })}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="me-auto inline-flex h-[46px] items-center gap-2 rounded-[11px] bg-[#185045] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0f4439]"
            >
              <Plus className="size-4" aria-hidden />
              {t("add")}
            </button>
          </div>

          {shownError ? (
            <p role="alert" className="mb-4 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
              {shownError}
            </p>
          ) : null}

          {(() => {
            const emptyState = (
              <EmptyState
                title={filtersActive ? t("noResults") : t("noData")}
                description={filtersActive ? t("noResultsDesc") : t("noDataDesc")}
                action={filtersActive ? { label: t("clearFilters"), onClick: clearFilters } : undefined}
              />
            );
            if (view === "cards") {
              return (
                <CardsView
                  loading={loading}
                  rows={rows}
                  columns={config.columns}
                  actionsLabel={t("actions")}
                  onAction={setViewing}
                  empty={emptyState}
                />
              );
            }
            return (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-start text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-[#185045] text-white">
                      {isHotels ? (
                        <th className="w-[44px] px-[14px] py-[15px]">
                          <input
                            type="checkbox"
                            checked={pageSelected}
                            aria-label={t("data.tools.selectPage")}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Map(prev);
                                for (const r of rows) {
                                  if (pageSelected) next.delete(String(r.id));
                                  else next.set(String(r.id), r);
                                }
                                return next;
                              })
                            }
                          />
                        </th>
                      ) : null}
                      <th className="w-[52px] px-[18px] py-[15px]" />
                      {config.columns.map((column) => (
                        <th key={column.key} className={`px-[14px] py-[15px] text-[11.5px] font-bold tracking-[0.02em] ${minWidthClass(column.minWidth)}`}>
                          {t(column.labelKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, rowIndex) => (
                        <tr key={`sk-${rowIndex}`} className="border-b border-[#eef2f0]">
                          {isHotels ? <td /> : null}
                          <td className="px-[18px] py-[19px]"><div className="tv-shimmer size-[18px] rounded-md" /></td>
                          {config.columns.map((column) => (
                            <td key={column.key} className="px-[14px] py-[19px]"><div className="tv-shimmer h-[13px] w-24 rounded-md" /></td>
                          ))}
                        </tr>
                      ))
                    ) : rows.length > 0 ? (
                      rows.map((row) => (
                        <tr key={String(row.id)} className="cursor-pointer border-b border-[#eef2f0] text-[#557d78] transition-colors hover:bg-[#f6faf8]">
                          {isHotels ? (
                            <td className="px-[14px] py-[17px]">
                              <input
                                type="checkbox"
                                checked={selected.has(String(row.id))}
                                onChange={() => toggle(row)}
                                aria-label={t("data.tools.selectRow", { name: String(row.arabic_name ?? "") })}
                              />
                            </td>
                          ) : null}
                          <td className="px-[18px] py-[17px] text-[#a4b8b2]">
                            <button
                              type="button"
                              onClick={() => setViewing(row)}
                              className="flex size-[30px] items-center justify-center rounded-lg transition-colors hover:bg-[#e8f1ed] hover:text-[#185045]"
                              aria-label={t("actions")}
                            >
                              <Settings className="size-5" />
                            </button>
                          </td>
                          {config.columns.map((column) => (
                            <td key={column.key} className="px-[14px] py-[17px] align-middle leading-6">
                              <Cell column={column} row={row} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={columnCount} className="p-0">{emptyState}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <Footer
            count={count}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            setPage={setPage}
            setPageSize={setPageSize}
          />
        </section>
      </div>

      {adding ? (
        <RecordForm
          title={t("addRecord")}
          config={config}
          filterOptions={filterOptions}
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            // A row added while a country is filtered belongs to that country
            // (a Thailand-only term, a city in it); no filter → a global row.
            const country = filterValues["country_id"];
            // a country chosen in the form itself wins over the filter's
            const payload = { ...values, ...(country && values.country_id == null ? { country_id: country } : {}), ...(config.fixedValues ?? {}) };
            const result = await createRow(config.table, payload);
            if (!result.ok) return t(result.error);
            refresh();
            return null;
          }}
        />
      ) : null}

      {editing ? (
        <RecordForm
          title={t("editRecord")}
          config={config}
          filterOptions={filterOptions}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const result = await updateRow(config.table, String(editing.id), values);
            if (!result.ok) return t(result.error);
            refresh();
            return null;
          }}
        />
      ) : null}

      {viewing ? (
        <RowActionModal
          row={viewing}
          config={config}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onCopy={() => onDuplicate(viewing)}
          onDelete={() => onDelete(viewing)}
          onMerge={isHotels ? () => { setMerging([viewing]); setViewing(null); } : undefined}
          onStatus={isHotels ? (status) => onStatus(viewing, status) : undefined}
        />
      ) : null}

      {merging ? (
        <HotelMergeDialog
          candidates={merging}
          cities={filterOptions.cities}
          onClose={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            setSelected(new Map());
            refresh();
          }}
        />
      ) : null}
    </TraveliunShell>
    </RefOptionsContext.Provider>
  );
}

function CardsView({
  loading,
  rows,
  columns,
  actionsLabel,
  onAction,
  empty,
}: {
  loading: boolean;
  rows: DataRow[];
  columns: ColumnDef[];
  actionsLabel: string;
  onAction: (row: DataRow) => void;
  empty: React.ReactNode;
}) {
  const { t } = useTraveliunUI();
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-[14px] border border-[#e2ebe7] bg-white p-4">
            <div className="tv-shimmer mb-3 h-4 w-28 rounded-md" />
            <div className="tv-shimmer mb-2 h-3 w-full rounded-md" />
            <div className="tv-shimmer h-3 w-2/3 rounded-md" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <div>{empty}</div>;

  const primary = columns[0];
  const rest = columns.slice(1);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <article key={String(row.id)} className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 text-[15px] font-extrabold text-[#003c3a]">
              {primary ? <Cell column={primary} row={row} /> : null}
            </div>
            <button
              type="button"
              onClick={() => onAction(row)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#e2ebe7] text-[#8aa29b] transition-colors hover:bg-[#e8f1ed] hover:text-[#185045]"
              aria-label={actionsLabel}
            >
              <Settings className="size-4" />
            </button>
          </div>
          <dl className="grid gap-1.5">
            {rest.map((column) => (
              <div key={column.key} className="flex items-start justify-between gap-3 text-[13px]">
                <dt className="shrink-0 font-semibold text-[#93aaa3]">{t(column.labelKey)}</dt>
                <dd className="min-w-0 text-end font-medium text-[#0f3d38]"><Cell column={column} row={row} /></dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

function Cell({ column, row }: { column: ColumnDef; row: DataRow }) {
  const { t } = useTraveliunUI();
  const refs = useContext(RefOptionsContext);
  const value: DataValue = column.ref && refs
    ? (() => {
        const id = refId(column, row, refs.cities);
        return id ? (refs[column.ref].find((o) => o.value === id)?.label ?? id) : null;
      })()
    : cellValue(row, column.key);
  if (value === null || value === undefined || value === "") return <span className="text-[#c2cfca]">—</span>;
  // an id shown by its name; a fixed option by its label
  if (column.source) return <span>{refs?.[column.source].find((o) => o.value === value)?.label ?? String(value)}</span>;
  const option = column.options?.find((o) => o.value === value);
  if (option?.labelKey) return <span>{t(option.labelKey)}</span>;
  if (column.type === "status") {
    const word = String(value).trim().toLowerCase();
    if (word === "active" || word === "inactive") {
      return <StatusBadge tone={word === "active" ? "confirmed" : "cancelled"} label={t(word === "active" ? "data.tools.active" : "data.tools.inactive")} />;
    }
    return <StatusBadge tone={statusTone(String(value))} />;
  }
  // A carrier's mark, from its path in the public bucket. Drawn small and
  // contained: the row height must not follow the image.
  if (column.type === "logo") {
    const url = airlineLogoUrl(String(value));
    if (!url) return <span className="text-[#c2cfca]">—</span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-6 w-14 object-contain object-center" />;
  }
  if (BOOLEAN_KEYS.has(column.key) || typeof value === "boolean") {
    const truthy = value === true || value === "true" || value === "Yes";
    return <span className={truthy ? "font-bold text-[#0f7a52]" : "text-[#8aa29b]"}>{truthy ? t("yes") : t("no")}</span>;
  }
  if (column.type && LTR_TYPES.has(column.type)) {
    const numeric = column.type === "number" || column.type === "currency" || column.type === "serial" || column.type === "date";
    return <DirText dir="ltr" className={numeric ? "tv-tnum" : undefined}>{String(value)}</DirText>;
  }
  return <span>{String(value)}</span>;
}

function FilterBar({
  config,
  filterOptions,
  filterValues,
  setFilterValues,
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
}: {
  config: TableConfig;
  filterOptions: FilterOptions;
  filterValues: Record<string, string>;
  setFilterValues: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
}) {
  const { t } = useTraveliunUI();
  return (
    <section className="mb-3 rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {config.isOffers ? (
          <>
            <label className="grid gap-2 text-[13px] font-bold text-[#185045]">
              {t("filter.dateFrom")}
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-2 text-[13px] font-bold text-[#185045]">
              {t("filter.dateTo")}
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={fieldClass} />
            </label>
          </>
        ) : null}
        {(config.filters ?? []).map((def) => {
          let options: FilterOption[] = def.source ? filterOptions[def.source] : (def.options ?? []);
          // with a country chosen, the city list is that country's cities
          const country = filterValues["country_id"];
          if (def.source === "cities" && country && config.filters?.some((f) => f.viaCity)) {
            options = options.filter((o) => o.parent === country);
          }
          return (
            <label key={def.key} className="grid gap-2 text-[13px] font-bold text-[#185045]">
              {t(def.labelKey)}
              <select
                value={filterValues[def.key] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  // a new country clears a city of the old one
                  setFilterValues((prev) => ({ ...prev, [def.key]: value, ...(def.viaCity ? { city_id: "" } : {}) }));
                }}
                className={fieldClass}
              >
                <option value="">{t("all")}</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.labelKey ? t(opt.labelKey) : opt.label}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function Footer({
  count,
  page,
  pageSize,
  totalPages,
  setPage,
  setPageSize,
}: {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  setPage: (updater: (prev: number) => number) => void;
  setPageSize: (value: number) => void;
}) {
  const { t } = useTraveliunUI();
  const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => windowStart + i).filter((p) => p <= totalPages);

  return (
    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-[12.5px] font-semibold text-[#8aa29b]">
        <span>
          {t("showing")} <span className="font-bold text-[#185045]">{count === 0 ? 0 : (page - 1) * pageSize + 1}</span>
          {" – "}
          <span className="font-bold text-[#185045]">{Math.min(page * pageSize, count)}</span>
          {" "}{t("of")}{" "}
          <span className="font-bold text-[#185045]">{count}</span>
        </span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          aria-label={t("data.tools.pageSize")}
          className="h-[34px] rounded-md border border-[#dbe6e1] bg-white px-2 text-sm text-[#185045] outline-none"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label={t("data.tools.pager")}>
        <PagerButton icon={ChevronsRight} label={t("data.tools.firstPage")} disabled={page <= 1} onClick={() => setPage(() => 1)} />
        <PagerButton icon={ChevronRight} label={t("data.tools.prevPage")} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(() => p)}
            aria-current={p === page ? "page" : undefined}
            className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm ${
              p === page ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
            }`}
          >
            {p}
          </button>
        ))}
        <PagerButton icon={ChevronLeft} label={t("data.tools.nextPage")} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
        <PagerButton icon={ChevronsLeft} label={t("data.tools.lastPage")} disabled={page >= totalPages} onClick={() => setPage(() => totalPages)} />
      </nav>
    </div>
  );
}

function PagerButton({ icon: Icon, label, disabled, onClick }: { icon: typeof ChevronLeft; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-[#dbe6e1] bg-white text-[#8ca49e] transition-colors hover:bg-[#f4f8f6] disabled:opacity-40"
    >
      <Icon className="size-5" />
    </button>
  );
}

function editableColumns(config: TableConfig): ColumnDef[] {
  return config.columns.filter((c) => c.editable !== false && c.type !== "status");
}

function RecordForm({
  title,
  config,
  filterOptions,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  config: TableConfig;
  filterOptions: FilterOptions;
  initial?: DataRow;
  onClose: () => void;
  onSubmit: (values: DataRow) => Promise<string | null>;
}) {
  const { t, dir } = useTraveliunUI();
  const columns = editableColumns(config);
  const isHotels = config.table === "hotels";
  // shown, not typed: a hotel's country is its city's
  const derived = config.columns.find((c) => c.ref === "countries" && c.editable === false);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, initial && initial[c.key] != null ? String(initial[c.key]) : ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const values: DataRow = {};
    for (const column of columns) {
      const raw = form[column.key] ?? "";
      values[column.key] = column.ref ? raw || null : coerceCell(column, raw);
    }
    const broken = isHotels ? hotelRuleError(values, !initial) : null;
    if (broken) {
      setError(t(broken));
      return;
    }
    setSaving(true);
    const err = await onSubmit(values);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  const required = (key: string) => isHotels && (key === "arabic_name" || key === "city_id");

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true" dir={dir}>
      <form onSubmit={submit} className="max-h-[calc(90vh/var(--tv-zoom))] w-full max-w-[860px] overflow-y-auto rounded-2xl border border-[#e2ebe7] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mb-5 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
          <div>
            <h2 className="text-lg font-extrabold">{title}</h2>
            <p className="mt-1 text-sm text-[#6d8a84]">{t(config.titleKey)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}><X className="size-5" /></button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {columns.map((column) => (
            <label key={column.key} className="grid gap-2 text-sm font-semibold">
              <span>
                {t(column.labelKey)}
                {required(column.key) ? <span className="text-[#c22850]" aria-hidden> *</span> : null}
              </span>
              {column.ref ? (
                <RefSelect
                  options={filterOptions[column.ref]}
                  countries={filterOptions.countries}
                  value={form[column.key] ?? ""}
                  required={required(column.key)}
                  onChange={(v) => setForm((prev) => ({ ...prev, [column.key]: v }))}
                />
              ) : (
                <FieldInput
                  column={column}
                  value={form[column.key] ?? ""}
                  required={required(column.key)}
                  onChange={(v) => setForm((prev) => ({ ...prev, [column.key]: v }))}
                />
              )}
            </label>
          ))}
          {derived ? (
            <div className="grid gap-2 text-sm font-semibold">
              <span>{t(derived.labelKey)}</span>
              <p className="flex h-11 items-center rounded-[10px] border border-dashed border-[#d8e3de] px-3 font-normal text-[#557d78]">
                {filterOptions.countries.find((c) => c.value === filterOptions.cities.find((x) => x.value === form.city_id)?.parent)?.label ??
                  t("data.tools.countryFromCity")}
              </p>
            </div>
          ) : null}
        </div>

        {isHotels ? (
          <SimilarHotelsHint
            arabic={form.arabic_name ?? ""}
            english={form.english_name ?? ""}
            cityId={form.city_id ?? ""}
            excludeId={initial ? String(initial.id) : undefined}
            cities={filterOptions.cities}
          />
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[13px] font-semibold text-[#c22850]">{error}</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-[#d8e3de] px-5 text-sm font-semibold text-[#185045] hover:bg-[#f4f8f6]">{t("cancel")}</button>
          <button type="submit" disabled={saving} className="flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-6 text-sm font-bold text-white hover:bg-[#0f4439] disabled:opacity-70">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A long list (every city) narrowed by typing, then picked from a native select. */
function RefSelect({
  options,
  countries,
  value,
  required,
  onChange,
}: {
  options: FilterOption[];
  countries: FilterOption[];
  value: string;
  required: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const countryName = useMemo(() => new Map(countries.map((c) => [c.value, c.label])), [countries]);
  const folded = normAr(query);
  const shown = options.filter(
    (o) => o.value === value || !folded || normAr(o.label).includes(folded) || normAr(countryName.get(o.parent ?? "")).includes(folded),
  );
  return (
    <span className="grid gap-1.5">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("data.tools.refSearch")}
        aria-label={t("data.tools.refSearch")}
        className={`${formField} h-9`}
      />
      <select value={value} required={required} onChange={(e) => onChange(e.target.value)} className={formField}>
        <option value="">{t("chooseOption")}</option>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.parent && countryName.get(o.parent) ? ` — ${countryName.get(o.parent)}` : ""}
          </option>
        ))}
      </select>
    </span>
  );
}

function FieldInput({ column, value, required, onChange }: { column: ColumnDef; value: string; required?: boolean; onChange: (value: string) => void }) {
  const { t } = useTraveliunUI();
  const lookups = useContext(RefOptionsContext);
  if (BOOLEAN_KEYS.has(column.key)) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={formField}>
        <option value="true">{t("yes")}</option>
        <option value="false">{t("no")}</option>
      </select>
    );
  }
  const choices = column.source ? (lookups?.[column.source] ?? []) : column.options;
  if (choices) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={formField}>
        <option value="">{t("chooseOption")}</option>
        {choices.map((opt) => (<option key={opt.value} value={opt.value}>{opt.labelKey ? t(opt.labelKey) : opt.label}</option>))}
      </select>
    );
  }
  const inputType = column.type === "number" || column.type === "currency" ? "number" : column.type === "date" ? "date" : "text";
  const dir = column.type && LTR_TYPES.has(column.type) ? "ltr" : "rtl";
  return (
    <input
      type={inputType}
      dir={dir}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      className={`${formField} ${dir === "ltr" ? "text-start" : ""}`}
    />
  );
}

function RowActionModal({
  row,
  config,
  onClose,
  onEdit,
  onCopy,
  onDelete,
  onMerge,
  onStatus,
}: {
  row: DataRow;
  config: TableConfig;
  onClose: () => void;
  onEdit: () => void;
  onCopy: () => Promise<void>;
  onDelete: () => Promise<void>;
  /** /hotels: merge this hotel into another */
  onMerge?: () => void;
  /** /hotels: stop / restart it instead of deleting it */
  onStatus?: (status: "Active" | "Inactive") => Promise<void>;
}) {
  const { t, dir } = useTraveliunUI();
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useSafeTransition();
  const usage = useHotelUsage(onMerge ? String(row.id) : null);
  const inUse = usageTotal(usage) > 0;
  const inactive = String(row.status ?? "").toLowerCase() === "inactive";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" dir={dir}>
      <div className="max-h-[calc(90vh/var(--tv-zoom))] w-full max-w-[620px] overflow-y-auto rounded-2xl border border-[#e2ebe7] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
          <h2 className="text-lg font-extrabold">{t("details")}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}><X className="size-5" /></button>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {config.columns.map((column) => (
            <div key={column.key} className="rounded-[10px] bg-[#f4f8f6] p-3">
              <p className="mb-1 text-xs font-bold text-[#93aaa3]">{t(column.labelKey)}</p>
              <div className="text-sm"><Cell column={column} row={row} /></div>
            </div>
          ))}
          {onMerge ? (
            <div className="rounded-[10px] bg-[#f4f8f6] p-3 md:col-span-2">
              <p className="mb-1 text-xs font-bold text-[#93aaa3]">{t("data.tools.usage.title")}</p>
              <div className="text-sm"><HotelUsageLine usage={usage} /></div>
            </div>
          ) : null}
        </div>

        <DataRecordExtras config={config} row={row} />

        {confirming && onMerge && inUse ? (
          // used: never deleted — merged into its twin, or stopped
          <div className="rounded-[10px] border border-[#f1dca7] bg-[#fff8e6] p-4">
            <p className="mb-3 text-sm font-bold text-[#7a5a12]">{t("data.tools.err.hotelInUse")}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-[10px] border border-[#d8e3de] px-4 text-sm font-semibold">{t("cancel")}</button>
              <button type="button" onClick={onMerge} className="flex h-10 items-center gap-2 rounded-[10px] border border-[#185045] px-4 text-sm font-bold">
                <GitMerge className="size-4" aria-hidden /> {t("data.tools.merge.action")}
              </button>
              {onStatus && !inactive ? (
                <button type="button" disabled={busy} onClick={() => start(() => onStatus("Inactive"))} className="flex h-10 items-center gap-2 rounded-[10px] bg-[#7a5a12] px-4 text-sm font-bold text-white disabled:opacity-70">
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Power className="size-4" aria-hidden />} {t("data.tools.deactivate")}
                </button>
              ) : null}
            </div>
          </div>
        ) : confirming ? (
          <div className="rounded-[10px] border border-[#f2d0d7] bg-[#fdeef2] p-4">
            <p className="mb-3 text-sm font-bold text-[#c22850]">{t("confirmDeleteHint")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-[10px] border border-[#d8e3de] px-4 text-sm font-semibold text-[#185045]">{t("cancel")}</button>
              <button type="button" disabled={busy || Boolean(onMerge && !usage)} onClick={() => start(onDelete)} className="flex h-10 items-center gap-2 rounded-[10px] bg-[#c43d5a] px-5 text-sm font-bold text-white hover:bg-[#a82f49] disabled:opacity-70">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} {t("confirmDelete")}
              </button>
            </div>
          </div>
        ) : (
          <div className={`grid gap-2 ${onMerge ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <button type="button" onClick={onEdit} className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#185045] text-sm font-bold text-white hover:bg-[#0f4439]">
              <Eye className="size-4" /> {t("edit")}
            </button>
            <button type="button" disabled={busy} onClick={() => start(onCopy)} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#d8e3de] text-sm font-bold hover:bg-[#f4f8f6] disabled:opacity-70">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />} {t("copy")}
            </button>
            {onMerge ? (
              <button type="button" onClick={onMerge} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#d8e3de] text-sm font-bold hover:bg-[#f4f8f6]">
                <GitMerge className="size-4" aria-hidden /> {t("data.tools.merge.action")}
              </button>
            ) : null}
            <button type="button" onClick={() => setConfirming(true)} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#f2c7c7] text-sm font-bold text-[#c43d3d] hover:bg-[#fff1f1]">
              <Trash2 className="size-4" /> {t("delete")}
            </button>
            {onStatus && inactive ? (
              <button type="button" disabled={busy} onClick={() => start(() => onStatus("Active"))} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#185045] text-sm font-bold sm:col-span-4 disabled:opacity-70">
                <Power className="size-4" aria-hidden /> {t("data.tools.activate")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function minWidthClass(width?: string): string {
  switch (width) {
    case "170px": return "min-w-[170px]";
    case "180px": return "min-w-[180px]";
    case "200px": return "min-w-[200px]";
    case "220px": return "min-w-[220px]";
    case "260px": return "min-w-[260px]";
    case "280px": return "min-w-[280px]";
    case "300px": return "min-w-[300px]";
    default: return "min-w-[120px]";
  }
}

const fieldClass =
  "flex h-[46px] items-center rounded-[11px] border border-[#dbe6e1] bg-white px-3 text-sm font-normal text-[#557d78] outline-none transition-colors focus:border-[#2aa87a]";
const formField =
  "h-11 rounded-[10px] border border-[#d8e3de] bg-[#f8fbf9] px-3 text-sm font-normal text-[#185045] outline-none transition-colors focus:border-[#185045]";
