"use client";

import { Plane, Trash2 } from "lucide-react";
import type { DraftFlight, GeneratorLookups, LookupAirport } from "@/lib/offer/draft-types";
import { fieldClass } from "../generator/stage-props";
import { useBasicLabels } from "./labels";

/** «name (CODE)» — what the airport list shows and what a leg stores. */
export function airportDisplay(a: LookupAirport): string {
  return a.code ? `${a.name} (${a.code})` : a.name;
}

/** The airport a typed value names — the list's own text first, then the (CODE). */
function findAirport(value: string, airports: LookupAirport[]): LookupAirport | null {
  const v = value.trim();
  if (!v) return null;
  const code = v.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1]?.toUpperCase();
  return airports.find((a) => airportDisplay(a) === v) ?? (code ? airports.find((a) => a.code?.toUpperCase() === code) ?? null : null);
}

const label = "grid gap-1 text-[11px] font-bold text-[#557d78]";

/**
 * One flight, as one line: airline, number, the two airports, the two times.
 * The airport's zone and city are resolved here so the timings and the cities
 * card read the leg exactly as the full generator would have written it.
 */
export function BasicFlightRow({
  title,
  leg,
  lookups,
  onChange,
  onRemove,
}: {
  title: string;
  leg: DraftFlight;
  lookups: Pick<GeneratorLookups, "airports" | "airlines">;
  onChange: (slice: Partial<DraftFlight>) => void;
  onRemove: () => void;
}) {
  const tx = useBasicLabels();

  function setAirport(side: "from" | "to", value: string) {
    const hit = findAirport(value, lookups.airports);
    onChange(
      side === "from"
        ? { from_airport: value, from_tz: hit?.timezone ?? null, from_city: hit?.city ?? "" }
        : { to_airport: value, to_tz: hit?.timezone ?? null, to_city: hit?.city ?? "" },
    );
  }

  return (
    <div className="rounded-[12px] border border-[#ecd9e4] bg-[#fdf7fa] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-[#8a3a64]">
          <Plane className="size-3.5" />
          {title}
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={tx("removeLeg")}
          className="rounded-[8px] p-1.5 text-[#c43d3d] hover:bg-[#fff1f1]"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-[1.2fr_0.8fr_1.4fr_1.4fr_1.3fr_1.3fr]">
        <label className={label}>
          {tx("airline")}
          <select
            value={leg.airline_iata}
            onChange={(e) => {
              const a = lookups.airlines.find((x) => x.iata === e.target.value);
              onChange({ airline_iata: a?.iata ?? "", airline: a?.name ?? "" });
            }}
            className={fieldClass}
          >
            <option value="">{tx("choose")}</option>
            {lookups.airlines.map((a) => (
              <option key={a.iata} value={a.iata}>
                {a.name} ({a.iata})
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {tx("flightNo")}
          <input
            dir="ltr"
            value={leg.flight_no}
            onChange={(e) => onChange({ flight_no: e.target.value.toUpperCase() })}
            placeholder={leg.airline_iata ? `${leg.airline_iata}123` : "SV123"}
            className={`${fieldClass} text-center`}
          />
        </label>
        <label className={label}>
          {tx("from")}
          <input list="basic-airports" value={leg.from_airport} onChange={(e) => setAirport("from", e.target.value)} className={fieldClass} />
        </label>
        <label className={label}>
          {tx("to")}
          <input list="basic-airports" value={leg.to_airport} onChange={(e) => setAirport("to", e.target.value)} className={fieldClass} />
        </label>
        <label className={`${label} col-span-2 sm:col-span-1`}>
          {tx("departs")}
          <input
            type="datetime-local"
            dir="ltr"
            value={leg.departure_at ?? ""}
            // the agent chose this date — the trip dates stop moving it
            onChange={(e) => onChange({ departure_at: e.target.value || null, date_user_set: true })}
            className={`${fieldClass} tv-tnum px-2`}
          />
        </label>
        <label className={`${label} col-span-2 sm:col-span-1`}>
          {tx("lands")}
          <input
            type="datetime-local"
            dir="ltr"
            value={leg.arrival_at ?? ""}
            min={leg.departure_at ?? undefined}
            onChange={(e) => onChange({ arrival_at: e.target.value || null })}
            className={`${fieldClass} tv-tnum px-2`}
          />
        </label>
      </div>
    </div>
  );
}
