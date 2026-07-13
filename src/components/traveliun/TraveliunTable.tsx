"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import {
  createRow,
  deleteRow,
  duplicateRow,
  listRows,
  updateRow,
} from "@/lib/data/actions";
import type {
  ColumnDef,
  DataRow,
  DataValue,
  Filter,
  FilterOptions,
  TableConfig,
} from "@/lib/data/types";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

const PAGE_SIZES = [10, 25, 50, 100];
const BOOLEAN_KEYS = new Set(["checked", "is_default", "visa_required", "with_driver"]);
const LTR_TYPES = new Set(["serial", "number", "currency", "date", "phone", "url"]);

type OffersMode = "confirmed" | "unconfirmed";

export function TraveliunTable({
  config,
  filterOptions,
}: {
  config: TableConfig;
  filterOptions: FilterOptions;
}) {
  const { view, t } = useTraveliunUI();
  const [rows, setRows] = useState<DataRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offersMode, setOffersMode] = useState<OffersMode>("confirmed");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DataRow | null>(null);
  const [viewing, setViewing] = useState<DataRow | null>(null);

  const hasFilters = Boolean(config.filters?.length) || config.isOffers;

  const buildFilters = useCallback((): Filter[] => {
    const list: Filter[] = [];
    if (config.fixedValues) {
      for (const [column, value] of Object.entries(config.fixedValues)) list.push({ column, op: "eq", value });
    }
    for (const def of config.filters ?? []) {
      const value = filterValues[def.key];
      if (value) list.push({ column: def.column ?? def.key, op: "eq", value });
    }
    if (config.isOffers) {
      list.push(
        offersMode === "confirmed"
          ? { column: "status", op: "eq", value: "confirmed" }
          : { column: "status", op: "in", value: ["draft", "sent"] },
      );
      if (dateFrom) list.push({ column: "offer_date", op: "gte", value: dateFrom });
      if (dateTo) list.push({ column: "offer_date", op: "lte", value: dateTo });
    }
    return list;
  }, [config, filterValues, offersMode, dateFrom, dateTo]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listRows({
      table: config.table,
      page,
      pageSize,
      search: debounced || undefined,
      searchColumns: config.searchable,
      filters: buildFilters(),
      sort: config.defaultSort,
    });
    if (result.ok) {
      setRows(result.rows);
      setCount(result.count);
    } else {
      setError(t(result.error));
      setRows([]);
      setCount(0);
    }
    setLoading(false);
  }, [config, page, pageSize, debounced, buildFilters]);

  // debounce the search box
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // reset to first page whenever a query input changes
  useEffect(() => {
    setPage(1);
  }, [debounced, pageSize, filterValues, offersMode, dateFrom, dateTo]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const totalPages = Math.max(Math.ceil(count / pageSize), 1);
  const filtersActive = Boolean(debounced) || Object.values(filterValues).some(Boolean) || Boolean(dateFrom) || Boolean(dateTo);

  function clearFilters() {
    setSearch("");
    setDebounced("");
    setFilterValues({});
    setDateFrom("");
    setDateTo("");
  }

  async function onDelete(row: DataRow) {
    const id = String(row.id);
    const result = await deleteRow(config.table, id);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setViewing(null);
    await fetchRows();
  }

  async function onDuplicate(row: DataRow) {
    const result = await duplicateRow(config.table, String(row.id));
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setViewing(null);
    await fetchRows();
  }

  return (
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

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-[15px] shadow-[0_1px_2px_rgba(0,60,58,0.04),0_8px_24px_rgba(0,60,58,0.05)]">
          <div className="mb-[21px] flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative h-[46px] w-full max-w-[280px]">
              <Search className="absolute end-3 top-1/2 size-5 -translate-y-1/2 text-[#8aa29b]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-full w-full rounded-[11px] border border-[#dbe6e1] bg-[#f5f8f7] pe-11 ps-4 text-sm text-[#557d78] outline-none transition-colors focus:border-[#2aa87a]"
              />
            </div>
            <button
              type="button"
              onClick={() => void fetchRows()}
              title={t("refresh")}
              className="flex size-[46px] items-center justify-center rounded-[11px] border border-[#dbe6e1] bg-white text-[#557d78] transition-colors hover:bg-[#f1f6f4] hover:text-[#185045]"
            >
              <RefreshCw className={`size-5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="me-auto inline-flex h-[46px] items-center gap-2 rounded-[11px] bg-[#185045] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0f4439]"
            >
              <Plus className="size-4" />
              {t("add")}
            </button>
          </div>

          {error ? (
            <p role="alert" className="mb-4 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
              {error}
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
                          <td className="px-[18px] py-[19px]"><div className="tv-shimmer size-[18px] rounded-md" /></td>
                          {config.columns.map((column) => (
                            <td key={column.key} className="px-[14px] py-[19px]"><div className="tv-shimmer h-[13px] w-24 rounded-md" /></td>
                          ))}
                        </tr>
                      ))
                    ) : rows.length > 0 ? (
                      rows.map((row) => (
                        <tr key={String(row.id)} className="cursor-pointer border-b border-[#eef2f0] text-[#557d78] transition-colors hover:bg-[#f6faf8]">
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
                              <Cell column={column} value={row[column.key]} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={config.columns.length + 1} className="p-0">{emptyState}</td>
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
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const payload = { ...values, ...(config.fixedValues ?? {}) };
            const result = await createRow(config.table, payload);
            if (!result.ok) return t(result.error);
            await fetchRows();
            return null;
          }}
        />
      ) : null}

      {editing ? (
        <RecordForm
          title={t("editRecord")}
          config={config}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const result = await updateRow(config.table, String(editing.id), values);
            if (!result.ok) return t(result.error);
            await fetchRows();
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
        />
      ) : null}
    </TraveliunShell>
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
              {primary ? <Cell column={primary} value={row[primary.key]} /> : null}
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
                <dd className="min-w-0 text-end font-medium text-[#0f3d38]"><Cell column={column} value={row[column.key]} /></dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

function Cell({ column, value }: { column: ColumnDef; value: DataValue }) {
  const { t } = useTraveliunUI();
  if (value === null || value === undefined || value === "") return <span className="text-[#c2cfca]">—</span>;
  if (column.type === "status") return <StatusBadge tone={statusTone(String(value))} />;
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
          const options = def.source ? filterOptions[def.source] : (def.options ?? []);
          return (
            <label key={def.key} className="grid gap-2 text-[13px] font-bold text-[#185045]">
              {t(def.labelKey)}
              <select
                value={filterValues[def.key] ?? ""}
                onChange={(e) => setFilterValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
                className={fieldClass}
              >
                <option value="">{t("all")}</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          className="h-[34px] rounded-md border border-[#dbe6e1] bg-white px-2 text-sm text-[#185045] outline-none"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <PagerButton icon={ChevronsRight} disabled={page <= 1} onClick={() => setPage(() => 1)} />
        <PagerButton icon={ChevronRight} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(() => p)}
            className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm ${
              p === page ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
            }`}
          >
            {p}
          </button>
        ))}
        <PagerButton icon={ChevronLeft} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
        <PagerButton icon={ChevronsLeft} disabled={page >= totalPages} onClick={() => setPage(() => totalPages)} />
      </div>
    </div>
  );
}

