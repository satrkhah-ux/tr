"use client";

import { useState } from "react";
import { ArrowDownUp, ArrowLeft, ArrowLeftRight, CalendarDays, MapPin, Plane, Plus, Route, Trash2, UsersRound } from "lucide-react";
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

// In the order an agent is asked: one way, there and back, several cities.
const MODES = [
  { mode: "oneway", key: "pg.fb.oneway", hint: "pg.fb.onewayHint", icon: ArrowLeft },
  { mode: "round", key: "pg.fb.round", hint: "pg.fb.roundHint", icon: ArrowLeftRight },
  { mode: "multi", key: "pg.fb.multi", hint: "pg.fb.multiHint", icon: Route },
] as const satisfies readonly { mode: FlightBookingMode; key: string; hint: string; icon: unknown }[];

/**
 * The first question on the flights card, asked before any field: what kind of
 * trip is it. Always on top — on an empty file it opens the builder in that
 * shape, on a file with flights it rebuilds the route in the shape picked.
 */
export function TripTypeCards({ mode, onPick }: { mode: FlightBookingMode; onPick: (mode: FlightBookingMode) => void }) {
  const { t } = useTraveliunUI();
  return (
    <div role="radiogroup" aria-label={t("pg.fb.tripType")} className="grid grid-cols-3 gap-2 sm:gap-3">
      {MODES.map((m) => {
        const active = mode === m.mode;
        const Icon = m.icon;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(m.mode)}
            className={`flex flex-col items-center gap-1 rounded-[16px] border-2 px-2 py-3 text-center transition-colors sm:py-4 ${
              active
                ? "border-[#185045] bg-[#185045] text-white shadow-[0_8px_18px_rgba(24,80,69,0.22)]"
                : "border-[#dbe6e1] bg-white text-[#185045] hover:border-[#9cc3b4] hover:bg-[#f4f8f6]"
            }`}
          >
            <Icon className="size-6" />
            <span className="text-[13.5px] font-extrabold sm:text-[15px]">{t(m.key)}</span>
            <span className={`hidden text-[11px] font-semibold sm:block ${active ? "text-white/80" : "text-[#78948f]"}`}>{t(m.hint)}</span>
          </button>
        );
      })}
    </div>
  );
}

const cell =
  "relative flex min-h-[64px] min-w-0 items-center gap-2.5 rounded-[13px] border border-[#e0ebe7] bg-white px-3.5 py-2 focus-within:border-[#2aa87a] focus-within:bg-[#f7fbf9]";
const cellLabel = "block text-[10.5px] font-bold text-[#78948f]";
const cellInput =
  "h-6 w-full min-w-0 border-0 bg-transparent p-0 text-[13px] font-bold text-[#123e3a] outline-none placeholder:text-[#9bb0ac]";

export function FlightBuilder({
  mode,
  cabin,
  onCabin,
  defaultDeparture,
  defaultReturn,
  passengers,
  onBuild,
}: {
  /** chosen on the TripTypeCards above the builder. */
  mode: FlightBookingMode;
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
