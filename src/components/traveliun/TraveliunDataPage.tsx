"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { arabicLabels, type TraveliunRow, type TraveliunTablePage } from "@/lib/traveliun-data";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";
import type { TranslationKey } from "@/lib/i18n";

type TraveliunDataPageProps = {
  page: TraveliunTablePage;
};

const ROUTE_TITLE_KEYS: Record<string, TranslationKey> = {
  "/setting/currencies": "nav.currencies",
  "/setting/suppliers": "nav.suppliers",
  "/setting/suppliers-preferences": "nav.supplierPreferences",
  "/setting/statuses-groups": "nav.statusGroups",
  "/visas": "nav.visas",
  "/visas-types": "nav.visaTypes",
  "/companies": "nav.companies",
  "/companies-visits": "nav.companiesVisits",
  "/companies-visits-statuses": "nav.visitStatuses",
  "/cars-types": "nav.carTypes",
  "/services-types": "nav.serviceTypes",
  "/guide/categories": "nav.guideCategories",
  "/customers_care/services": "nav.careServiceType",
  "/customers_care/dashboard": "nav.careDashboard",
};

function routeTitleKey(route: string): TranslationKey {
  return ROUTE_TITLE_KEYS[route] ?? "title.page";
}

export function TraveliunDataPage({ page }: TraveliunDataPageProps) {
  if (page.route === "/offers") {
    return <TraveliunOffersPage page={page} />;
  }

  return <GenericTraveliunDataPage page={page} />;
}

function GenericTraveliunDataPage({ page }: TraveliunDataPageProps) {
  const { t } = useTraveliunUI();
  const [rows, setRows] = useState<TraveliunRow[]>(page.rows);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [employeeAdding, setEmployeeAdding] = useState(false);
  const [employeeActionRow, setEmployeeActionRow] = useState<TraveliunRow | null>(null);
  const [employeeEditor, setEmployeeEditor] = useState<{ employee: TraveliunRow; original: TraveliunRow } | null>(null);
  const [selectedRow, setSelectedRow] = useState<TraveliunRow | null>(null);
  const [roleEditor, setRoleEditor] = useState<{ role: TraveliunRow; original: TraveliunRow | null } | null>(null);
  const isRolesPage = page.route === "/employees/roles";
  const isEmployeesPage = page.route === "/employees";
  const visibleRows = useFilteredRows(rows, query);
  const workingPage = { ...page, rows: visibleRows };

  return (
    <TraveliunShell title={routeTitleKey(page.route)}>
      <div className="tv-fade-up">
      {page.filters ? <FilterCard page={page} /> : null}

      <section className="rounded-2xl border border-[#e2ebe7] bg-white p-[15px] shadow-[0_1px_2px_rgba(0,60,58,0.04),0_8px_24px_rgba(0,60,58,0.05)]">
        <TableToolbar
          page={page}
          query={query}
          setQuery={setQuery}
          onAdd={() => {
            if (isRolesPage) {
              setRoleEditor({ role: createEmptyRow(page), original: null });
              return;
            }
            if (isEmployeesPage) {
              setEmployeeAdding(true);
              return;
            }

            setAdding(true);
          }}
        />
        <DataTable
          page={workingPage}
          actionMenuRow={employeeActionRow}
          renderActionMenu={
            isEmployeesPage
              ? (row) => (
                  <EmployeeActionMenu
                    onEdit={() => {
                      setEmployeeActionRow(null);
                      setEmployeeEditor({ employee: row, original: row });
                    }}
                    onDelete={() => {
                      setRows((currentRows) => currentRows.filter((item) => item !== row));
                      setEmployeeActionRow(null);
                    }}
                  />
                )
              : undefined
          }
          onRowAction={(row) => {
            if (isRolesPage) {
              setRoleEditor({ role: row, original: row });
              return;
            }
            if (isEmployeesPage) {
              setEmployeeActionRow((currentRow) => (currentRow === row ? null : row));
              return;
            }

            setSelectedRow(row);
          }}
        />
        <TableFooter showPages />
      </section>

      <RowActionModal row={selectedRow} page={page} onClose={() => setSelectedRow(null)} />
      <AddRecordModal
        page={page}
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={(row) => setRows((currentRows) => [row, ...currentRows])}
      />
      <EmployeeModal
        open={employeeAdding}
        onClose={() => setEmployeeAdding(false)}
        onSubmit={(row) => setRows((currentRows) => [row, ...currentRows])}
      />
      <EmployeeModal
        open={Boolean(employeeEditor)}
        title={t("legacy.employeeEdit")}
        initialRow={employeeEditor?.employee ?? null}
        onClose={() => setEmployeeEditor(null)}
        onSubmit={(row) => {
          setRows((currentRows) =>
            currentRows.map((item) => (item === employeeEditor?.original ? { ...item, ...row } : item)),
          );
          setEmployeeEditor(null);
        }}
      />
      <RolePermissionModal
        editor={roleEditor}
        onClose={() => setRoleEditor(null)}
        onSave={(role, original) => {
          setRows((currentRows) => {
            if (!original) return [role, ...currentRows];
            return currentRows.map((item) => (item === original ? role : item));
          });
          setRoleEditor(null);
        }}
      />
      </div>
    </TraveliunShell>
  );
}