function PagerButton({ icon: Icon, disabled, onClick }: { icon: typeof ChevronLeft; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  config: TableConfig;
  initial?: DataRow;
  onClose: () => void;
  onSubmit: (values: DataRow) => Promise<string | null>;
}) {
  const { t, dir } = useTraveliunUI();
  const columns = editableColumns(config);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, initial && initial[c.key] != null ? String(initial[c.key]) : ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const values: DataRow = {};
    for (const column of columns) {
      const raw = form[column.key] ?? "";
      values[column.key] = coerce(column, raw);
    }
    const err = await onSubmit(values);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true" dir={dir}>
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-[860px] overflow-y-auto rounded-2xl border border-[#e2ebe7] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
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
              <span>{t(column.labelKey)}</span>
              <FieldInput column={column} value={form[column.key] ?? ""} onChange={(v) => setForm((prev) => ({ ...prev, [column.key]: v }))} />
            </label>
          ))}
        </div>

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

function FieldInput({ column, value, onChange }: { column: ColumnDef; value: string; onChange: (value: string) => void }) {
  const { t } = useTraveliunUI();
  if (BOOLEAN_KEYS.has(column.key)) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={formField}>
        <option value="true">{t("yes")}</option>
        <option value="false">{t("no")}</option>
      </select>
    );
  }
  if (column.options) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={formField}>
        <option value="">{t("chooseOption")}</option>
        {column.options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
      </select>
    );
  }
  const inputType = column.type === "number" || column.type === "currency" ? "number" : column.type === "date" ? "date" : "text";
  const dir = column.type && LTR_TYPES.has(column.type) ? "ltr" : "rtl";
  return <input type={inputType} dir={dir} value={value} onChange={(e) => onChange(e.target.value)} className={`${formField} ${dir === "ltr" ? "text-start" : ""}`} />;
}

function RowActionModal({
  row,
  config,
  onClose,
  onEdit,
  onCopy,
  onDelete,
}: {
  row: DataRow;
  config: TableConfig;
  onClose: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { t, dir } = useTraveliunUI();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    await action();
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" dir={dir}>
      <div className="w-full max-w-[620px] rounded-2xl border border-[#e2ebe7] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
          <h2 className="text-lg font-extrabold">{t("details")}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}><X className="size-5" /></button>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {config.columns.map((column) => (
            <div key={column.key} className="rounded-[10px] bg-[#f4f8f6] p-3">
              <p className="mb-1 text-xs font-bold text-[#93aaa3]">{t(column.labelKey)}</p>
              <div className="text-sm"><Cell column={column} value={row[column.key]} /></div>
            </div>
          ))}
        </div>

        {confirming ? (
          <div className="rounded-[10px] border border-[#f2d0d7] bg-[#fdeef2] p-4">
            <p className="mb-3 text-sm font-bold text-[#c22850]">{t("confirmDeleteHint")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-[10px] border border-[#d8e3de] px-4 text-sm font-semibold text-[#185045]">{t("cancel")}</button>
              <button type="button" disabled={busy} onClick={() => run(onDelete)} className="flex h-10 items-center gap-2 rounded-[10px] bg-[#c43d5a] px-5 text-sm font-bold text-white hover:bg-[#a82f49] disabled:opacity-70">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} {t("confirmDelete")}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={onEdit} className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#185045] text-sm font-bold text-white hover:bg-[#0f4439]">
              <Eye className="size-4" /> {t("edit")}
            </button>
            <button type="button" disabled={busy} onClick={() => run(onCopy)} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#d8e3de] text-sm font-bold hover:bg-[#f4f8f6] disabled:opacity-70">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />} {t("copy")}
            </button>
            <button type="button" onClick={() => setConfirming(true)} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#f2c7c7] text-sm font-bold text-[#c43d3d] hover:bg-[#fff1f1]">
              <Trash2 className="size-4" /> {t("delete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function coerce(column: ColumnDef, raw: string): DataValue {
  const trimmed = raw.trim();
  if (BOOLEAN_KEYS.has(column.key)) return trimmed === "true";
  if (trimmed === "") return null;
  if (column.type === "number" || column.type === "currency") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
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
