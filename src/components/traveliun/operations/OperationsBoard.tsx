"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, PlaneTakeoff, Search, Users, Wallet, type LucideIcon } from "lucide-react";
import { DirText } from "@/components/DirText";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import type { OperationCard } from "@/lib/data/operations";
import { severityRank, type OperationSignal } from "@/lib/operations/signals";
import { matchesFilters, matchesQuery, NO_FILTERS, type ListFilters } from "@/lib/operations/case-list";
import { shownClientStatus } from "@/lib/operations/wizard/payment";
import type { StaffOption } from "@/lib/data/operation-case";
import { ArrivalsCalendar, OperationsFilters } from "./OperationsListControls";
import { MoneyLinks } from "./MoneyReports";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * The operations board.
 *
 * Bespoke rather than the config-driven table, because every «يحتاج إجراءً»
 * signal is DERIVED and time-dependent — "travel is approaching" becomes true
 * with no UPDATE anywhere — so there is no column for the generic engine to
 * filter on. Live cases number in the tens, so loading once and grouping in
 * memory is the honest trade.
 */

const CLIENT_KEY = (s: string) => `ops.client.${s}` as TranslationKey;
const EXEC_KEY = (s: string) => `ops.exec.${s}` as TranslationKey;
const SIGNAL_KEY = (c: string) => `ops.signal.${c}` as TranslationKey;

type Filter = "needs_action" | "all" | "unpaid" | "travelling_soon";

export function OperationsBoard({
  operations,
  today,
  owners,
  staff,
  canSeeMoney,
}: {
  /**
   * ONLY confirmed cases. The board deliberately does not list unconfirmed
   * offers: ops staff work what sales has handed over, and showing the whole
   * customer pipeline here made the one screen they live in unreadable.
   */
  operations: (OperationCard & { signals: OperationSignal[] })[];
  /** injected by the server page so the board and the signals agree on "now". */
  today: string;
  /** operation id → its owner's employee id (0064). */
  owners?: Record<string, string>;
  staff?: StaffOption[];
  /** pricing.internal: links to the money pages (order 11). Courtesy — each page checks again. */
  canSeeMoney?: boolean;
}) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("needs_action");
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);

  const listed = useMemo(() => operations.map((op) => ({ ...op, assignee_id: owners?.[op.id] ?? null })), [operations, owners]);
  // the default list: live cases only — cancelled and travelled ones do not crowd it
  const base = useMemo(() => listed.filter((op) => matchesFilters(op, filters)), [listed, filters]);
  const staffName = useMemo(() => new Map((staff ?? []).map((s) => [s.id, s.label])), [staff]);

  const rows = useMemo(() => {
    const q = query.trim();
    // a search reaches every case, closed ones too — the client on the phone may have travelled already
    const pool = q
      ? listed.filter((op) => matchesQuery(op, q) && matchesFilters(op, filters, true))
      : base.filter((op) => {
          if (filter === "needs_action" && op.signals.length === 0) return false;
          if (filter === "unpaid" && !op.signals.some((s) => s.code === "unpaid_confirmed")) return false;
          if (filter === "travelling_soon" && !op.signals.some((s) => s.code === "travel_approaching_incomplete")) return false;
          return true;
        });
    return pool.sort((a, b) => {
      const rank = severityRank(a.signals) - severityRank(b.signals);
      if (rank !== 0) return rank;
      return (a.travel_start ?? "9999").localeCompare(b.travel_start ?? "9999");
    });
  }, [listed, base, filters, query, filter]);

  const counts = useMemo(
    () => ({
      needs_action: base.filter((o) => o.signals.length > 0).length,
      all: base.length,
      unpaid: base.filter((o) => o.signals.some((s) => s.code === "unpaid_confirmed")).length,
      travelling_soon: base.filter((o) => o.signals.some((s) => s.code === "travel_approaching_incomplete")).length,
    }),
    [base],
  );
  const destinations = useMemo(() => [...new Set(operations.map((o) => o.destination).filter((d): d is string => Boolean(d)))].sort(), [operations]);

  // a card per list, in the colour of what it holds (the owner, 2026-10-18: «حولها الى بطاقات … يحتاج اجراء لون احمر»)
  const FILTERS: { key: Filter; labelKey: TranslationKey; icon: LucideIcon; tone: string; ring: string }[] = [
    { key: "needs_action", labelKey: "ops.needsAction", icon: AlertTriangle, tone: "border-[#f3c9c9] bg-[#fdf0f0] text-[#b42318]", ring: "ring-[#b42318]" },
    { key: "travelling_soon", labelKey: "ops.signal.travel_approaching_incomplete", icon: PlaneTakeoff, tone: "border-[#f6d3b3] bg-[#fff4ea] text-[#b54708]", ring: "ring-[#b54708]" },
    { key: "unpaid", labelKey: "ops.signal.unpaid_confirmed", icon: Wallet, tone: "border-[#efdc9f] bg-[#fdf8e6] text-[#8a6100]", ring: "ring-[#8a6100]" },
    { key: "all", labelKey: "all", icon: ClipboardCheck, tone: "border-[#cfe0d9] bg-[#eef6f2] text-[#185045]", ring: "ring-[#185045]" },
  ];

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-2xl border border-[#e2ebe7] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h1 className="text-lg font-extrabold text-[#003c3a]">{t("ops.title")}</h1>
          <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("ops.subtitle")}</p>
          {canSeeMoney ? <MoneyLinks /> : null}

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {FILTERS.map((f) => {
              const Icon = f.icon;
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-start transition-shadow hover:shadow-[0_2px_10px_rgba(0,60,58,0.08)]",
                    f.tone,
                    on && `ring-2 ring-offset-1 ${f.ring}`,
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/70">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="tv-tnum block text-2xl font-extrabold leading-none">
                      <DirText dir="ltr">{String(counts[f.key])}</DirText>
                    </span>
                    <span className="mt-1 block text-[12px] font-bold leading-snug">{t(f.labelKey)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex">
            <div className="relative ms-auto">
              <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("ops.list.searchHint")}
                className="h-10 w-64 max-w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-sm text-[#185045] outline-none focus:border-[#2aa87a]"
              />
            </div>
          </div>
          <OperationsFilters filters={filters} onChange={setFilters} destinations={destinations} staff={staff ?? []} />
        </section>

        <ArrivalsCalendar operations={listed} today={today} />

        {rows.length === 0 ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState
              icon={filter === "needs_action" && counts.all > 0 ? CheckCircle2 : ClipboardCheck}
              title={filter === "needs_action" && counts.all > 0 ? t("ops.allClear") : t("ops.noOperations")}
              description={counts.all === 0 ? t("ops.noOperationsHint") : ""}
            />
          </section>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {rows.map((op) => (
              <CaseCard key={op.id} op={op} owner={op.assignee_id ? (staffName.get(op.assignee_id) ?? null) : null} />
            ))}
          </div>
        )}

        {/* today is injected so the server and the client agree on the clock */}
        <span className="hidden" data-today={today} />
      </div>
    </TraveliunShell>
  );
}