function TraveliunOffersPage({ page }: TraveliunDataPageProps) {
  const { t } = useTraveliunUI();
  const [rows] = useState<TraveliunRow[]>(page.rows);
  const [query, setQuery] = useState("");
  const [programsMode, setProgramsMode] = useState<"not-confirmed" | "confirmed">("confirmed");
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedRow, setSelectedRow] = useState<TraveliunRow | null>(null);
  const modeRows = useMemo(
    () => (onlyMine ? rows.filter((row) => (row.employee ?? "").toLowerCase() === "admin") : rows),
    [onlyMine, rows],
  );
  const visibleRows = useFilteredRows(modeRows, query);
  const workingPage = { ...page, rows: visibleRows };

  return (
    <TraveliunShell title="nav.packages">
      <div className="tv-fade-up">
      <div className="mb-3 flex justify-center">
        <div className="inline-flex overflow-hidden rounded-md bg-[#e3efeb] text-sm text-[#185045]">
          <button
            type="button"
            className={`px-9 py-4 transition-colors ${programsMode === "not-confirmed" ? "bg-[#d8e8e4] font-semibold" : ""}`}
            onClick={() => setProgramsMode("not-confirmed")}
          >
            {t("offers.unconfirmedTab")}
          </button>
          <button
            type="button"
            className={`px-9 py-4 transition-colors ${programsMode === "confirmed" ? "bg-[#d8e8e4] font-semibold" : ""}`}
            onClick={() => setProgramsMode("confirmed")}
          >
            {t("offers.confirmedTab")}
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-[#e2ebe7] bg-white p-[15px] shadow-[0_1px_2px_rgba(0,60,58,0.04),0_8px_24px_rgba(0,60,58,0.05)]">
        <div className="mb-[21px] flex flex-col gap-4 lg:flex-row lg:items-center">
          <Link
            href="/offer"
            className="inline-flex h-[46px] w-[86px] items-center justify-center rounded-[7px] bg-[#e8f1ed] text-sm font-semibold text-[#185045] transition-colors hover:bg-[#dbe9e4]"
          >
            {t("add")}
          </Link>

          <div className="me-auto flex flex-wrap items-center gap-8 text-sm text-[#185045]">
            <button type="button" onClick={() => setOnlyMine((value) => !value)}>
              <StatusPill label={onlyMine ? t("legacy.myOffers") : t("legacy.active")} />
            </button>
            <Legend label={t("legacy.myOffers")} />
            <Legend label={t("status.confirmed")} color="bg-[#25ad79]" />
            <Legend label={t("status.cancelled")} color="bg-[#f42f68]" />
            <Legend label={t("legacy.lastEdit")} color="bg-[#f3c400]" />
            <Legend label={t("legacy.editTag")} color="bg-[#dfe9e5]" />
            <Legend label={t("legacy.newTag")} color="bg-[#e3f1ee]" />
            <Search className="size-6 text-[#8aa29b]" />
          </div>

          <SearchBox value={query} onChange={setQuery} />
        </div>

        <DataTable page={workingPage} offers onRowAction={setSelectedRow} />
        <TableFooter />
      </section>

      <RowActionModal row={selectedRow} page={page} onClose={() => setSelectedRow(null)} />
      </div>
    </TraveliunShell>
  );
}

