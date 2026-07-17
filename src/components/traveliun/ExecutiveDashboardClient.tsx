"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  Globe2,
  Package,
  PiggyBank,
  Receipt,
  RotateCcw,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { KANBAN_STAGES } from "@/lib/data/pipeline";
import { getExecutiveDashboard, type ExecRow, type ExecutiveDashboard } from "@/lib/data/executive";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { DestinationBar, MonthlyChart, StageBar, StatusDoughnut } from "./charts/ExecutiveCharts";

// ---------- formatting helpers ----------
const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
function fmtInt(n: number): string {
  return INT.format(Math.round(n));
}
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(month: string, language: "ar" | "en"): string {
  const [y, m] = month.split("-");
  const i = Number(m) - 1;
  const names = language === "ar" ? AR_MONTHS : EN_MONTHS;
  return i >= 0 && i < 12 ? `${names[i]} ${y}` : month;
}

const UNKNOWN_DEST = "غير محدد";
const OTHER_DEST = "__other__";

const STATUS_META: { key: string; labelKey: TranslationKey; color: string }[] = [
  { key: "confirmed", labelKey: "status.confirmed", color: "#0f7a52" },
  { key: "sent", labelKey: "status.sent", color: "#3457a8" },
  { key: "draft", labelKey: "status.draft", color: "#9a6a00" },
  { key: "cancelled", labelKey: "status.cancelled", color: "#c22850" },
];
const STATUS_COLOR = new Map(STATUS_META.map((s) => [s.key, s.color]));
const STATUS_LABEL_KEY = new Map(STATUS_META.map((s) => [s.key, s.labelKey]));
const STAGE_LABEL_KEY = new Map<string, TranslationKey>(KANBAN_STAGES.map((s) => [s.key, s.labelKey]));

// ---------- pure aggregation over the (filtered) rows ----------
type Kpis = {
  offersCount: number; sell: number; buy: number; profit: number;
  costedSell: number; costedCount: number; noCostCount: number; margin: number;
  confirmedCount: number; conversion: number; avg: number; pax: number; destinations: number;
};

