"use client";

import { ArrowLeftRight, Ticket } from "lucide-react";
import type { DraftData, GeneratorLookups } from "@/lib/offer/draft-types";
import { airportDisplay, planInternational, rankAirports, tripCountries, type FlightPlan } from "@/lib/offer/basic";
import { basicField } from "./styles";
import { useBasicLabels } from "./labels";

const COLS = "xl:grid-cols-[minmax(13rem,1.5fr)_2.25rem_minmax(13rem,1.5fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]";

/**
 * The international flight as it is first asked: where from, where to, the two
 * days (the trip's own, until changed) and what it will roughly cost — enough to
 * price the package and send it. The tickets themselves (numbers, carriers,
 * times, transits) are entered later under «الرحلة النهائية».
 *
 * Writing here replaces the planned international legs and marks the booking
 * `estimate`, so a leg with no ticket yet is complete with its airports and day.
 */
export function BasicFlightPlan({
  data,
  lookups,
  defaults,
  onChange,
  onFinal,
}: {
  data: DraftData;
  lookups: GeneratorLookups;
  /** what the flight usually is (out of Madinah, into the package's country) — shown until legs exist. */
  defaults: FlightPlan;
  onChange: (slice: Partial<DraftData>) => void;
  /** open the ticket details. */
  onFinal: () => void;
}) {
  const tx = useBasicLabels();
  const booking = data.flight_booking;
  const outbound = data.flights.filter((f) => f.leg_order === "outbound");
  const inbound = data.flights.filter((f) => f.leg_order === "inbound");
  const round = booking.mode !== "oneway";
  const planned = outbound.length > 0;
  const now: FlightPlan = {
    from: planned ? outbound[0].from_airport : defaults.from,
    to: planned ? outbound[outbound.length - 1].to_airport : defaults.to,
    go: (outbound[0]?.departure_at ?? "").slice(0, 10) || data.trip.arrival_date || "",
    back: (inbound[0]?.departure_at ?? "").slice(0, 10) || data.trip.departure_date || "",
    round,
  };
  // the departure side lists Madinah and the Kingdom first; the arrival side, the package's country
  const homeFirst = rankAirports(lookups.airports, "home");
  const destFirst = rankAirports(lookups.airports, tripCountries(data), data.cities.map((c) => c.city_name));

  const write = (change: Partial<FlightPlan>) => onChange(planInternational(data, lookups.airports, { ...now, ...change }));

  const airportInput = (value: string, onValue: (v: string) => void, label: string, list: string) => (
    <input aria-label={label} placeholder={label} list={list} value={value} onChange={(e) => onValue(e.target.value)} className={basicField} />
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* there and back, or one way */}
        <div role="radiogroup" className="inline-flex rounded-[8px] border border-[#cfe0d9] bg-white p-0.5">
          {([true, false] as const).map((r) => (
            <button
              key={String(r)}
              type="button"
              role="radio"
              aria-checked={round === r}
              onClick={() => write({ round: r })}
              className={`h-7 rounded-[6px] px-3 text-[11.5px] font-bold ${round === r ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
            >
              {tx(r ? "roundTrip" : "oneWay")}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold text-[#7a948f]">{tx("planHint")}</span>
      </div>

      <div className={`hidden gap-2 px-0.5 text-[10.5px] font-bold text-[#7a948f] xl:grid ${COLS}`}>
        <span>{tx("planFrom")}</span>
        <span />
        <span>{tx("planTo")}</span>
        <span>{tx("planGo")}</span>
        <span>{round ? tx("planBack") : ""}</span>
        <span>{tx("planPrice")}</span>
      </div>
      <div className={`grid grid-cols-2 items-center gap-2 ${COLS}`}>
        {airportInput(now.from, (v) => write({ from: v }), tx("planFrom"), "basic-plan-home")}
        <button
          type="button"
          onClick={() => write({ from: now.to, to: now.from })}
          aria-label={tx("swap")}
          title={tx("swap")}
          className="inline-flex size-9 items-center justify-center rounded-[8px] border border-[#cfe0d9] bg-[#eef4f1] text-[#185045] max-xl:hidden"
        >
          <ArrowLeftRight className="size-4" />
        </button>
        {airportInput(now.to, (v) => write({ to: v }), tx("planTo"), "basic-plan-dest")}
        <input type="date" dir="ltr" aria-label={tx("planGo")} value={now.go} onChange={(e) => write({ go: e.target.value })} className={`${basicField} tv-tnum px-2`} />
        {round ? (
          <input
            type="date"
            dir="ltr"
            aria-label={tx("planBack")}
            value={now.back}
            min={now.go || undefined}
            onChange={(e) => write({ back: e.target.value })}
            className={`${basicField} tv-tnum px-2`}
          />
        ) : (
          <span className="max-xl:hidden" />
        )}
        {/* the whole booking, roughly — enough to price the package */}
        <input
          type="number"
          min={0}
          dir="ltr"
          aria-label={tx("planPrice")}
          placeholder={tx("planPrice")}
          value={booking.intl_price ?? ""}
          onChange={(e) => {
            const flight_booking = { ...booking, intl_price: e.target.value === "" ? null : Number(e.target.value), intl_currency: booking.intl_currency || "SAR" };
            onChange(planned ? { flight_booking } : planInternational({ ...data, flight_booking }, lookups.airports, now));
          }}
          className={`${basicField} tv-tnum text-center`}
        />
      </div>
      <datalist id="basic-plan-home">
        {homeFirst.map((a) => (
          <option key={a.id} value={airportDisplay(a)} label={a.city ?? a.country ?? undefined} />
        ))}
      </datalist>
      <datalist id="basic-plan-dest">
        {destFirst.map((a) => (
          <option key={a.id} value={airportDisplay(a)} label={a.city ?? a.country ?? undefined} />
        ))}
      </datalist>

      <button
        type="button"
        onClick={onFinal}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#185045] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
      >
        <Ticket className="size-4" />
        {tx("finalFlight")}
      </button>
    </div>
  );
}