function CaseCard({ op, owner }: { op: OperationCard & { signals: OperationSignal[] }; owner: string | null }) {
  const { t } = useTraveliunUI();
  const critical = op.signals.some((s) => s.severity === "critical");

  return (
    <Link
      href={`/operations/${op.id}`}
      className={`block rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-colors hover:bg-[#f8fbfa] ${
        critical ? "border-[#f0c7c7]" : op.signals.length > 0 ? "border-[#f2e2b4]" : "border-[#e2ebe7]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-extrabold text-[#003c3a]">{op.customer_name || "—"}</p>
          <p className="tv-tnum mt-0.5 text-[11.5px] font-bold text-[#93aaa3]">
            <DirText dir="ltr">{op.serial}</DirText>
            {op.destination ? <span className="ms-2 font-semibold">{op.destination}</span> : null}
            {op.partner_name ? (
              <span className="ms-2 rounded-full bg-[#f0e9f9] px-2 py-0.5 text-[10.5px] font-bold text-[#6a3fa0]">
                {t("ops.partnerTag", { name: op.partner_name })}
              </span>
            ) : null}
            {owner ? <span className="ms-2 rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[10.5px] font-bold text-[#2b57c4]">{owner}</span> : null}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-1 text-[11px] font-bold text-[#557d78]">
          <Users className="size-3" />
          <DirText dir="ltr">{String(op.travelers_count)}</DirText>
        </span>
      </div>

      {/* both tracks, side by side — the whole point of not merging them */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {/* the paid rungs as the recorded payments say, never a hand-picked «مسدّد» */}
        <Track label={t("ops.clientTrack")} value={t(CLIENT_KEY(shownClientStatus(op.client_status, op.total, op.paid)))} tone="brand" />
        <Track label={t("ops.executionTrack")} value={t(EXEC_KEY(op.execution_status))} tone="muted" />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] font-bold">
        <span className="text-[#557d78]">
          {t("ops.travelWindow")}{" "}
          <DirText dir="ltr">
            <span className="tv-tnum">{op.travel_start ?? "—"}</span>
          </DirText>
        </span>
        {op.total != null ? (
          <span className={op.paid >= op.total ? "text-[#0f7a52]" : "text-[#a86a10]"}>
            <DirText dir="ltr">
              <span className="tv-tnum">{`${op.paid} / ${op.total} ${op.currency ?? ""}`}</span>
            </DirText>
          </span>
        ) : null}
      </div>

      {op.signals.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-[#f0f4f2] pt-2.5">
          {op.signals.slice(0, 3).map((s) => (
            <li
              key={s.code}
              className={`flex items-start gap-1.5 text-[11.5px] font-bold ${
                s.severity === "critical" ? "text-[#c22850]" : s.severity === "warn" ? "text-[#a86a10]" : "text-[#557d78]"
              }`}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t(SIGNAL_KEY(s.code))}
                {s.subjects.length > 0 ? <span className="font-semibold text-[#93aaa3]"> — {s.subjects.slice(0, 2).join("، ")}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Link>
  );
}

function Track({ label, value, tone }: { label: string; value: string; tone: "brand" | "muted" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11.5px] font-bold ${
        tone === "brand" ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#eef4f1] text-[#557d78]"
      }`}
    >
      <span className="opacity-60">{label}</span>
      {value}
    </span>
  );
}
