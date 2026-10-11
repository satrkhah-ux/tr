"use client";

import { useState } from "react";
import { ArrowDownUp, CalendarDays, MapPin, Plane, Plus, Trash2, UsersRound } from "lucide-react";
import type { FlightBookingMode } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * «الذهاب والعودة / ذهاب فقط / مدن متعددة» — how a booking engine asks for a
 * trip, in Traveliun's colours.
 *
 * It only DRAWS the legs: each segment becomes a flight row underneath, where
 * the number, the times and the baggage are filled in or fetched by number.
 * The passengers are the customer card's, shown and not asked again.
 */

export type BuilderSegment = { from: string; to: string; date: string };

export const CABINS = ["اقتصادية", "أعمال", "أولى"] as const;

const MODES: { mode: FlightBookingMode; key: "pg.fb.round" | "pg.fb.oneway" | "pg.fb.multi" }[] = [
  { mode: "round", key: "pg.fb.round" },
  { mode: "oneway", key: "pg.fb.oneway" },
  { mode: "multi", key: "pg.fb.multi" },
];

const cell =
  "relative flex min-h-[64px] min-w-0 items-center gap-2.5 rounded-[13px] border border-[#e0ebe7] bg-white px-3.5 py-2 focus-within:border-[#2aa87a] focus-within:bg-[#f7fbf9]";
const cellLabel = "block text-[10.5px] font-bold text-[#78948f]";
const cellInput =
  "h-6 w-full min-w-0 border-0 bg-transparent p-0 text-[13px] font-bold text-[#123e3a] outline-none placeholder:text-[#9bb0ac]";

export function FlightBuilder({
  mode,
  onMode,
  cabin,
  onCabin,
  defaultDeparture,
  defaultReturn,
  passengers,
  onBuild,
}: {
  mode: FlightBookingMode;
  onMode: (mode: FlightBookingMode) => void;
  cabin: string;
  onCabin: (cabin: string) => void;
  defaultDeparture: string | null;
  defaultReturn: string | null;
  passengers: { adults: number; children: number; infants: number };
  /** the segments in travel order; the caller turns them into flight legs. */
  onBuild: (segments: BuilderSegment[]) => void;
}) {
  const { t } = useTraveliunUI();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [depart, setDepart] = useState(defaultDeparture ?? "");
  const [back, setBack] = useState(defaultReturn ?? "");
  const [multi, setMulti] = useState<BuilderSegment[]>([
    { from: "", to: "", date: defaultDeparture ?? "" },
    { from: "", to: "", date: defaultReturn ?? "" },
  ]);

  const segments: BuilderSegment[] =
    mode === "multi"
      ? multi
      : mode === "oneway"
        ? [{ from, to, date: depart }]
        : [
            { from, to, date: depart },
            { from: to, to: from, date: back },
          ];
  const ready = segments.length > 0 && segments.every((s) => s.from.trim() && s.to.trim() && s.date);

  const people = [
    `${passengers.adults} ${t("pg.fb.adults")}`,
    passengers.children > 0 ? `${passengers.children} ${t("pg.fb.children")}` : "",
    passengers.infants > 0 ? `${passengers.infants} ${t("pg.fb.infants")}` : "",
  ]
    .filter(Boolean)
    .join("، ");

  return (
    <div className="overflow-hidden rounded-[18px] border-2 border-[#185045] bg-white">
      <div role="tablist" className="flex bg-[#eef4f1]">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="tab"
            aria-selected={mode === m.mode}
            onClick={() => onMode(m.mode)}
            className={`flex-1 rounded-t-[14px] px-3 py-2.5 text-[13px] font-extrabold transition-colors ${
              mode === m.mode ? "bg-[#185045] text-white" : "text-[#185045] hover:bg-[#e2ede8]"
            }`}
          >
            {t(m.key)}
          </button>
        ))}
      </div>

      <div className="space-y-2.5 p-3">
        {mode === "multi" ? (
          <div className="space-y-2">
            {multi.map((seg, i) => (
              <div key={i} className="grid gap-2 rounded-[13px] bg-[#f8fbf9] p-2 sm:grid-cols-[1fr_1fr_170px_auto]">
                <AirportCell label={`${t("pg.fb.from")} ${i + 1}`} value={seg.from} onChange={(v) => setMulti(multi.map((s, k) => (k === i ? { ...s, from: v } : s)))} />
                <AirportCell label={t("pg.fb.to")} value={seg.to} onChange={(v) => setMulti(multi.map((s, k) => (k === i ? { ...s, to: v } : s)))} />
                <DateCell label={t("pg.fb.date")} value={seg.date} onChange={(v) => setMulti(multi.map((s, k) => (k === i ? { ...s, date: v } : s)))} />
                {multi.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => setMulti(multi.filter((_, k) => k !== i))}
                    aria-label={t("pg.removeRow")}
                    className="self-center justify-self-start rounded-[9px] border border-[#f2c7c7] p-2 text-[#c43d3d] hover:bg-[#fff1f1]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setMulti([...multi, { from: multi[multi.length - 1]?.to ?? "", to: "", date: "" }])}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <Plus className="size-3.5" />
              {t("pg.fb.addSegment")}
            </button>
          </div>
        ) : (
          <>
            <div className="relative grid gap-2">
              <AirportCell label={t("pg.fb.from")} value={from} onChange={setFrom} />
              <AirportCell label={t("pg.fb.to")} value={to} onChange={setTo} />
              <button
                type="button"
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
                aria-label={t("pg.fb.swap")}
                title={t("pg.fb.swap")}
                className="absolute end-6 top-1/2 z-[1] flex size-9 -translate-y-1/2 items-center justify-center rounded-[10px] border border-[#cfe0d9] bg-[#eef4f1] text-[#185045] hover:bg-[#e2ede8]"
              >
                <ArrowDownUp className="size-4" />
              </button>
            </div>
            <div className={`grid gap-2 ${mode === "round" ? "grid-cols-2" : "grid-cols-1"}`}>
              <DateCell label={t("pg.fb.departDate")} value={depart} onChange={setDepart} />
              {mode === "round" ? <DateCell label={t("pg.fb.returnDate")} value={back} onChange={setBack} min={depart} /> : null}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#185045]" title={t("pg.fb.passengersHint")}>
            <UsersRound className="size-4" />
            {people}
          </span>
          <label className="ms-auto inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#185045]">
            <select
              value={cabin}
              onChange={(e) => onCabin(e.target.value)}
              className="h-9 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12.5px] font-bold text-[#185045]"
            >
              {CABINS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          disabled={!ready}
          onClick={() => onBuild(segments)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-[linear-gradient(145deg,#1d6a5d,#185045)] text-[14px] font-extrabold text-white shadow-[0_10px_20px_rgba(24,80,69,0.2)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plane className="size-5" />
          {t("pg.fb.build")}
        </button>
      </div>
    </div>
  );
}

function AirportCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={cell}>
      <MapPin className="size-[18px] shrink-0 text-[#185045]" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cellLabel}>{label}</span>
        {/* the stage's own datalist of airports, «name (CODE)» */}
        <input list="pg-airports" value={value} onChange={(e) => onChange(e.target.value)} className={cellInput} />
      </span>
    </label>
  );
}

function DateCell({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
}) {
  return (
    <label className={cell}>
      <CalendarDays className="size-[18px] shrink-0 text-[#185045]" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cellLabel}>{label}</span>
        <input
          type="date"
          dir="ltr"
          value={value}
          min={min || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`${cellInput} tv-tnum text-start`}
        />
      </span>
    </label>
  );
}