function aggregate(rows: ExecRow[]) {
  const sell = rows.reduce((s, r) => s + r.sell, 0);
  const costed = rows.filter((r) => r.hasCost);
  const buy = costed.reduce((s, r) => s + (r.buy ?? 0), 0);
  const profit = costed.reduce((s, r) => s + (r.profit ?? 0), 0);
  const costedSell = costed.reduce((s, r) => s + r.sell, 0);
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const kpis: Kpis = {
    offersCount: rows.length,
    sell,
    buy,
    profit,
    costedSell,
    costedCount: costed.length,
    noCostCount: rows.length - costed.length,
    margin: costedSell > 0 ? (profit / costedSell) * 100 : 0,
    confirmedCount: confirmed.length,
    conversion: rows.length > 0 ? (confirmed.length / rows.length) * 100 : 0,
    avg: rows.length > 0 ? sell / rows.length : 0,
    pax: rows.reduce((s, r) => s + r.pax, 0),
    destinations: new Set(rows.map((r) => r.destination?.trim() || UNKNOWN_DEST)).size,
  };

  const mBy = new Map<string, { sell: number; profit: number }>();
  for (const r of rows) {
    if (!r.date) continue;
    const key = r.date.slice(0, 7);
    const cur = mBy.get(key) ?? { sell: 0, profit: 0 };
    cur.sell += r.sell;
    cur.profit += r.profit ?? 0;
    mBy.set(key, cur);
  }
  const monthly = [...mBy.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const dBy = new Map<string, number>();
  for (const r of rows) {
    const key = r.destination?.trim() || UNKNOWN_DEST;
    dBy.set(key, (dBy.get(key) ?? 0) + r.sell);
  }
  // Keep the top 7 and roll everything else into an "other" bucket so the bars
  // always reconcile with the Total-sales KPI (never silently drop a slice).
  const dSorted = [...dBy.entries()].sort((a, b) => b[1] - a[1]);
  const byDestination: [string, number][] =
    dSorted.length > 8
      ? [...dSorted.slice(0, 7), [OTHER_DEST, dSorted.slice(7).reduce((s, [, v]) => s + v, 0)]]
      : dSorted;

  const stageBy = new Map<string, number>();
  for (const r of rows) stageBy.set(r.stage, (stageBy.get(r.stage) ?? 0) + 1);

  const statusBy = new Map<string, number>();
  for (const r of rows) statusBy.set(r.status, (statusBy.get(r.status) ?? 0) + 1);

  return { kpis, monthly, byDestination, stageBy, statusBy };
}

// ---------- fetch orchestration (embeddable — no shell wrapper) ----------
/**
 * The executive overview (filters + KPIs + charts + table), embedded in the
 * main /dashboard for roles holding pricing.internal. Data stays gated
 * server-side in getExecutiveDashboard().
 */
export function ExecutiveOverview() {
  const { t } = useTraveliunUI();
  const [data, setData] = useState<ExecutiveDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await getExecutiveDashboard();
      if (!result.ok && result.authorized) setError(true);
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingState />
      ) : data && !data.authorized ? (
        <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <EmptyState title={t("dash.noPermission")} description={t("dash.noPermissionDesc")} />
        </section>
      ) : error || !data ? (
        <section className="rounded-2xl border border-[#f4c9d4] bg-[#fdeef2] p-6 text-center">
          <p className="mb-3 text-sm font-bold text-[#c22850]">{t("exec.loadError")}</p>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-md bg-[#185045] px-4 py-2 text-sm font-bold text-white hover:bg-[#0f4439]">
            <RotateCcw className="size-4" /> {t("exec.retry")}
          </button>
        </section>
      ) : data.rows.length === 0 ? (
        <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <EmptyState icon={Package} title={t("exec.noData")} description={t("exec.noDataDesc")} />
        </section>
      ) : (
        <ExecutiveContent data={data} />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="tv-shimmer h-[92px] rounded-2xl" />
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="tv-shimmer h-[104px] rounded-[15px]" />)}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="tv-shimmer h-[360px] rounded-2xl" />
        <div className="tv-shimmer h-[360px] rounded-2xl" />
      </div>
    </div>
  );
}

// ---------- content: filters + KPIs + charts + table ----------
type SortKey = keyof Pick<ExecRow, "serial" | "destination" | "customer" | "employee" | "sell" | "buy" | "profit" | "pax" | "date">;

