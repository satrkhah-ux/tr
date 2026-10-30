"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { CalendarDays, PlaneLanding, PlaneTakeoff, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EXECUTION_STATES } from "@/lib/operations/state";
import { movements, NO_FILTERS, type ListedCase, type ListFilters, type Span } from "@/lib/operations/case-list";
import type { StaffOption } from "@/lib/data/operation-case";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

const field =
  "tv-field h-9 rounded-[9px] border px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const label = "grid gap-1 text-[11px] font-bold text-[#557d78]";

/** The list's filters: travel date, destination, owner, status. Closed cases need their status picked. */
export function OperationsFilters({
  filters,
  onChange,
  destinations,
  staff,
}: {
  filters: ListFilters;
  onChange: (next: ListFilters) => void;
  destinations: string[];
  staff: StaffOption[];
}) {
  const { t } = useTraveliunUI();
  const set = (k: keyof ListFilters, v: string) => onChange({ ...filters, [k]: v });
  const dirty = Object.values(filters).some(Boolean);

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#f0f4f2] pt-3">
      <label className={label}>
        {t("ops.list.travelFrom")}
        <input type="date" dir="ltr" value={filters.from} onChange={(e) => set("from", e.target.value)} className={`${field} tv-tnum`} />
      </label>
      <label className={label}>
        {t("ops.list.travelTo")}
        <input type="date" dir="ltr" value={filters.to} onChange={(e) => set("to", e.target.value)} className={`${field} tv-tnum`} />
      </label>
      <label className={label}>
        {t("ops.list.destination")}
        <select value={filters.destination} onChange={(e) => set("destination", e.target.value)} className={field}>
          <option value="">{t("ops.list.anyDestination")}</option>
          {destinations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("ops.list.owner")}
        <select value={filters.assignee} onChange={(e) => set("assignee", e.target.value)} className={field}>
          <option value="">{t("ops.list.anyOwner")}</option>
          <option value="none">{t("ops.list.noOwner")}</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("ops.list.status")}
        <select value={filters.status} onChange={(e) => set("status", e.target.value)} className={field}>
          <option value="">{t("ops.list.liveOnly")}</option>
          {[...EXECUTION_STATES, "cancelled"].map((s) => (
            <option key={s} value={s}>
              {t(`ops.exec.${s}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      {dirty ? (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="inline-flex h-9 items-center gap-1 rounded-[9px] px-2 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] max-sm:min-h-10"
        >
          <X className="size-3.5" />
          {t("ops.list.clear")}
        </button>
      ) : null}
      {!filters.status ? <p className="w-full text-[11px] font-semibold text-tv-text-faint">{t("ops.list.closedHidden")}</p> : null}
    </div>
  );
}

/** «تقويم الوصول والمغادرة»: who lands and who flies home today, tomorrow, this week. */
export function ArrivalsCalendar<T extends ListedCase & { id: string }>({ operations, today }: { operations: T[]; today: string }) {
  const { t } = useTraveliunUI();
  const [span, setSpan] = useState<Span>("today");
  const { arrivals, departures } = useMemo(() => movements(operations, today, span), [operations, today, span]);
  const SPANS: { key: Span; labelKey: TranslationKey }[] = [
    { key: "today", labelKey: "ops.list.today" },
    { key: "tomorrow", labelKey: "ops.list.tomorrow" },
    { key: "week", labelKey: "ops.list.week" },
  ];

  return (
    <section className="tv-card rounded-2xl border px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
          <CalendarDays className="size-4" />
          {t("ops.list.calendar")}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {SPANS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSpan(s.key)}
              className={`rounded-full border px-3 py-1 text-[12px] font-bold transition-colors max-sm:min-h-10 ${
                span === s.key ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
              }`}
            >
              {t(s.labelKey)}
            </button>
          ))}
          <Link
            href="/operations/drivers"
            className="inline-flex items-center gap-1 rounded-full border border-[#dbe6e1] px-3 py-1 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            {t("ops.drv.schedule")}
          </Link>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Movement icon={<PlaneLanding className="size-3.5" />} title={t("ops.list.arrivals")} rows={arrivals} dateOf={(o) => o.travel_start} />
        <Movement icon={<PlaneTakeoff className="size-3.5" />} title={t("ops.list.departures")} rows={departures} dateOf={(o) => o.travel_end} />
      </div>
    </section>
  );
}

function Movement<T extends ListedCase & { id: string }>({
  icon,
  title,
  rows,
  dateOf,
}: {
  icon: ReactNode;
  title: string;
  rows: T[];
  dateOf: (o: T) => string | null;
}) {
  const { t } = useTraveliunUI();
  return (
    <div className="rounded-[12px] bg-[#f8fbf9] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-extrabold text-[#557d78]">
        {icon}
        {title}
        <span className="tv-tnum text-tv-text-faint">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-[12px] font-semibold text-tv-text-faint">{t("ops.list.nothing")}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((o) => (
            <li key={o.id}>
              <Link href={`/operations/${o.id}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-[8px] px-1.5 py-1 text-[12.5px] font-bold text-[#0f3d38] hover:bg-white">
                <span className="min-w-0 truncate">
                  {o.customer_name || "—"}
                  {o.destination ? <span className="font-semibold text-[#557d78]"> — {o.destination}</span> : null}
                </span>
                <span className="tv-tnum text-[11px] text-tv-text-faint">
                  <DirText dir="ltr">{`${o.serial} · ${dateOf(o) ?? ""}`}</DirText>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
