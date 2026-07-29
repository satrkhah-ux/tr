"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Search, Users } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import type { OperationCard } from "@/lib/data/operations";
import { severityRank, type OperationSignal } from "@/lib/operations/signals";
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
}: {
  /**
   * ONLY confirmed cases. The board deliberately does not list unconfirmed
   * offers: ops staff work what sales has handed over, and showing the whole
   * customer pipeline here made the one screen they live in unreadable.
   */
  operations: (OperationCard & { signals: OperationSignal[] })[];
  /** injected by the server page so the board and the signals agree on "now". */
  today: string;
}) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("needs_action");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return operations
      .filter((op) => {
        if (filter === "needs_action" && op.signals.length === 0) return false;
        if (filter === "unpaid" && !op.signals.some((s) => s.code === "unpaid_confirmed")) return false;
        if (filter === "travelling_soon" && !op.signals.some((s) => s.code === "travel_approaching_incomplete")) return false;
        if (!q) return true;
        return [op.serial, op.destination, op.customer_name, op.customer_phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const rank = severityRank(a.signals) - severityRank(b.signals);
        if (rank !== 0) return rank;
        return (a.travel_start ?? "9999").localeCompare(b.travel_start ?? "9999");
      });
  }, [operations, query, filter]);

  const counts = useMemo(
    () => ({
      needs_action: operations.filter((o) => o.signals.length > 0).length,
      all: operations.length,
      unpaid: operations.filter((o) => o.signals.some((s) => s.code === "unpaid_confirmed")).length,
      travelling_soon: operations.filter((o) => o.signals.some((s) => s.code === "travel_approaching_incomplete")).length,
    }),
    [operations],
  );

  const FILTERS: { key: Filter; labelKey: TranslationKey }[] = [
    { key: "needs_action", labelKey: "ops.needsAction" },
    { key: "travelling_soon", labelKey: "ops.signal.travel_approaching_incomplete" },
    { key: "unpaid", labelKey: "ops.signal.unpaid_confirmed" },
    { key: "all", labelKey: "all" },
  ];

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-2xl border border-[#e2ebe7] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h1 className="text-lg font-extrabold text-[#003c3a]">{t("ops.title")}</h1>
          <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("ops.subtitle")}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                  filter === f.key
                    ? "border-[#185045] bg-[#185045] text-white"
                    : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                }`}
              >
                {t(f.labelKey)}
                <span className={`tv-tnum text-[11px] ${filter === f.key ? "text-[#8fe3c4]" : "text-[#93aaa3]"}`}>
                  <DirText dir="ltr">{String(counts[f.key])}</DirText>
                </span>
              </button>
            ))}
            <div className="relative ms-auto">
              <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-10 w-56 rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-sm text-[#185045] outline-none focus:border-[#2aa87a]"
              />
            </div>
          </div>
        </section>

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
              <CaseCard key={op.id} op={op} />
            ))}
          </div>
        )}

        {/* today is injected so the server and the client agree on the clock */}
        <span className="hidden" data-today={today} />
      </div>
    </TraveliunShell>
  );
}

function CaseCard({ op }: { op: OperationCard & { signals: OperationSignal[] } }) {
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
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-1 text-[11px] font-bold text-[#557d78]">
          <Users className="size-3" />
          <DirText dir="ltr">{String(op.travelers_count)}</DirText>
        </span>
      </div>

      {/* both tracks, side by side — the whole point of not merging them */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Track label={t("ops.clientTrack")} value={t(CLIENT_KEY(op.client_status))} tone="brand" />
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
