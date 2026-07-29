"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Columns3,
  Contact,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  FileUp,
  Inbox,
  Package,
  PackageCheck,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Users,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { useRole } from "@/lib/roles/RoleContext";
import type { Permission } from "@/lib/roles/roles";
import {
  getAdminMetrics,
  getEmployeeMetrics,
  searchEmployees,
  touchPresence,
  type AdminMetrics,
  type EmployeeMetrics,
  type EmployeeOption,
} from "@/lib/data/metrics";
import type { OpsSummary } from "@/lib/data/operations-work";
import { TraveliunShell, navGroups } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { ExecutiveOverview } from "./ExecutiveDashboardClient";
import { OperationsSnapshot } from "./operations/OperationsSnapshot";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { TranslationKey } from "@/lib/i18n";

export function TraveliunDashboardClient({ opsSummary }: { opsSummary: OpsSummary }) {
  const { dashboardView } = useRole();
  const { t, dir } = useTraveliunUI();

  // Heartbeat so online-now / active-today reflect this real session.
  useEffect(() => {
    void touchPresence();
    const id = window.setInterval(() => void touchPresence(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <TraveliunShell title="nav.dashboard">
      <div className="tv-fade-up" dir={dir}>
        {dashboardView === "admin" ? (
          <AdminHome opsSummary={opsSummary} />
        ) : dashboardView === "employee" ? (
          <EmployeeHome opsSummary={opsSummary} />
        ) : (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState title={t("dash.noPermission")} description={t("dash.noPermissionDesc")} />
          </section>
        )}
      </div>
    </TraveliunShell>
  );
}

// ---------- sections: what is ready, and what came before ----------
/**
 * The home page lists the surfaces we have actually built or rebuilt. Everything
 * else — the older screens, still there and still working — moves inside one
 * collapsed disclosure, so the dashboard stops reading as a directory of 60 links
 * and starts reading as today's work.
 *
 * `PREVIOUS` is DERIVED from the shell's own nav rather than hand-listed: a
 * second list of every screen would rot the first time someone adds a route.
 */
type ReadyAction = { key: string; labelKey: TranslationKey; descKey: TranslationKey; href: string; icon: LucideIcon; color: string; perm?: Permission };

const READY_ACTIONS: ReadyAction[] = [
  { key: "operations", labelKey: "nav.operations", descKey: "dash.qa.operations", href: "/operations", icon: ClipboardCheck, color: "#185045", perm: "operations.write" },
  { key: "generator", labelKey: "nav.packageGenerator", descKey: "dash.qa.generator", href: "/package-generator", icon: FilePlus2, color: "#2aa87a" },
  { key: "readyOffers", labelKey: "nav.readyOffers", descKey: "dash.qa.readyOffers", href: "/ready-offers", icon: PackageCheck, color: "#8b5cf6" },
  { key: "repackage", labelKey: "nav.repackage", descKey: "dash.qa.repackage", href: "/repackage", icon: FileUp, color: "#0e9bb5", perm: "repackage.write" },
  { key: "kanban", labelKey: "nav.kanban", descKey: "dash.qa.kanban", href: "/kanban-board", icon: Columns3, color: "#d99a00" },
  { key: "offers", labelKey: "nav.packages", descKey: "dash.qa.offers", href: "/offers", icon: FileText, color: "#0f7a52" },
];

/** Reference data and rules we filled and verified — reached rarely, but ours. */
const PREPARED: { labelKey: TranslationKey; href: string; perm?: Permission }[] = [
  { labelKey: "nav.markupRules", href: "/markup-rules" },
  { labelKey: "nav.hotelSuppliers", href: "/settings/suppliers" },
  { labelKey: "nav.climate", href: "/setting/climate", perm: "settings.manage" },
  { labelKey: "nav.countries", href: "/countries" },
  { labelKey: "nav.cities", href: "/cities" },
  { labelKey: "nav.airports", href: "/airports" },
  { labelKey: "nav.roomTypes", href: "/rooms-types" },
  { labelKey: "nav.carTypes", href: "/cars-types" },
  { labelKey: "nav.roles", href: "/employees/roles", perm: "employees.manage" },
];

const HANDLED_HREFS = new Set<string>([
  "/dashboard",
  ...READY_ACTIONS.map((a) => a.href),
  ...PREPARED.map((p) => p.href),
]);

function ReadySections() {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const actions = READY_ACTIONS.filter((a) => !a.perm || can(a.perm));
  const prepared = PREPARED.filter((p) => !p.perm || can(p.perm));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-[#003c3a]">{t("dash.readySections")}</h2>
        <p className="text-[11.5px] font-semibold text-[#93aaa3]">{t("dash.readyHint")}</p>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {actions.map((a) => (
          <Link
            key={a.key}
            href={a.href}
            className="group flex items-center gap-3 rounded-[15px] border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] transition-transform group-hover:scale-105" style={{ color: a.color, background: `${a.color}1a` }}>
              <a.icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-extrabold text-[#0f3d38]">{t(a.labelKey)}</span>
              <span className="block truncate text-[11.5px] font-semibold text-[#93aaa3]">{t(a.descKey)}</span>
            </span>
          </Link>
        ))}
      </div>

      {prepared.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[13px] border border-[#e8efeb] bg-white px-4 py-3">
          <span className="text-[11.5px] font-extrabold text-[#557d78]">{t("dash.preparedSettings")}</span>
          {prepared.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="rounded-full border border-[#dbe6e1] px-3 py-1 text-[11.5px] font-bold text-[#185045] transition-colors hover:border-[#2aa87a] hover:bg-[#f0f7f4]"
            >
              {t(p.labelKey)}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The older sections, collapsed.
 *
 * A native <details> rather than a JS disclosure: the browser already owns the
 * open/close state, the keyboard behaviour and the accessibility, and it works
 * before hydration.
 */
function PreviousSections() {
  const { t } = useTraveliunUI();
  const { can } = useRole();

  const groups = navGroups
    .filter((group) => !group.perm || can(group.perm))
    .map((group) => ({
      labelKey: group.labelKey,
      icon: group.icon,
      links: (group.children ?? [{ labelKey: group.labelKey, href: group.href }]).filter((c) => !HANDLED_HREFS.has(c.href)),
    }))
    .filter((group) => group.links.length > 0);

  const count = groups.reduce((n, g) => n + g.links.length, 0);
  if (count === 0) return null;

  return (
    <details className="group rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-4 marker:content-none">
        <ChevronDown className="size-4 text-[#557d78] transition-transform duration-200 group-open:rotate-180" />
        <span className="text-sm font-extrabold text-[#185045]">{t("dash.previousSections")}</span>
        <span className="tv-tnum rounded-full bg-[#eef4f1] px-2 py-0.5 text-[11px] font-bold text-[#557d78]">
          <DirText dir="ltr">{String(count)}</DirText>
        </span>
        <span className="ms-auto text-[11.5px] font-semibold text-[#93aaa3]">{t("dash.previousHint")}</span>
      </summary>
      <div className="grid gap-4 border-t border-[#eef2f0] p-5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {groups.map((group) => (
          <div key={group.labelKey}>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold text-[#557d78]">
              <group.icon className="size-4" />
              {t(group.labelKey)}
            </p>
            <ul className="space-y-0.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block truncate rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold text-[#185045] transition-colors hover:bg-[#f4f8f6]"
                  >
                    {t(link.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- ADMIN home: operations first, then sections, then the tabs ----------
function AdminHome({ opsSummary }: { opsSummary: OpsSummary }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canExec = can("pricing.internal");
  const [tab, setTab] = useState<"exec" | "team">(canExec ? "exec" : "team");

  const tabClass = (active: boolean) =>
    `inline-flex h-10 items-center gap-2 rounded-[9px] px-4 text-[13px] font-bold transition-colors ${
      active ? "bg-[#185045] text-white shadow-[0_2px_8px_rgba(24,80,69,0.25)]" : "text-[#557d78] hover:bg-[#f0f7f4]"
    }`;

  return (
    <div className="space-y-4">
      {/* live work before navigation: a case whose free-cancellation window
          closes tomorrow matters more than a link to the generator. */}
      <OperationsSnapshot summary={opsSummary} />
      <ReadySections />

      {canExec ? (
        <div className="inline-flex rounded-[12px] border border-[#dbe6e1] bg-white p-1 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <button type="button" onClick={() => setTab("exec")} className={tabClass(tab === "exec")}>
            <BarChart3 className="size-4" /> {t("dash.tab.executive")}
          </button>
          <button type="button" onClick={() => setTab("team")} className={tabClass(tab === "team")}>
            <Users className="size-4" /> {t("dash.tab.team")}
          </button>
        </div>
      ) : null}

      {canExec && tab === "exec" ? <ExecutiveOverview /> : <TeamOperations />}

      <PreviousSections />
    </div>
  );
}

// ---------- EMPLOYEE home: operations + sections + own metrics ----------
function EmployeeHome({ opsSummary }: { opsSummary: OpsSummary }) {
  return (
    <div className="space-y-4">
      <OperationsSnapshot summary={opsSummary} />
      <ReadySections />
      <EmployeeDashboard />
      <PreviousSections />
    </div>
  );
}

// ---------- KPI card primitives (shared visual) ----------
function KpiCard({ label, value, detail, icon: Icon, color }: { label: string; value: string; detail?: string; icon: LucideIcon; color: string }) {
  return (
    <article className="rounded-[15px] border border-[#e2ebe7] bg-white p-[18px] shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]">
      <div className="flex items-start justify-between">
        <p className="text-[12.5px] font-bold text-[#6f8f88]">{label}</p>
        <span className="flex size-[38px] items-center justify-center rounded-[11px]" style={{ color, background: `${color}1a` }}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className="tv-tnum mt-2.5 text-[28px] font-extrabold text-[#003c3a]"><DirText>{value}</DirText></p>
      {detail ? <p className="mt-1.5 text-[11.5px] font-semibold text-[#93aaa3]">{detail}</p> : null}
    </article>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-[15px] border border-[#e2ebe7] bg-white p-[18px]">
      <div className="tv-shimmer mb-3 h-4 w-24 rounded-md" />
      <div className="tv-shimmer h-8 w-16 rounded-md" />
    </div>
  );
}

function CardError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <div className="rounded-[15px] border border-[#f4c9d4] bg-[#fdeef2] p-[18px]">
      <p className="mb-2 text-[13px] font-semibold text-[#c22850]">{t("dash.cardError")}</p>
      <button type="button" onClick={onRetry} className="text-[12px] font-bold text-[#185045] underline">{t("dash.retry")}</button>
    </div>
  );
}

const GRID = "grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]";

// ---------- EMPLOYEE VIEW ----------
type EmpCardDef = { key: string; label: TranslationKey; icon: LucideIcon; color: string; get: (m: EmployeeMetrics) => number };
const EMPLOYEE_CARDS: EmpCardDef[] = [
  { key: "today", label: "dash.requestsToday", icon: Inbox, color: "#2aa87a", get: (m) => m.requestsToday },
  { key: "packages", label: "dash.packages", icon: Package, color: "#0e9bb5", get: (m) => m.packages },
  { key: "executed", label: "dash.executed", icon: CheckCircle2, color: "#0f7a52", get: (m) => m.executed },
];

function EmployeeDashboard() {
  const { t } = useTraveliunUI();
  const [metrics, setMetrics] = useState<EmployeeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const result = await getEmployeeMetrics();
    if (!result.ok) setError(true);
    setMetrics(result);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const maxType = metrics ? Math.max(1, ...metrics.requestTypes.map((rt) => rt.count)) : 1;

  return (
    <div className="space-y-4">
      <section className={GRID}>
        {loading
          ? EMPLOYEE_CARDS.map((c) => <CardSkeleton key={c.key} />)
          : error
            ? EMPLOYEE_CARDS.map((c) => <CardError key={c.key} onRetry={load} />)
            : EMPLOYEE_CARDS.map((c) => <KpiCard key={c.key} label={t(c.label)} value={String(metrics ? c.get(metrics) : 0)} icon={c.icon} color={c.color} detail={t("dash.ownData")} />)}
      </section>

      <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
        <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("dash.requestTypes")}</h2>
        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="tv-shimmer h-6 rounded-md" />)}</div>
        ) : metrics && metrics.requestTypes.length > 0 ? (
          <div className="space-y-3">
            {metrics.requestTypes.map((rt) => (
              <div key={rt.type} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm font-bold text-[#185045]">{rt.type}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-[#eef4f1]">
                  <div className="h-full rounded-md bg-[#2aa87a]" style={{ width: `${Math.round((rt.count / maxType) * 100)}%` }} />
                </div>
                <span className="tv-tnum w-8 text-end text-sm font-extrabold text-[#0f3d38]"><DirText>{String(rt.count)}</DirText></span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-[#93aaa3]">{t("dash.noTypes")}</p>
        )}
      </section>
    </div>
  );
}

// ---------- ADMIN: team & requests (live presence + request metrics) ----------
type AdminCardDef = { key: string; label: TranslationKey; icon: LucideIcon; color: string; detail: TranslationKey; get: (m: AdminMetrics) => number };
const ADMIN_CARDS: AdminCardDef[] = [
  { key: "onlineNow", label: "dash.onlineNow", icon: Wifi, color: "#2aa87a", detail: "dash.onlineNowDetail", get: (m) => m.onlineNow },
  { key: "activeToday", label: "dash.activeToday", icon: Users, color: "#0e9bb5", detail: "dash.activeTodayDetail", get: (m) => m.activeToday },
  { key: "withRequests", label: "dash.withRequests", icon: Inbox, color: "#d99a00", detail: "dash.withRequestsDetail", get: (m) => m.employeesWithRequestsNow },
  { key: "answered", label: "dash.answered", icon: CheckCircle2, color: "#0f7a52", detail: "dash.answeredDetail", get: (m) => m.requestsAnswered },
  { key: "notResponded", label: "dash.notResponded", icon: AlertTriangle, color: "#e0577f", detail: "dash.notRespondedDetail", get: (m) => m.employeesNotResponded },
];

const LAYOUT_KEY = "traveliun-admin-cards";
type CardLayout = { order: string[]; hidden: string[] };

function loadLayout(): CardLayout {
  const base = { order: ADMIN_CARDS.map((c) => c.key), hidden: [] as string[] };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CardLayout>;
    const known = new Set(ADMIN_CARDS.map((c) => c.key));
    // keep only known keys, then append any new cards (extensibility).
    const order = (parsed.order ?? []).filter((k) => known.has(k));
    for (const c of ADMIN_CARDS) if (!order.includes(c.key)) order.push(c.key);
    return { order, hidden: (parsed.hidden ?? []).filter((k) => known.has(k)) };
  } catch {
    return base;
  }
}

function TeamOperations() {
  const { t } = useTraveliunUI();
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EmployeeOption[]>([]);
  const [selected, setSelected] = useState<EmployeeOption | null>(null);

  const [layout, setLayout] = useState<CardLayout>({ order: ADMIN_CARDS.map((c) => c.key), hidden: [] });
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => { setLayout(loadLayout()); }, []);

  const persist = useCallback((next: CardLayout) => {
    setLayout(next);
    try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async (employeeId?: string) => {
    setLoading(true);
    setError(false);
    const result = await getAdminMetrics(employeeId);
    if (!result.ok) setError(true);
    setMetrics(result);
    setLoading(false);
  }, []);

  useEffect(() => { void load(selected?.id); }, [load, selected]);

  // employee search (debounced)
  useEffect(() => {
    const id = window.setTimeout(async () => {
      if (query.trim().length === 0) { setOptions([]); return; }
      setOptions(await searchEmployees(query));
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const cardMap = useMemo(() => new Map(ADMIN_CARDS.map((c) => [c.key, c])), []);
  const visibleCards = layout.order.map((k) => cardMap.get(k)).filter((c): c is AdminCardDef => Boolean(c) && !layout.hidden.includes(c!.key));

  function move(key: string, dir: -1 | 1) {
    const order = [...layout.order];
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    persist({ ...layout, order });
  }
  function toggleHidden(key: string) {
    const hidden = layout.hidden.includes(key) ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key];
    persist({ ...layout, hidden });
  }

  return (
    <div className="space-y-4">
      {/* toolbar: employee search + customize */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
        <div className="relative h-11 w-full max-w-[320px]">
          <Search className="absolute end-3 top-1/2 size-5 -translate-y-1/2 text-[#8aa29b]" />
          <input
            value={selected ? selected.name : query}
            onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
            placeholder={t("dash.searchEmployee")}
            className="h-full w-full rounded-[11px] border border-[#dbe6e1] bg-[#f5f8f7] pe-11 ps-4 text-sm text-[#557d78] outline-none focus:border-[#2aa87a]"
          />
          {!selected && options.length > 0 ? (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[11px] border border-[#e2ebe7] bg-white shadow-lg">
              {options.map((o) => (
                <button key={o.id} type="button" onClick={() => { setSelected(o); setQuery(""); setOptions([]); }} className="block w-full px-4 py-2.5 text-start text-sm text-[#185045] hover:bg-[#f4f8f6]">
                  {o.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {selected ? (
          <button type="button" onClick={() => { setSelected(null); setQuery(""); }} className="inline-flex h-9 items-center gap-1 rounded-full bg-[#e8f1ed] px-3 text-xs font-bold text-[#185045]">
            {selected.name} <X className="size-3.5" />
          </button>
        ) : null}
        {/* MULTI-SELECT surface: a Popover that stays open across reorder/hide
            toggles (Base UI only dismisses on outside-click/Escape); an explicit
            "Done" button closes it. */}
        <Popover open={customizing} onOpenChange={setCustomizing}>
          <PopoverTrigger
            render={
              <button type="button" className="me-auto inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#dbe6e1] bg-white px-4 text-sm font-bold text-[#185045] outline-none hover:bg-[#f4f8f6] data-[popup-open]:border-[#2aa87a]">
                <SlidersHorizontal className="size-4" /> {t("dash.customize")}
              </button>
            }
          />
          <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">{t("dash.customizeTitle")}</h3>
              <button type="button" onClick={() => persist({ order: ADMIN_CARDS.map((c) => c.key), hidden: [] })} className="inline-flex items-center gap-1 text-xs font-bold text-[#557d78] hover:text-[#185045]">
                <RotateCcw className="size-3.5" /> {t("dash.resetDefault")}
              </button>
            </div>
            <div className="space-y-2">
              {layout.order.map((key, index) => {
                const def = cardMap.get(key);
                if (!def) return null;
                const isHidden = layout.hidden.includes(key);
                return (
                  <div key={key} className="flex items-center justify-between rounded-[10px] border border-[#eef2f0] px-3 py-2 dark:border-[#294039]">
                    <span className={`text-sm font-semibold ${isHidden ? "text-[#b6c4bf] line-through" : "text-[#185045] dark:text-[#d6e5df]"}`}>{t(def.label)}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => move(key, -1)} disabled={index === 0} className="flex size-8 items-center justify-center rounded-md border border-[#e2ebe7] text-[#557d78] hover:bg-[#f4f8f6] disabled:opacity-40"><ChevronUp className="size-4" /></button>
                      <button type="button" onClick={() => move(key, 1)} disabled={index === layout.order.length - 1} className="flex size-8 items-center justify-center rounded-md border border-[#e2ebe7] text-[#557d78] hover:bg-[#f4f8f6] disabled:opacity-40"><ChevronDown className="size-4" /></button>
                      <button type="button" onClick={() => toggleHidden(key)} className="flex size-8 items-center justify-center rounded-md border border-[#e2ebe7] text-[#557d78] hover:bg-[#f4f8f6]">{isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setCustomizing(false)} className="mt-3 w-full rounded-md bg-[#185045] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-[#0f4439]">
              {t("done")}
            </button>
          </PopoverContent>
        </Popover>
      </section>

      {/* cards */}
      <section className={GRID}>
        {loading
          ? visibleCards.map((c) => <CardSkeleton key={c.key} />)
          : error
            ? visibleCards.map((c) => <CardError key={c.key} onRetry={() => load(selected?.id)} />)
            : visibleCards.map((c) => <KpiCard key={c.key} label={t(c.label)} value={String(metrics ? c.get(metrics) : 0)} icon={c.icon} color={c.color} detail={t(c.detail)} />)}
      </section>

      {visibleCards.length === 0 ? (
        <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <EmptyState icon={Contact} title={t("dash.allHidden")} description={t("dash.allHiddenDesc")} />
        </section>
      ) : null}

      {/* not-responded employees list */}
      {!loading && metrics && metrics.notRespondedNames.length > 0 ? (
        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-[#003c3a]">
            <AlertTriangle className="size-5 text-[#e0577f]" /> {t("dash.pendingList")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {metrics.notRespondedNames.map((name, i) => (
              <span key={`${name}-${i}`} className="rounded-full bg-[#fdeef2] px-3 py-1 text-xs font-bold text-[#c22850]">{name}</span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
