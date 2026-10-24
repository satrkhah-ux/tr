"use client";

import { PlaneTakeoff } from "lucide-react";
import type { DraftData, DraftFlight, GeneratorLookups } from "@/lib/offer/draft-types";
import { applyFlightHit, changeLeg, type FlightHop, type LegChange, type LegGap } from "@/lib/offer/basic-flights";
import type { FlightLookupHit } from "@/lib/providers/flight-lookup";
import { airportItems, LegRow, useCanFetch } from "./BasicFlightPlan";
import { useBasicLabels, type BasicLabel } from "./labels";

const DAY = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const GAP_LABEL: Record<Exclude<LegGap, "day">, BasicLabel> = { from: "gapFrom", to: "gapTo", date: "gapDate", price: "gapPrice" };

/** «مطار الإقلاع، السعر للفرد» — what a leg still lacks, in words; its move's day when it flies on another. */
export function gapWords(tx: ReturnType<typeof useBasicLabels>, gaps: LegGap[], day: string | null): string {
  return gaps.map((g) => (g === "day" ? tx("gapDay", { date: day ?? "—" }) : tx(GAP_LABEL[g]))).join("، ");
}

/**
 * A move by air between two city cards (the evaluator, 2026-10-24: the domestic
 * flight lives on the hop, after the hotels, not in the flights step before the
 * cities): the leg the cities wrote for it — from the city's airport to the
 * next one's, on the day the city changes — with its number, airports, day,
 * clocks and ticket «للفرد», each editable here, and what it still lacks said
 * under it, so «ينقص» is cleared where it is read. A leg the cities wrote goes
 * when the hop is switched off «طيران»; one of the agent's own is removed here.
 * `hop` null: the legs no move claims («رحلات داخلية أخرى»).
 */
export function BasicHopFlight({
  hop,
  legs,
  data,
  lookups,
  gaps,
  onChange,
  current,
}: {
  hop: FlightHop | null;
  legs: DraftFlight[];
  data: DraftData;
  lookups: GeneratorLookups;
  /** what a leg still lacks before issuing (legGaps) */
  gaps: (leg: DraftFlight) => LegGap[];
  onChange: (slice: Partial<DraftData>) => void;
  current: () => DraftData;
}) {
  const tx = useBasicLabels();
  const canFetch = useCanFetch();
  const booking = data.flight_booking;
  if (legs.length === 0 || !data.scope.flights_domestic) return null;
  const { dest } = airportItems(data, lookups.airports);
  // the leg stays this move's whatever airport serves its cities
  const pin = hop ? { from: hop.from, to: hop.to } : undefined;
  const pax = data.trip.adults + data.trip.children;

  const edit = (id: string, change: LegChange) => onChange({ flights: changeLeg(current(), lookups.airports, id, change, pin) });
  function hit(id: string, h: FlightLookupHit): boolean {
    const d = current();
    const leg = d.flights.find((f) => f.id === id);
    if (!leg) return false;
    const out = applyFlightHit(leg, h, { airports: lookups.airports, airlines: lookups.airlines, trip: d.trip });
    onChange({ flights: d.flights.map((f) => (f.id === id ? (pin ? { ...out.leg, from_city: pin.from, to_city: pin.to } : out.leg) : f)) });
    return out.checkDate;
  }
  const remove = (id: string) => onChange({ flights: current().flights.filter((f) => f.id !== id) });

  if (booking.later_dom) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[#e7cf97] bg-[#fffaf0] px-3 py-2 text-[12px] font-bold text-[#a86a10]">
        <PlaneTakeoff className="size-4 shrink-0" />
        {tx("laterLine", { part: tx("laterDom") })}
        <button
          type="button"
          onClick={() => onChange({ flight_booking: { ...booking, later_dom: undefined } })}
          className="ms-auto text-[11.5px] font-bold text-[#185045] underline-offset-2 hover:underline"
        >
          {tx("undoLater")}
        </button>
      </p>
    );
  }

  return (
    <section className="space-y-2 rounded-[12px] border border-dashed border-[#b7d0c7] bg-[#f7fbf9] px-3 py-2">
      <header className="flex flex-wrap items-center gap-2">
        <PlaneTakeoff className="size-4 shrink-0 text-[#185045]" />
        <h4 className="text-[12.5px] font-extrabold text-[#0f3d38]">{hop ? tx("hopFlight", { from: hop.from, to: hop.to }) : tx("otherLegs")}</h4>
        {hop?.day ? <span className="tv-tnum text-[11.5px] font-bold text-[#557d78]">{DAY.format(new Date(`${hop.day}T00:00:00Z`))}</span> : null}
        <button
          type="button"
          onClick={() => onChange({ flight_booking: { ...booking, later_dom: true } })}
          className="ms-auto text-[11.5px] font-bold text-[#185045] underline-offset-2 hover:underline"
        >
          {tx("later")}
        </button>
      </header>
      {legs.map((leg, i) => {
        const missing = gaps(leg);
        return (
          <LegRow
            key={leg.id}
            leg={leg}
            name={legs.length > 1 ? `${i + 1}` : null}
            items={{ from: dest, to: dest }}
            airports={lookups.airports}
            airlines={lookups.airlines}
            canFetch={canFetch}
            onEdit={(change) => edit(leg.id ?? "", change)}
            onHit={(h) => hit(leg.id ?? "", h)}
            // a leg the cities wrote goes with its hop («برّي» on the city card); the agent's own goes here
            onRemove={leg.auto ? undefined : () => remove(leg.id ?? "")}
            price={{
              label: tx("legFare"),
              caption: leg.price != null && pax > 1 ? tx("fareTimes", { n: pax, total: (leg.price * pax).toLocaleString("en-US") }) : null,
            }}
            after={missing.length > 0 ? <p className="text-[11px] font-bold text-[#a86a10]">{tx("needFirst", { list: gapWords(tx, missing, hop?.day ?? null) })}</p> : null}
          />
        );
      })}
    </section>
  );
}