function FilterCard({ page }: TraveliunDataPageProps) {
  const { t } = useTraveliunUI();
  return (
    <section className="mb-3 rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {page.filters?.map((filter) => (
          <label
            key={filter.label}
            className="grid gap-2 text-[13px] font-medium text-[#003c3a] md:grid-cols-[130px_1fr] md:items-center"
          >
            <span>{filter.label}</span>
            <span className="flex h-[47px] items-center rounded-[7px] border border-[#ddd4d3] px-3 text-sm font-normal text-[#557d78]">
              {filter.value ?? t("chooseOption")}
              <ChevronDown className="me-auto size-4 text-[#9caaa6]" />
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function TableToolbar({
  page,
  query,
  setQuery,
  onAdd,
}: TraveliunDataPageProps & {
  query: string;
  setQuery: (value: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTraveliunUI();
  return (
    <div className="mb-[21px] flex flex-col gap-4 sm:flex-row sm:items-center">
      <SearchBox value={query} onChange={setQuery} />
      {page.legends ? (
        <div className="flex flex-wrap gap-8 text-sm text-[#185045]">
          {page.legends.map((legend) => (
            <span key={legend.label} className="inline-flex items-center gap-2">
              <span className={`size-5 ${legend.tone === "mint" ? "bg-[#e5f3ee]" : "bg-[#fff8dd]"}`} />
              {legend.label}
            </span>
          ))}
        </div>
      ) : null}
      {page.addLabel ? (
        <button
          type="button"
          className="me-auto inline-flex h-[46px] items-center gap-2 rounded-[7px] bg-[#185045] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0f4439]"
          onClick={onAdd}
        >
          <Plus className="size-4" />
          {t("add")}
        </button>
      ) : null}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTraveliunUI();
  return (
    <div className="relative h-[46px] w-full max-w-[250px]">
      <Search className="absolute end-3 top-1/2 size-6 -translate-y-1/2 text-[#8aa29b]" />
      <input
        className="h-full w-full rounded-md border border-[#e7ece9] bg-[#edf2ef] pe-[95px] ps-4 text-sm text-[#557d78] outline-none placeholder:text-[#9cafaa] focus:border-[#b7c8c2]"
        placeholder={t("searchPlaceholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function DataTable({
  page,
  offers = false,
  actionMenuRow,
  renderActionMenu,
  onRowAction,
}: TraveliunDataPageProps & {
  offers?: boolean;
  actionMenuRow?: TraveliunRow | null;
  renderActionMenu?: (row: TraveliunRow) => ReactNode;
  onRowAction: (row: TraveliunRow) => void;
}) {
  const { t, dir } = useTraveliunUI();
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-start text-sm" dir={dir}>
        <thead>
          <tr className="sticky top-0 z-10 bg-[#185045] text-white">
            <th className="w-[52px] px-[18px] py-[15px]" />
            {page.columns.map((column) => (
              <th
                key={column.key}
                className={`px-[14px] py-[15px] text-[11.5px] font-bold tracking-[0.02em] ${minWidthClass(column.minWidth)}`}
              >
                {columnLabel(t, column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.length > 0 ? (
            page.rows.map((row, rowIndex) => (
              <tr
                key={`${page.route}-${rowIndex}`}
                className="cursor-pointer border-b border-[#eef2f0] text-[#557d78] transition-colors hover:bg-[#f6faf8]"
              >
                <td className="relative px-[18px] py-[17px] text-[#a4b8b2]">
                  <button
                    type="button"
                    className="flex size-[30px] items-center justify-center rounded-lg transition-colors hover:bg-[#e8f1ed] hover:text-[#185045]"
                    onClick={() => onRowAction(row)}
                    aria-label="Row actions"
                  >
                    <Settings className="size-5" />
                  </button>
                  {actionMenuRow === row && renderActionMenu ? renderActionMenu(row) : null}
                </td>
                {page.columns.map((column) => {
                  if (offers && column.key === "status") {
                    return (
                      <td key={column.key} className="px-[14px] py-[17px] align-middle">
                        <StatusBadge tone="sent" label={t("offers.programSent")} />
                      </td>
                    );
                  }
                  if (column.key === "status" && row[column.key]) {
                    return (
                      <td key={column.key} className="px-[14px] py-[17px] align-middle">
                        <StatusBadge tone={statusTone(row[column.key])} label={translateCell(row[column.key])} />
                      </td>
                    );
                  }
                  const value = translateCell(offers ? offerCellValue(row, column.key) : row[column.key]);
                  return (
                    <td key={column.key} className="tv-tnum px-[14px] py-[17px] align-middle leading-6">
                      {value ? <DirText dir="auto">{value}</DirText> : <span className="text-[#c2cfca]">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={page.columns.length + 1} className="p-0">
                <EmptyState
                  title={arabicLabels[page.emptyText ?? "No Data Found"] ?? page.emptyText ?? t("noData")}
                  description={t("noDataDesc")}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TableFooter({ showPages = false }: { showPages?: boolean }) {
  return (
    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        className="flex h-[38px] w-[76px] items-center justify-between rounded-md border border-[#dfe8e4] bg-[#edf3f0] px-3 text-sm text-[#185045]"
      >
        10
        <ChevronDown className="size-4" />
      </button>
      {showPages ? (
        <div className="flex flex-wrap gap-2">
          <PagerButton icon={ChevronsRight} muted />
          <PagerButton icon={ChevronRight} muted />
          {[1, 2, 3, 4, 5].map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm ${
                pageNumber === 1 ? "border-[#185045] bg-[#185045] text-white" : "border-[#dfe8e4] bg-white text-[#185045]"
              }`}
            >
              {pageNumber}
            </button>
          ))}
          <PagerButton icon={ChevronLeft} />
          <PagerButton icon={ChevronsLeft} />
        </div>
      ) : null}
    </div>
  );
}

function AddRecordModal({
  page,
  open,
  onClose,
  onSubmit,
}: TraveliunDataPageProps & {
  open: boolean;
  onClose: () => void;
  onSubmit: (row: TraveliunRow) => void;
}) {
  const { t } = useTraveliunUI();
  const editableColumns = page.columns.length > 0 ? page.columns.slice(0, page.route === "/offers" ? 9 : 10) : [];
  const [form, setForm] = useState<TraveliunRow>(() => createEmptyRow(page));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true">
      <form
        className="max-h-[90vh] w-full max-w-[860px] overflow-y-auto rounded-md border border-[#c8d2cd] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(prepareRow(page, form));
          setForm(createEmptyRow(page));
          onClose();
        }}
      >
        <div className="mb-5 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
          <div>
            <h2 className="text-lg font-bold">{t("add")}</h2>
            <p className="mt-1 text-sm text-[#6d8a84]">{t(routeTitleKey(page.route))}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}>
            <X className="size-5" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {editableColumns.map((column) => (
            <label key={column.key} className="grid gap-2 text-sm font-semibold">
              <span>{columnLabel(t, column.label)}</span>
              <input
                className="h-11 rounded-md border border-[#d8e3de] bg-[#f8fbf9] px-3 text-sm font-normal text-[#185045] outline-none transition-colors focus:border-[#185045]"
                value={form[column.key] ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, [column.key]: event.target.value }))}
              />
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-[#d8e3de] px-5 text-sm font-semibold text-[#185045]">
            {t("cancel")}
          </button>
          <button type="submit" className="h-10 rounded-md bg-[#185045] px-6 text-sm font-bold text-white hover:bg-[#0f4439]">
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function EmployeeActionMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <div className="absolute end-3 top-[48px] z-20 w-[132px] overflow-hidden rounded-md border border-[#d4dfda] bg-white text-start text-sm text-[#185045] shadow-[0_10px_24px_rgba(0,0,0,0.16)]">
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between px-4 font-semibold transition-colors hover:bg-[#edf3f0]"
        onClick={onEdit}
      >
        <Pencil className="size-4 text-[#6f8f88]" />
        {t("edit")}
      </button>
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between border-t border-[#edf1ef] px-4 font-semibold text-[#c43d3d] transition-colors hover:bg-[#fff1f1]"
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
        {t("delete")}
      </button>
    </div>
  );
}

function RowActionModal({
  row,
  page,
  onClose,
}: {
  row: TraveliunRow | null;
  page: TraveliunTablePage;
  onClose: () => void;
}) {
  const { t } = useTraveliunUI();
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[620px] rounded-md border border-[#c8d2cd] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
          <h2 className="text-lg font-bold">{t("actions")}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}>
            <X className="size-5" />
          </button>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {page.columns.slice(0, 8).map((column) => (
            <div key={column.key} className="rounded-md bg-[#f4f8f6] p-3">
              <p className="mb-1 text-xs font-bold text-[#8aa29b]">{columnLabel(t, column.label)}</p>
              <p className="text-sm">{translateCell(row[column.key]) || "-"}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#185045] text-sm font-bold text-white">
            <Eye className="size-4" />
            {t("legacy.viewAction")}
          </button>
          <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8e3de] text-sm font-bold">
            <Copy className="size-4" />
            {t("copy")}
          </button>
          <button type="button" className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#f2c7c7] text-sm font-bold text-[#c43d3d]">
            <Trash2 className="size-4" />
            {t("delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeModal({
  open,
  title,
  initialRow = null,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title?: string;
  initialRow?: TraveliunRow | null;
  onClose: () => void;
  onSubmit: (row: TraveliunRow) => void;
}) {
  const { t } = useTraveliunUI();
  const heading = title ?? t("legacy.employeeAdd");
  const roleOptions = ["كل الصلاحيات", "مبيعات", "الاوبريشن", "التأشيرات"];
  const roleOptionKey: Record<string, TranslationKey> = {
    "كل الصلاحيات": "legacy.roleAll",
    "مبيعات": "legacy.roleSales",
    "الاوبريشن": "legacy.roleOps",
    "التأشيرات": "legacy.roleVisa",
  };
  const [form, setForm] = useState({
    arabic_name: "",
    english_name: "",
    email: "",
    password: "",
    role: "",
  });
  const [rolesOpen, setRolesOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      arabic_name: initialRow?.arabic_name ?? "",
      english_name: initialRow?.english_name ?? "",
      email: employeeEmailValue(initialRow),
      password: "",
      role: normalizeEmployeeRole(employeeRoleValue(initialRow)),
    });
    setRolesOpen(false);
  }, [initialRow, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-[#0d2823]/70 p-4" role="dialog" aria-modal="true">
      <form
        className="flex max-h-[94vh] w-full max-w-[650px] flex-col overflow-hidden rounded-md bg-white text-[#185045] shadow-[0_18px_52px_rgba(0,0,0,0.24)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            ...initialRow,
            arabic_name: form.arabic_name,
            english_name: form.english_name,
            mobile: form.email,
            email: "Company Employee",
            type: form.role || "All Permissions",
            role: "Active",
            status: initialRow?.status ?? "",
          });
          setForm({ arabic_name: "", english_name: "", email: "", password: "", role: "" });
          onClose();
        }}
      >
        <div className="flex h-[86px] items-center justify-between border-b border-[#cfd9d5] px-8">
          <h2 className="text-[22px] font-bold">{heading}</h2>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-[#ff2f5f]" aria-label={t("close")}>
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-14 py-8">
          <div className="grid gap-7">
            <EmployeeInput label={t("legacy.nameAr")} required value={form.arabic_name} onChange={(value) => setForm((current) => ({ ...current, arabic_name: value }))} />
            <EmployeeInput label={t("legacy.nameEn")} required value={form.english_name} onChange={(value) => setForm((current) => ({ ...current, english_name: value }))} />
            <EmployeeInput label={t("legacy.email")} value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
            <EmployeeInput label={t("legacy.password")} type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} />

            <div className="relative grid gap-2 text-start text-[14px] font-semibold text-[#185045]">
              <span>{t("legacy.permission")}</span>
              <button
                type="button"
                className={`flex h-[48px] items-center justify-between rounded-[7px] border bg-white px-4 text-[13px] font-normal outline-none transition-colors ${
                  rolesOpen ? "border-[#0478b8] shadow-[0_0_0_1px_#0478b8]" : "border-[#e2d8d4]"
                }`}
                onClick={() => setRolesOpen((value) => !value)}
              >
                <ChevronDown className={`size-4 text-[#aab8b3] transition-transform ${rolesOpen ? "rotate-180" : ""}`} />
                <span className={form.role ? "text-[#185045]" : "text-[#7b8582]"}>{form.role ? t(roleOptionKey[form.role] ?? "legacy.roleAll") : t("chooseOption")}</span>
              </button>
              {rolesOpen ? (
                <div className="absolute left-0 right-0 top-[78px] z-10 overflow-hidden rounded-md border border-[#d8e0dc] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                  {roleOptions.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      className={`block h-[36px] w-full px-4 text-start text-[13px] text-[#6d7f79] hover:bg-[#f4f6f8] ${
                        index === 2 ? "bg-[#f0f2f5]" : ""
                      }`}
                      onClick={() => {
                        setForm((current) => ({ ...current, role: option }));
                        setRolesOpen(false);
                      }}
                    >
                      {t(roleOptionKey[option] ?? "legacy.roleAll")}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-t border-[#cfd9d5] px-8 py-6 text-center">
          <button type="submit" className="h-[48px] rounded-[6px] bg-[#185045] px-7 text-[16px] font-bold text-white hover:bg-[#0f4439]">
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function normalizeEmployeeRole(role: string | undefined) {
  const roleMap: Record<string, string> = {
    "All Permissions": "كل الصلاحيات",
    sales: "مبيعات",
    Sales: "مبيعات",
    Operation: "الاوبريشن",
    Visas: "التأشيرات",
    Visa: "التأشيرات",
  };

  return role ? roleMap[role] ?? role : "";
}

function employeeEmailValue(row: TraveliunRow | null | undefined) {
  if (!row) return "";
  if (row.mobile?.includes("@")) return row.mobile;
  return row.email?.includes("@") ? row.email : "";
}

function employeeRoleValue(row: TraveliunRow | null | undefined) {
  if (!row) return "";
  if (row.type && row.type !== "Company Employee") return row.type;
  return row.role === "Active" ? "" : row.role;
}

function EmployeeInput({
  label,
  required = false,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  type?: "text" | "password";
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-start text-[14px] font-semibold text-[#185045]">
      <span>
        {required ? <span className="text-[#ff4868]">*</span> : null} {label}
      </span>
      <input
        type={type}
        className="h-[48px] rounded-[7px] border border-[#e2d8d4] bg-white px-4 text-start text-[13px] font-normal text-[#185045] outline-none transition-colors focus:border-[#96d18a]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type PermissionState = "checked" | "partial" | "empty";

const rolePermissionGroups: Array<{
  title: string;
  items: Array<{ label: string; initial: PermissionState }>;
}> = [
  {
    title: "الصلاحيات",
    items: [
      { label: "العملاء", initial: "checked" },
      { label: "الموظفين", initial: "checked" },
      { label: "العروض", initial: "checked" },
      { label: "الجغرافيا", initial: "checked" },
      { label: "الفنادق", initial: "checked" },
      { label: "الرحلات الجوية", initial: "checked" },
      { label: "الرحلات البحرية", initial: "checked" },
      { label: "المواصلات", initial: "partial" },
      { label: "الخدمات", initial: "checked" },
      { label: "التأشيرات", initial: "checked" },
      { label: "الإعدادات", initial: "checked" },
      { label: "العناية بالعملاء", initial: "partial" },
      { label: "الدليل", initial: "checked" },
      { label: "الرئيسية", initial: "partial" },
    ],
  },
  {
    title: "الحالات",
    items: [
      { label: "غير مؤكد", initial: "checked" },
      { label: "مؤكد", initial: "checked" },
    ],
  },
];

const permItemKey: Record<string, TranslationKey> = {
  "العملاء": "nav.customers",
  "الموظفين": "nav.employees",
  "العروض": "nav.packages",
  "الجغرافيا": "legacy.geography",
  "الفنادق": "nav.hotels",
  "الرحلات الجوية": "nav.airlines",
  "الرحلات البحرية": "nav.seaTravels",
  "المواصلات": "nav.transportation",
  "الخدمات": "nav.services",
  "التأشيرات": "nav.visas",
  "الإعدادات": "nav.settings",
  "العناية بالعملاء": "nav.customerCare",
  "الدليل": "nav.guide",
  "الرئيسية": "nav.dashboard",
  "غير مؤكد": "legacy.notConfirmed",
  "مؤكد": "status.confirmed",
};

const permGroupTitleKey: Record<string, TranslationKey> = {
  "الصلاحيات": "legacy.permissions",
  "الحالات": "legacy.statuses",
};

function RolePermissionModal({
  editor,
  onClose,
  onSave,
}: {
  editor: { role: TraveliunRow; original: TraveliunRow | null } | null;
  onClose: () => void;
  onSave: (role: TraveliunRow, original: TraveliunRow | null) => void;
}) {
  const { t } = useTraveliunUI();
  const [role, setRole] = useState<TraveliunRow>({ arabic_name: "", english_name: "" });
  const [permissions, setPermissions] = useState<Record<string, PermissionState>>(() => {
    return Object.fromEntries(
      rolePermissionGroups.flatMap((group) => group.items.map((item) => [item.label, item.initial])),
    );
  });

  useEffect(() => {
    if (editor) {
      setRole({
        arabic_name: editor.role.arabic_name ?? "",
        english_name: editor.role.english_name ?? "",
      });
      setPermissions(
        Object.fromEntries(
          rolePermissionGroups.flatMap((group) => group.items.map((item) => [item.label, item.initial])),
        ),
      );
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#0d2823]/70 p-4" role="dialog" aria-modal="true">
      <form
        className="flex max-h-[96vh] w-full max-w-[650px] flex-col overflow-hidden rounded-md bg-white text-[#185045] shadow-[0_18px_52px_rgba(0,0,0,0.24)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            {
              ...editor.role,
              arabic_name: role.arabic_name || "صلاحية جديدة",
              english_name: role.english_name || "New Permission",
            },
            editor.original,
          );
        }}
      >
        <div className="flex h-[84px] items-center justify-between border-b border-[#cfd9d5] px-8">
          <h2 className="text-[22px] font-bold">{t("legacy.editPermission")}</h2>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-[#ff2f5f]" aria-label={t("close")}>
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-14 py-6">
          <div className="grid gap-5 md:grid-cols-2">
            <RoleInput
              label={t("legacy.nameAr")}
              required
              value={role.arabic_name ?? ""}
              onChange={(value) => setRole((current) => ({ ...current, arabic_name: value }))}
            />
            <RoleInput
              label={t("legacy.nameEn")}
              required
              value={role.english_name ?? ""}
              onChange={(value) => setRole((current) => ({ ...current, english_name: value }))}
            />
          </div>

          <div className="mt-7 grid justify-end">
            <div className="w-[210px] space-y-5">
              {rolePermissionGroups.map((group) => (
                <div key={group.title}>
                  <p className="mb-2 text-start text-[15px] font-bold">
                    <span className="text-[#ff4868]">*</span> {t(permGroupTitleKey[group.title] ?? "legacy.permissions")}
                  </p>
                  <div className="space-y-[5px]">
                    {group.items.map((item) => (
                      <PermissionToggle
                        key={item.label}
                        label={item.label}
                        state={permissions[item.label] ?? item.initial}
                        onClick={() =>
                          setPermissions((current) => ({
                            ...current,
                            [item.label]: nextPermissionState(current[item.label] ?? item.initial),
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[#cfd9d5] px-8 py-5 text-center">
          <button type="submit" className="h-[48px] rounded-[6px] bg-[#185045] px-7 text-[16px] font-bold text-white hover:bg-[#0f4439]">
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function RoleInput({
  label,
  required = false,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-start text-[13px] font-semibold text-[#557d78]">
      <span>
        {required ? <span className="text-[#ff4868]">*</span> : null} {label}
      </span>
      <input
        className="h-[48px] rounded-[7px] border border-[#e2d8d4] bg-white px-4 text-start text-[13px] font-normal text-[#185045] outline-none transition-colors focus:border-[#96d18a]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PermissionToggle({
  label,
  state,
  onClick,
}: {
  label: string;
  state: PermissionState;
  onClick: () => void;
}) {
  const { t } = useTraveliunUI();
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-end gap-2 text-start text-[14px] text-[#7b8582]">
      <span className="text-[#bbc6c2]">‹</span>
      <span
        className={`flex size-[18px] items-center justify-center rounded-[4px] text-[13px] font-bold text-white ${
          state === "empty" ? "border border-[#b7c7c1] bg-white" : "bg-[#185045]"
        }`}
      >
        {state === "checked" ? "✓" : state === "partial" ? "−" : ""}
      </span>
      <span>{t(permItemKey[label] ?? "nav.dashboard")}</span>
    </button>
  );
}

function nextPermissionState(state: PermissionState): PermissionState {
  if (state === "checked") return "partial";
  if (state === "partial") return "empty";
  return "checked";
}

function useFilteredRows(rows: TraveliunRow[], query: string) {
  return useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return rows;

    return rows.filter((row) =>
      Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [query, rows]);
}

function createEmptyRow(page: TraveliunTablePage): TraveliunRow {
  return Object.fromEntries(page.columns.map((column) => [column.key, ""]));
}

function prepareRow(page: TraveliunTablePage, form: TraveliunRow): TraveliunRow {
  const row = { ...form };

  if (page.route === "/offers") {
    row.serial = row.serial || `AD-${Math.floor(Math.random() * 8) + 1}-${Date.now().toString().slice(-4)}-20260702`;
    row.employee = row.employee || "Admin";
    row.original_employee = row.original_employee || "Admin";
    row.status = row.status || "Package Sent";
  }

  if ("status" in row && !row.status) row.status = "Active";

  return row;
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex min-w-[70px] justify-center rounded-full bg-[#185045] px-4 py-1.5 text-xs font-bold text-white">
      {label}
    </span>
  );
}

function Legend({ label, color = "bg-transparent" }: { label: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-5 ${color}`} />
      {label}
    </span>
  );
}

function translateCell(value?: string) {
  if (!value) return "";
  const map: Record<string, string> = {
    "Package Sent": "تم إرسال البرنامج",
    Active: "فعال",
    Admin: "أدمن",
    "Traveliun Travel and Tourism": "ترافليون للسفر والسياحة",
  };
  return map[value] ?? value;
}

function offerCellValue(row: Record<string, string>, key: string) {
  if (key === "company") return "";
  if (key === "buy_price") return row.company;
  if (key === "sell_price") return row.buy_price;
  if (key === "profit") return row.sell_price;
  return row[key];
}

function minWidthClass(width?: string) {
  switch (width) {
    case "120px":
      return "min-w-[120px]";
    case "130px":
      return "min-w-[130px]";
    case "140px":
      return "min-w-[140px]";
    case "150px":
      return "min-w-[150px]";
    case "160px":
      return "min-w-[160px]";
    case "170px":
      return "min-w-[170px]";
    case "180px":
      return "min-w-[180px]";
    case "210px":
      return "min-w-[210px]";
    case "440px":
      return "min-w-[440px]";
    default:
      return "min-w-[120px]";
  }
}

const columnLabelKeys: Record<string, TranslationKey> = {
  COMPANY: "col.company",
  "ARABIC NAME": "col.arabicName",
  "ENGLISH NAME": "col.englishName",
  MOBILE: "col.mobile",
  EMAIL: "col.email",
  "SECOND MOBILE": "col.secondMobile",
  "BIRTH DATE": "col.birthDate",
  "PASSPORT FIRST NAME": "col.passportFirstName",
  "PASSPORT LAST NAME": "col.passportLastName",
  "PASSPORT NUMBER": "col.passportNumber",
  "PASSPORT ISSUE DATE": "col.passportIssue",
  "PASSPORT EXPIRY DATE": "col.passportExpiry",
  TYPE: "col.type",
  ROLE: "col.role",
  STATUS: "col.status",
  COUNTRY: "filter.country",
  CITY: "filter.city",
  CODE: "col.code",
  "DEFAULT CURRENCY": "col.defaultCurrency",
  WEEKEND: "col.weekend",
  "NUMBER OF STARS": "col.stars",
  ADDRESS: "col.address",
  "GOOGLE MAPS": "col.googleMaps",
  "CONTACT NUMBER": "col.contactNumber",
  WEBSITE: "col.website",
  "DEFAULT HOTEL": "col.defaultHotel",
  SERIAL: "col.serial",
  EMPLOYEE: "filter.employee",
  "ORIGINAL EMPLOYEE": "col.originalEmployee",
  CUSTOMER: "col.customer",
  "BUY PRICE": "col.buyPrice",
  "SELL PRICE": "col.sellPrice",
  PROFIT: "col.profit",
  "BUY CURRENCY": "col.buyCurrency",
  "SELL CURRENCY": "col.sellCurrency",
  "SERVICE TYPE": "col.serviceType",
  "VISA TYPE": "col.visaType",
  "ARABIC REQUIREMENTS": "col.arabicRequirements",
  "ENGLISH REQUIREMENTS": "col.englishRequirements",
  "ARABIC TEXT": "col.arabicText",
  "ENGLISH TEXT": "col.englishText",
  CHECKED: "col.checked",
  SUPPLIER: "col.supplier",
  SUPERVISOR: "col.supervisor",
  CATEGORY: "col.category",
  "HAS ACCESS LOGIN": "col.hasLogin",
  CURRENCIES: "col.currencies",
  "ISO CODE": "col.isoCode",
  "PRICE MARGIN": "col.priceMargin",
  "PRICE TO CONVERT TO SAR": "col.convertToSar",
  "PRICE TO CONVERT FROM SAR": "col.convertFromSar",
  ORDER: "col.order",
  "CAR TYPE": "col.carType",
  "NUMBER OF PASSENGERS": "col.passengers",
  "NUMBER OF BAGS": "col.bags",
  FROM: "col.from",
  TO: "col.to",
  PRICE: "col.price",
  "FROM CITY": "col.fromCity",
};

function columnLabel(t: (k: TranslationKey) => string, label: string): string {
  const key = columnLabelKeys[label] ?? columnLabelKeys[label.toUpperCase()];
  return key ? t(key) : label;
}

function PagerButton({
  icon: Icon,
  muted = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex h-9 w-9 items-center justify-center rounded-md border border-[#dfe8e4] bg-white ${
        muted ? "text-[#c8d6d1]" : "text-[#8ca49e]"
      }`}
    >
      <Icon className="size-5" />
    </button>
  );
}