function ExecutiveContent({ data }: { data: ExecutiveDashboard }) {
  const { t, dir, language } = useTraveliunUI();
  const rows = data.rows;

  // filter options derived from the full data set
  const months = useMemo(
    () => [...new Set(rows.map((r) => (r.date ? r.date.slice(0, 7) : null)).filter((m): m is string => Boolean(m)))].sort(),
    [rows],
  );
  const destinations = useMemo(() => [...new Set(rows.map((r) => r.destination?.trim() || UNKNOWN_DEST))].sort(), [rows]);
  const stages = useMemo(() => [...new Set(rows.map((r) => r.stage))], [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);

  const [dest, setDest] = useState("all");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState<string>(months[0] ?? "");
  const [to, setTo] = useState<string>(months[months.length - 1] ?? "");
  const [sort, setSort] = useState<{ col: SortKey; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });

  const reset = useCallback(() => {
    setDest("all"); setStage("all"); setStatus("all");
    setFrom(months[0] ?? ""); setTo(months[months.length - 1] ?? "");
  }, [months]);

  const view = useMemo(
    () =>
      rows.filter((r) => {
        if (dest !== "all" && (r.destination?.trim() || UNKNOWN_DEST) !== dest) return false;
        if (stage !== "all" && r.stage !== stage) return false;
        if (status !== "all" && r.status !== status) return false;
        // A month bound is active by default (from/to default to the full span).
        // An undated offer cannot satisfy a range, so exclude it — this keeps the
        // KPIs consistent with the monthly chart, which also drops undated rows.
        const m = r.date ? r.date.slice(0, 7) : null;
        if (from || to) {
          if (m == null) return false;
          if (from && m < from) return false;
          if (to && m > to) return false;
        }
        return true;
      }),
    [rows, dest, stage, status, from, to],
  );

  const { kpis, monthly, byDestination, stageBy, statusBy } = useMemo(() => aggregate(view), [view]);

  const sortedRows = useMemo(() => {
    const arr = [...view];
    const { col, dir: d } = sort;
    arr.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), language, { numeric: true });
      return d === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [view, sort, language]);

  const setSortCol = useCallback((col: SortKey) => {
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }));
  }, []);

  const cur = t("exec.currency");

  // KPI cards
  const kpiCards: { key: string; label: string; value: string; unit?: string; hint: string; icon: LucideIcon; color: string }[] = [
    { key: "sales", label: t("exec.kpi.sales"), value: fmtInt(kpis.sell), unit: cur, hint: t("exec.kpi.salesHint", { count: fmtInt(kpis.offersCount) }), icon: TrendingUp, color: "#2aa87a" },
    { key: "profit", label: t("exec.kpi.profit"), value: fmtInt(kpis.profit), unit: cur, hint: t("exec.kpi.profitHint", { margin: Math.round(kpis.margin), count: fmtInt(kpis.costedCount) }), icon: PiggyBank, color: "#0f7a52" },
    { key: "avg", label: t("exec.kpi.avg"), value: fmtInt(kpis.avg), unit: cur, hint: t("exec.kpi.avgHint", { pax: fmtInt(kpis.pax) }), icon: Receipt, color: "#0e9bb5" },
    { key: "offers", label: t("exec.kpi.offers"), value: fmtInt(kpis.offersCount), hint: t("exec.kpi.offersHint", { count: fmtInt(kpis.confirmedCount) }), icon: Package, color: "#185045" },
    { key: "conversion", label: t("exec.kpi.conversion"), value: String(Math.round(kpis.conversion)), unit: "%", hint: t("exec.kpi.conversionHint"), icon: CheckCircle2, color: "#d99a00" },
    { key: "destinations", label: t("exec.kpi.destinations"), value: fmtInt(kpis.destinations), hint: t("exec.kpi.destinationsHint"), icon: Globe2, color: "#c2603b" },
  ];

  // chart data (labels translated here; charts are dumb renderers)
  const monthlyData = monthly.map(([m, v]) => ({ label: monthLabel(m, language), sell: v.sell, profit: v.profit }));
  const statusData = [...STATUS_META.map((s) => s.key), ...[...statusBy.keys()].filter((k) => !STATUS_COLOR.has(k))]
    .filter((k) => (statusBy.get(k) ?? 0) > 0)
    .map((k) => ({ name: STATUS_LABEL_KEY.has(k) ? t(STATUS_LABEL_KEY.get(k)!) : k, value: statusBy.get(k) ?? 0, color: STATUS_COLOR.get(k) ?? "#8aa29b" }));
  const destData = byDestination.map(([label, value]) => ({
    label: label === OTHER_DEST ? t("exec.chart.otherDest", { count: kpis.destinations - 7 }) : label,
    value,
  }));
  const stageData = [
    ...KANBAN_STAGES.map((s) => ({ key: s.key, label: t(s.labelKey), value: stageBy.get(s.key) ?? 0 })),
    ...[...stageBy.keys()].filter((k) => !STAGE_LABEL_KEY.has(k)).map((k) => ({ key: k, label: k, value: stageBy.get(k) ?? 0 })),
  ].filter((d) => d.value > 0).map(({ label, value }) => ({ label, value }));

  const selectClass = "h-10 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm font-semibold text-[#185045] outline-none focus:border-[#2aa87a]";

  return (
    <>
      {/* header + filters */}
      <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
        <p className="mb-3 text-[12.5px] font-semibold text-[#8aa29b]">{t("exec.subtitle")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("exec.filter.destination")}>
            <select value={dest} onChange={(e) => setDest(e.target.value)} className={selectClass}>
              <option value="all">{t("exec.all")}</option>
              {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label={t("exec.filter.stage")}>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
              <option value="all">{t("exec.all")}</option>
              {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL_KEY.has(s) ? t(STAGE_LABEL_KEY.get(s)!) : s}</option>)}
            </select>
          </Field>
          <Field label={t("exec.filter.status")}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
              <option value="all">{t("exec.all")}</option>
              {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL_KEY.has(s) ? t(STATUS_LABEL_KEY.get(s)!) : s}</option>)}
            </select>
          </Field>
          <Field label={t("exec.filter.from")}>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m, language)}</option>)}
            </select>
          </Field>
          <Field label={t("exec.filter.to")}>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={selectClass}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m, language)}</option>)}
            </select>
          </Field>
          <button type="button" onClick={reset} className="ms-auto inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-4 text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]">
            <RotateCcw className="size-4" /> {t("exec.reset")}
          </button>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {kpiCards.map((c) => (
          <KpiCard key={c.key} label={c.label} value={c.value} unit={c.unit} hint={c.hint} icon={c.icon} color={c.color} />
        ))}
      </section>

      {/* data-quality note */}
      {kpis.noCostCount > 0 ? (
        <div className="rounded-[11px] border border-[#f2e2b4] bg-[#fff8e8] px-4 py-2.5 text-[12.5px] font-semibold text-[#8a5a0c]">
          {t("exec.dq", { count: fmtInt(kpis.noCostCount), costed: fmtInt(kpis.costedCount) })}
        </div>
      ) : null}

      {/* charts */}
      <section className="grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <ChartCard title={t("exec.chart.monthly")} caption={t("exec.chart.monthlyCap")}>
          <MonthlyChart data={monthlyData} sellLabel={t("exec.chart.sales")} profitLabel={t("exec.chart.profit")} unit={cur} dir={dir} />
        </ChartCard>
        <ChartCard title={t("exec.chart.status")} caption={t("exec.chart.statusCap")}>
          <StatusDoughnut data={statusData} />
        </ChartCard>
      </section>
      <section className="grid gap-3.5 lg:grid-cols-2">
        <ChartCard title={t("exec.chart.byDest")} caption={t("exec.chart.byDestCap")}>
          <DestinationBar data={destData} unit={cur} dir={dir} />
        </ChartCard>
        <ChartCard title={t("exec.chart.byStage")} caption={t("exec.chart.byStageCap")}>
          <StageBar data={stageData} dir={dir} />
        </ChartCard>
      </section>

      {/* table */}
      <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] lg:p-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("exec.table.title")}</h2>
          <span className="text-[12px] font-semibold text-[#93aaa3]">
            {t("exec.table.count", { shown: fmtInt(view.length), total: fmtInt(rows.length) })}
          </span>
        </div>
        {view.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#93aaa3]">{t("exec.table.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th onClick={() => setSortCol("serial")} active={sort.col === "serial"} dir={sort.dir}>{t("exec.table.serial")}</Th>
                  <Th onClick={() => setSortCol("destination")} active={sort.col === "destination"} dir={sort.dir}>{t("exec.table.destination")}</Th>
                  <Th onClick={() => setSortCol("customer")} active={sort.col === "customer"} dir={sort.dir}>{t("exec.table.customer")}</Th>
                  <Th onClick={() => setSortCol("employee")} active={sort.col === "employee"} dir={sort.dir}>{t("exec.table.employee")}</Th>
                  <Th onClick={() => setSortCol("date")} active={sort.col === "date"} dir={sort.dir}>{t("exec.table.date")}</Th>
                  <Th onClick={() => setSortCol("pax")} active={sort.col === "pax"} dir={sort.dir} numeric>{t("exec.table.pax")}</Th>
                  <Th onClick={() => setSortCol("sell")} active={sort.col === "sell"} dir={sort.dir} numeric>{t("exec.table.sell")}</Th>
                  <Th onClick={() => setSortCol("buy")} active={sort.col === "buy"} dir={sort.dir} numeric>{t("exec.table.buy")}</Th>
                  <Th onClick={() => setSortCol("profit")} active={sort.col === "profit"} dir={sort.dir} numeric>{t("exec.table.profit")}</Th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-start text-[11.5px] font-bold text-[#93aaa3]">{t("exec.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <tr key={`${r.serial}-${i}`} className="border-t border-[#eef2f0] hover:bg-[#f7faf8]">
                    <td className="whitespace-nowrap px-3 py-2.5 font-bold text-[#185045]"><DirText dir="ltr">{r.serial}</DirText></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#0f3d38]">{r.destination || t("exec.na")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#557d78]">{r.customer || t("exec.na")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#557d78]">{r.employee || t("exec.na")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#557d78]"><DirText dir="ltr">{r.date || t("exec.na")}</DirText></td>
                    <td className="tv-tnum whitespace-nowrap px-3 py-2.5 text-end text-[#0f3d38]"><DirText dir="ltr">{fmtInt(r.pax)}</DirText></td>
                    <td className="tv-tnum whitespace-nowrap px-3 py-2.5 text-end font-bold text-[#0f3d38]"><DirText dir="ltr">{fmtInt(r.sell)}</DirText></td>
                    <td className="tv-tnum whitespace-nowrap px-3 py-2.5 text-end text-[#557d78]">{r.buy != null ? <DirText dir="ltr">{fmtInt(r.buy)}</DirText> : <span className="text-[#93aaa3]">{t("exec.na")}</span>}</td>
                    <td className="tv-tnum whitespace-nowrap px-3 py-2.5 text-end font-bold">{r.profit != null ? <span className={r.profit >= 0 ? "text-[#0f7a52]" : "text-[#c22850]"}><DirText dir="ltr">{fmtInt(r.profit)}</DirText></span> : <span className="text-[#93aaa3]">{t("exec.na")}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <StatusChip status={r.status} label={STATUS_LABEL_KEY.has(r.status) ? t(STATUS_LABEL_KEY.get(r.status)!) : r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-[11.5px] font-semibold text-[#93aaa3]">
        <span>
          {t("exec.footer.ref", {
            offers: fmtInt(rows.length),
            customers: fmtInt(data.ref.customers),
            hotels: fmtInt(data.ref.hotels),
            countries: fmtInt(data.ref.countries),
          })}
        </span>
        <span>
          {t("exec.footer.source")} · {t("exec.footer.updated")}: <DirText dir="ltr">{data.generatedAt.replace("T", " ").slice(0, 16)}</DirText>
        </span>
      </div>
    </>
  );
}

// ---------- small presentational pieces ----------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-[#8aa29b]">{label}</span>
      {children}
    </label>
  );
}

function KpiCard({ label, value, unit, hint, icon: Icon, color }: { label: string; value: string; unit?: string; hint: string; icon: LucideIcon; color: string }) {
  return (
    <article className="rounded-[15px] border border-[#e2ebe7] bg-white p-[18px] shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]">
      <div className="flex items-start justify-between">
        <p className="text-[12.5px] font-bold text-[#6f8f88]">{label}</p>
        <span className="flex size-[38px] items-center justify-center rounded-[11px]" style={{ color, background: `${color}1a` }}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className="tv-tnum mt-2.5 text-[26px] font-extrabold text-[#003c3a]">
        <DirText dir="ltr">{value}</DirText>
        {unit ? <span className="ms-1 text-[14px] font-bold text-[#93aaa3]">{unit}</span> : null}
      </p>
      <p className="mt-1.5 text-[11.5px] font-semibold text-[#93aaa3]">{hint}</p>
    </article>
  );
}

function ChartCard({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] lg:p-5">
      <h3 className="text-sm font-extrabold text-[#003c3a]">{title}</h3>
      <p className="mb-3 mt-0.5 text-[11.5px] font-semibold text-[#93aaa3]">{caption}</p>
      {children}
    </div>
  );
}

function Th({ children, onClick, active, dir, numeric }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc"; numeric?: boolean }) {
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 text-[11.5px] font-bold ${numeric ? "text-end" : "text-start"} ${active ? "text-[#185045]" : "text-[#93aaa3]"}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 hover:text-[#185045] ${numeric ? "flex-row-reverse" : ""}`}>
        {children}
        <ArrowDownUp className={`size-3 ${active ? "opacity-100" : "opacity-30"}`} />
        {active ? <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function StatusChip({ status, label }: { status: string; label: string }) {
  const color = STATUS_COLOR.get(status) ?? "#8aa29b";
  return (
    <span className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ color, background: `${color}1a` }}>
      {label}
    </span>
  );
}
