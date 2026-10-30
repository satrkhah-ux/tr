"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Upload, X } from "lucide-react";
import { exportRows, getRowsByIds, importRows } from "@/lib/data/actions";
import {
  exportCell,
  parseCsv,
  planImport,
  resolveHeader,
  toCsv,
  type ImportPlan,
  type RefOptions,
} from "@/lib/data/table-csv";
import type { ColumnDef, DataRow, FilterOptions, ListInput, TableConfig } from "@/lib/data/types";
import { translate } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { useSafeTransition } from "./useSafeTransition";

/**
 * «تصدير Excel» / «استيراد Excel» for one data table. The file is CSV (UTF-8 +
 * BOM — no spreadsheet library is installed); see src/lib/data/table-csv.ts.
 * Export = the rows the screen's search and filters select. Import = a diff
 * shown first, then only new rows and changed fields are written; nothing is
 * deleted.
 */

/** Excel saves «CSV» in the Windows code page unless «CSV UTF-8» is chosen. */
function decode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1256").decode(buffer);
  }
}

function slug(route: string): string {
  return route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "table";
}

export function TableTransfer({
  config,
  filterOptions,
  importColumns,
  query,
  onImported,
  canImport,
}: {
  config: TableConfig;
  filterOptions: FilterOptions;
  /** the columns a file may write — the form's */
  importColumns: ColumnDef[];
  /** the screen's search + filters, for the export */
  query: () => Omit<ListInput, "page" | "pageSize">;
  onImported: () => void;
  /** settings.manage — an import writes a whole file at once, the administration's job (importRows refuses it too) */
  canImport: boolean;
}) {
  const { t, dir } = useTraveliunUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, start] = useSafeTransition();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refs: RefOptions = { cities: filterOptions.cities, countries: filterOptions.countries };

  function exportFile() {
    setNote(null);
    start(async () => {
      const result = await exportRows(query());
      if (!result.ok) {
        setNote(t(result.error));
        return;
      }
      const header = ["id", ...config.columns.map((c) => t(c.labelKey))];
      const lines = result.rows.map((row) => [String(row.id ?? ""), ...config.columns.map((c) => exportCell(c, row, refs))]);
      const url = URL.createObjectURL(new Blob([toCsv([header, ...lines])], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug(config.route)}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNote(t("data.tools.export.done", { count: result.rows.length }));
    });
  }

  function readFile(file: File) {
    setNote(null);
    start(async () => {
      const [header = [], ...lines] = parseCsv(decode(await file.arrayBuffer()));
      const aliases = Object.fromEntries(
        importColumns.map((c) => [c.key, [translate("ar", c.labelKey), translate("en", c.labelKey)]]),
      );
      const keys = resolveHeader(header, aliases);
      if (!keys.some((k) => k && k !== "id")) {
        setNote(t("data.tools.import.noColumns"));
        return;
      }
      const idAt = keys.indexOf("id");
      const ids = idAt < 0 ? [] : [...new Set(lines.map((l) => (l[idAt] ?? "").trim()).filter(Boolean))];
      const existing = ids.length ? await getRowsByIds(config.table, ids, config.fixedValues) : { ok: true as const, rows: [], count: 0 };
      if (!existing.ok) {
        setNote(t(existing.error));
        return;
      }
      setPlan(
        planImport({
          keys,
          lines,
          columns: importColumns,
          existing: new Map(existing.rows.map((r) => [String(r.id), r])),
          refs,
        }),
      );
    });
  }

  function save(current: ImportPlan) {
    start(async () => {
      const creates = current.creates.map((values) => ({ ...values, ...(config.fixedValues ?? {}) }));
      const result = await importRows(config.table, creates, current.updates.map((u) => ({ id: u.id, changes: u.changes })));
      if (!result.ok) {
        setNote(t(result.error));
        return;
      }
      setPlan(null);
      const failed = result.failed.length
        ? ` ${t("data.tools.import.failed", { count: result.failed.length, reason: t(result.failed[0].error) })}`
        : "";
      setNote(`${t("data.tools.import.saved", { created: result.created, updated: result.updated })}${failed}`);
      onImported();
    });
  }

  const label = (row: DataRow) => String(row[config.columns[0]?.key ?? "id"] ?? row.id ?? "");
  /** a city id shown as its name */
  const shown = (key: string, value: unknown) => {
    const ref = importColumns.find((c) => c.key === key)?.ref;
    const text = value === null || value === undefined || value === "" ? "—" : String(value);
    return ref ? (refs[ref]?.find((o) => o.value === text)?.label ?? text) : text;
  };
  const colLabel = (key: string) => {
    const column = importColumns.find((c) => c.key === key);
    return column ? t(column.labelKey) : key;
  };

  return (
    <>
      <button
        type="button"
        onClick={exportFile}
        disabled={busy}
        className="inline-flex h-[46px] items-center gap-2 rounded-[11px] border border-[#dbe6e1] bg-white px-4 text-sm font-bold text-[#185045] transition-colors hover:bg-[#f1f6f4] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
        {t("data.tools.export.button")}
      </button>
      {canImport ? (
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex h-[46px] items-center gap-2 rounded-[11px] border border-[#dbe6e1] bg-white px-4 text-sm font-bold text-[#185045] transition-colors hover:bg-[#f1f6f4] disabled:opacity-60"
      >
        <Upload className="size-4" aria-hidden />
        {t("data.tools.import.button")}
      </button>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label={t("data.tools.import.button")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) readFile(file);
        }}
      />
      {note ? <p role="status" className="basis-full text-[13px] font-semibold text-[#557d78]">{note}</p> : null}

      {plan ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-labelledby="import-preview-title" dir={dir}>
          <div className="max-h-[calc(90vh/var(--tv-zoom))] w-full max-w-[820px] overflow-y-auto rounded-2xl border border-[#e2ebe7] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
            <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
              <h2 id="import-preview-title" className="text-lg font-extrabold">{t("data.tools.import.previewTitle")}</h2>
              <button type="button" onClick={() => setPlan(null)} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}>
                <X className="size-5" />
              </button>
            </div>
            <p className="mb-3 text-sm font-semibold">
              {t("data.tools.import.summary", {
                created: plan.creates.length,
                updated: plan.updates.length,
                unchanged: plan.unchanged,
                errors: plan.errors.length,
              })}
            </p>
            <p className="mb-4 text-[12.5px] text-tv-text-faint">{t("data.tools.import.noDelete")}</p>

            {plan.errors.length > 0 ? (
              <ul className="mb-4 grid gap-1 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] p-3 text-[13px] text-[#c22850]">
                {plan.errors.slice(0, 50).map((e) => (
                  <li key={`${e.line}-${e.detail}`}>{t("data.tools.import.lineError", { line: e.line, reason: t(e.error), value: e.detail })}</li>
                ))}
              </ul>
            ) : null}

            {plan.updates.length > 0 ? (
              <ul className="mb-4 grid gap-2 text-[13px]">
                {plan.updates.slice(0, 100).map((u) => (
                  <li key={u.id} className="rounded-[10px] bg-[#f4f8f6] p-2.5">
                    <p className="font-bold">{label(u.before)}</p>
                    {Object.entries(u.changes).map(([key, value]) => (
                      <p key={key} className="text-[#557d78]">
                        {colLabel(key)}: <span className="line-through">{shown(key, u.before[key])}</span> ← <span className="font-semibold text-[#185045]">{shown(key, value)}</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            ) : null}

            {plan.creates.length > 0 ? (
              <ul className="mb-4 grid gap-1 text-[13px]">
                {plan.creates.slice(0, 100).map((row, i) => (
                  <li key={i} className="rounded-[10px] bg-[#eaf6f0] px-3 py-1.5">+ {label(row)}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setPlan(null)} className="h-10 rounded-[10px] border border-[#d8e3de] px-5 text-sm font-semibold hover:bg-[#f4f8f6]">
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={busy || plan.creates.length + plan.updates.length === 0}
                onClick={() => save(plan)}
                className="flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-6 text-sm font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t("data.tools.import.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
