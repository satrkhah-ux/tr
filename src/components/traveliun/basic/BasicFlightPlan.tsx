"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { emptyFlight, type DraftData, type DraftFlight, type GeneratorLookups } from "@/lib/offer/draft-types";
import { airportDisplay, findAirport, planInternational, rankAirports, tripCountries, type FlightPlan } from "@/lib/offer/basic";
import { applyFlightHit, changeLeg, domesticTotal, newDomesticLeg, type LegChange } from "@/lib/offer/basic-flights";
import { parseFlightNumber } from "@/lib/offer/flight-number";
import { withTypedTotal } from "@/lib/offer/flight-fare";
import { localDatePart, localTimePart } from "@/lib/offer/schedule";
import { getAssistantAvailability, lookupFlightNumber } from "@/lib/data/itinerary-actions";
import type { FlightLookupHit } from "@/lib/providers/flight-lookup";
import { CabinOptions } from "../generator/flights/FlightBuilder";
import { FlightFare } from "../generator/flights/FlightFare";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { SuggestInput, type Suggestion } from "../SuggestInput";
import { basicField, typedNumber } from "./styles";
import { useBasicLabels } from "./labels";

/** the leg rows' columns: its name, the number and «جلب», the two airports, the day, the two clocks, the price */
/** a field's name above it where the wide row has no room for one */
const SMALL_CAPTION = "text-[10px] font-bold text-[#7a948f]";
const COLS = "xl:grid-cols-[4rem_minmax(8rem,0.9fr)_minmax(11rem,1.4fr)_minmax(11rem,1.4fr)_9.5rem_6.5rem_8rem_7rem_2rem]";

type Look = { busy?: boolean; note?: string; hits?: FlightLookupHit[] };

/** «SV820 MED → IST 2026-11-05» — a leg on one line. */
function legLine(f: DraftFlight): string {
  const code = (airport: string, city: string | undefined) => airport.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1] ?? (city || airport);
  return [f.flight_no, `${code(f.from_airport, f.from_city)} → ${code(f.to_airport, f.to_city)}`, localDatePart(f.departure_at) ?? ""].filter(Boolean).join(" ");
}

/**
 * The flights step (the owner, 2026-10-22). The international flights first —
 * each leg asked by its NUMBER, which «جلب» turns into the airline, the two
 * airports and the clocks (the day stays the agent's), the agent typing the
 * price; then «التالي» folds them to one line and the domestic flights follow
 * in the same place, each with its number, day, airports, clocks and price.
 * «أضف لاحقاً» leaves the international, the domestic or both for later.
 * Every field stays editable; nothing here blocks.
 */
export function BasicFlightPlan({
  data,
  lookups,
  defaults,
  part,
  onPart,
  onChange,
  current,
}: {
  data: DraftData;
  lookups: GeneratorLookups;
  /** what the flight usually is (out of Madinah, into the package's country) — the first legs. */
  defaults: FlightPlan;
  /** which part is open: the international legs, or the domestic ones under the international line */
  part: "intl" | "dom";
  onPart: (part: "intl" | "dom") => void;
  onChange: (slice: Partial<DraftData>) => void;
  /** the file as it is now — a lookup lands after other edits */
  current: () => DraftData;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const booking = data.flight_booking;
  const scope = data.scope;
  const intl = data.flights.filter((f) => f.leg_order !== "internal");
  const dom = data.flights.filter((f) => f.leg_order === "internal");
  const round = booking.mode !== "oneway";
  const intlOn = scope.flights_intl && !booking.later_intl;
  const domOn = scope.flights_domestic && !booking.later_dom;
  // the domestic part shows under the international line — at once when there is no international part
  const showDom = scope.flights_domestic && (part === "dom" || !intlOn);

  // the lookup's button only where the service is on (/developer) and its key is set
  const [canFetch, setCanFetch] = useState(false);
  useEffect(() => {
    void getAssistantAvailability()
      .then((a) => setCanFetch(a.flightLookup))
      .catch(() => setCanFetch(false));
  }, []);
  const [look, setLook] = useState<Record<string, Look>>({});
  const setLookOf = (id: string, l: Look) => setLook((all) => ({ ...all, [id]: l }));

  const asItems = (list: GeneratorLookups["airports"]): Suggestion[] =>
    list.map((a) => ({ value: airportDisplay(a), hint: a.city ?? a.country ?? undefined, keywords: [a.city, a.country, a.code, a.name_en].filter(Boolean).join(" ") }));
  const homeFirst = asItems(rankAirports(lookups.airports, "home"));
  const destFirst = asItems(rankAirports(lookups.airports, tripCountries(data), data.cities.map((c) => c.city_name)));

  /**
   * A city or a code typed and left becomes its airport («طرابزون» → «مطار طرابزون (TZX)»): free
   * text has no zone and no city, so the cities could not be built from it (the evaluator, 2026-10-22).
   * On leaving the field, never while typing — «IST» would jump before «Istanbul» is finished.
   */
  function settle(id: string, field: "from_airport" | "to_airport", typed: string) {
    const a = findAirport(typed, lookups.airports);
    if (a && airportDisplay(a) !== typed.trim()) edit(id, { [field]: airportDisplay(a) });
  }

  /** one leg changed, on the file as it is now; a domestic price adds up into the booking's */
  function edit(id: string, change: LegChange) {
    const d = current();
    const flights = changeLeg(d, lookups.airports, id, change);
    const b = d.flight_booking;
    onChange(change.price !== undefined ? { flights, flight_booking: { ...withTypedTotal(b, "dom", domesticTotal(flights)), dom_currency: b.dom_currency || "SAR" } } : { flights });
  }

  /** «MH1430» names its carrier: the airline fills in as the number is typed */
  function typeNumber(id: string, value: string) {
    const no = value.toUpperCase().replace(/\s+/g, "");
    const carrier = lookups.airlines.find((a) => a.iata && a.iata.toUpperCase() === parseFlightNumber(no)?.carrier);
    edit(id, { flight_no: no, ...(carrier ? { airline: carrier.name, airline_iata: carrier.iata } : {}) });
    setLookOf(id, {});
  }

  function apply(id: string, hit: FlightLookupHit) {
    const d = current();
    const leg = d.flights.find((f) => f.id === id);
    if (!leg) return;
    const out = applyFlightHit(leg, hit, { airports: lookups.airports, airlines: lookups.airlines, trip: d.trip });
    onChange({ flights: d.flights.map((f) => (f.id === id ? out.leg : f)) });
    setLookOf(id, { note: out.checkDate && hit.schedule_date ? tx("checkDate", { date: hit.schedule_date }) : undefined });
  }

  async function fetchLeg(leg: DraftFlight) {
    const id = leg.id ?? "";
    setLookOf(id, { busy: true });
    try {
      const res = await lookupFlightNumber(leg.flight_no);
      if (!res.ok) return setLookOf(id, { note: res.error === "pg.flightLookup.err.notFound" ? tx("flightNotFound") : t(res.error) });
      if (res.hits.length === 1) return apply(id, res.hits[0]);
      setLookOf(id, { hits: res.hits });
    } catch {
      setLookOf(id, { note: tx("flightNotFound") });
    }
  }

  /** there and back, or one way: the legs are planned again, each keeping what was typed on it */
  function setRound(r: boolean) {
    const out = intl.filter((f) => f.leg_order === "outbound");
    const back = intl.find((f) => f.leg_order === "inbound");
    const plan: FlightPlan = {
      from: out[0]?.from_airport ?? defaults.from,
      to: out.at(-1)?.to_airport ?? defaults.to,
      go: localDatePart(out[0]?.departure_at) ?? defaults.go,
      back: localDatePart(back?.departure_at) ?? defaults.back,
      round: r,
    };
    onChange(planInternational(data, lookups.airports, plan));
  }

  function setLater(which: "intl" | "dom" | "both") {
    onChange({
      flight_booking: {
        ...booking,
        ...(which !== "dom" ? { later_intl: true } : {}),
        ...(which !== "intl" ? { later_dom: true } : {}),
      },
    });
    if (which === "intl") onPart("dom");
  }
  const undoLater = (key: "later_intl" | "later_dom") => onChange({ flight_booking: { ...booking, [key]: undefined } });

  const laterLine = (label: string, key: "later_intl" | "later_dom") => (
    <p className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[#e7cf97] bg-[#fffaf0] px-3 py-2 text-[12px] font-bold text-[#a86a10]">
      {tx("laterLine", { part: label })}
      <button type="button" onClick={() => undoLater(key)} className="ms-auto text-[11.5px] font-bold text-[#185045] underline-offset-2 hover:underline">
        {tx("undoLater")}
      </button>
    </p>
  );

  const row = (leg: DraftFlight, name: string | null, items: { from: Suggestion[]; to: Suggestion[] }) => {
    const id = leg.id ?? "";
    const l = look[id] ?? {};
    const isDom = leg.leg_order === "internal";
    const day = localDatePart(leg.departure_at) ?? "";
    const time = (v: string | null) => {
      const x = localTimePart(v) ?? "";
      return x === "00:00" ? "" : x;
    };
    const nextDay = Boolean(day && leg.arrival_at && localDatePart(leg.arrival_at)! > day);
    return (
      <div key={id} className="space-y-1">
        {/* below the wide row some cells carry a caption: bottom-aligned, so the fields line up */}
        <div className={`grid grid-cols-2 items-end gap-2 sm:grid-cols-4 xl:items-center ${COLS}`}>
          <span className="text-[11.5px] font-extrabold text-[#0f3d38] max-xl:col-span-full">{name}</span>
          {/* the number first: «جلب» fills the rest */}
          <span className="flex items-center gap-1">
            <input
              dir="ltr"
              aria-label={tx("domFlightNo")}
              placeholder="TK2830"
              value={leg.flight_no}
              onChange={(e) => typeNumber(id, e.target.value)}
              className={`${basicField} tv-tnum min-w-0 text-center`}
            />
            {canFetch ? (
              <button
                type="button"
                onClick={() => void fetchLeg(leg)}
                disabled={l.busy || !leg.flight_no.trim() || (isDom && !day)}
                title={isDom && !day ? tx("needDate") : tx("fetchHint")}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[8px] border border-[#185045] px-2 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-45"
              >
                {l.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                {tx("fetchFlight")}
              </button>
            ) : null}
          </span>
          <span className="contents" onBlur={() => settle(id, "from_airport", leg.from_airport)}>
            <SuggestInput ariaLabel={tx("planFrom")} placeholder={tx("planFrom")} items={items.from} value={leg.from_airport} onChange={(v) => edit(id, { from_airport: v })} className={basicField} />
          </span>
          <span className="contents" onBlur={() => settle(id, "to_airport", leg.to_airport)}>
            <SuggestInput ariaLabel={tx("planTo")} placeholder={tx("planTo")} items={items.to} value={leg.to_airport} onChange={(v) => edit(id, { to_airport: v })} className={basicField} />
          </span>
          {/* under the wide row a phone shows an empty time as a blank box: each says what it is there */}
          <label className="grid gap-0.5">
            <span className={`${SMALL_CAPTION} xl:hidden`}>{tx("domDate")}</span>
            <input type="date" dir="ltr" aria-label={tx("domDate")} value={day} onChange={(e) => edit(id, { date: e.target.value })} className={`${basicField} tv-tnum px-2`} />
          </label>
          <label className="grid gap-0.5">
            <span className={`${SMALL_CAPTION} xl:hidden`}>{tx("domDep")}</span>
            <input type="time" dir="ltr" aria-label={tx("domDep")} value={time(leg.departure_at)} disabled={!day} onChange={(e) => edit(id, { dep: e.target.value })} className={`${basicField} tv-tnum px-2`} />
          </label>
          <span className="grid gap-0.5">
            <span className={`${SMALL_CAPTION} xl:hidden`}>{tx("domArr")}</span>
            <span className="flex items-center gap-1">
            <input type="time" dir="ltr" aria-label={tx("domArr")} value={time(leg.arrival_at)} disabled={!day} onChange={(e) => edit(id, { arr: e.target.value })} className={`${basicField} tv-tnum px-2`} />
            {nextDay ? (
              <span title={tx("nextDayHint", { city: leg.to_city ?? "" })} className="tv-tnum shrink-0 rounded-full bg-[#fff4dc] px-1.5 py-0.5 text-[10.5px] font-extrabold text-[#a86a10]">
                {tx("nextDay")}
              </span>
            ) : null}
            </span>
          </span>
          {isDom ? (
            <input
              type="number"
              min={0}
              dir="ltr"
              aria-label={tx("legPrice")}
              placeholder={tx("legPrice")}
              value={leg.price ?? ""}
              onChange={(e) => edit(id, { price: typedNumber(e.target) })}
              className={`${basicField} tv-tnum text-center`}
            />
          ) : (
            <span className="max-xl:hidden" />
          )}
          {isDom ? (
            <button
              type="button"
              aria-label={tx("removeLeg")}
              title={tx("removeLeg")}
              onClick={() => {
                const d = current();
                const flights = d.flights.filter((f) => f.id !== id);
                // the legs' prices made the total: it loses this one's
                const b = d.flight_booking;
                onChange(domesticTotal(d.flights) != null ? { flights, flight_booking: { ...withTypedTotal(b, "dom", domesticTotal(flights)), dom_currency: b.dom_currency || "SAR" } } : { flights });
              }}
              className="inline-flex size-8 items-center justify-center rounded-[7px] text-[#c43d3d] hover:bg-[#fff1f1]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {l.note ? <p className="text-[11px] font-bold text-[#a86a10]">{l.note}</p> : null}
        {l.hits ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
            {tx("pickRoute")}
            {l.hits.map((hit, i) => (
              <button key={i} type="button" onClick={() => apply(id, hit)} className="tv-tnum rounded-[7px] border border-[#cfe0d9] bg-[#f4f8f6] px-2 py-1 text-[#185045] hover:bg-[#e7f2ec]">
                {`${hit.from_iata} → ${hit.to_iata} ${localTimePart(hit.departure_at) ?? ""}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const laterChoices = [
    ...(intlOn ? [["intl", tx("laterIntl")] as const] : []),
    ...(domOn ? [["dom", tx("laterDom")] as const] : []),
    ...(intlOn && domOn ? [["both", tx("laterBoth")] as const] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {intlOn && part === "intl" ? (
          <div role="radiogroup" className="inline-flex rounded-[8px] border border-[#cfe0d9] bg-white p-0.5">
            {([true, false] as const).map((r) => (
              <button
                key={String(r)}
                type="button"
                role="radio"
                aria-checked={round === r}
                onClick={() => setRound(r)}
                className={`h-7 rounded-[6px] px-3 text-[11.5px] font-bold ${round === r ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
              >
                {tx(r ? "roundTrip" : "oneWay")}
              </button>
            ))}
          </div>
        ) : null}
        {laterChoices.length > 0 ? (
          <select
            aria-label={tx("later")}
            value=""
            onChange={(e) => e.target.value && setLater(e.target.value as "intl" | "dom" | "both")}
            className={`${basicField} ms-auto w-auto px-2 font-bold`}
          >
            <option value="">{tx("later")}</option>
            {laterChoices.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        ) : null}
      </div>

      {/* ---- the international flights: open, folded to a line, or left for later ---- */}
      {scope.flights_intl ? (
        booking.later_intl ? (
          laterLine(tx("laterIntl"), "later_intl")
        ) : part === "dom" ? (
          <button
            type="button"
            onClick={() => onPart("intl")}
            className="flex w-full items-center gap-2 rounded-[10px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2 text-start hover:border-[#a9cbbf]"
          >
            <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" />
            <span className="shrink-0 text-[12.5px] font-extrabold text-[#003c3a]">{tx("intlFlights")}</span>
            <span className="tv-tnum min-w-0 flex-1 truncate text-[12px] font-semibold text-[#557d78]">
              {[...intl.map(legLine), booking.intl_price != null ? `${booking.intl_price.toLocaleString("en-US")} ${booking.intl_currency || "SAR"}` : ""].filter(Boolean).join(" · ")}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-[#185045]">
              <Pencil className="size-3.5" />
              {tx("edit")}
            </span>
          </button>
        ) : (
          <div className="space-y-2">
            {intl.map((leg) =>
              row(leg, tx(leg.leg_order === "inbound" ? "planBack" : "planGo"), leg.leg_order === "inbound" ? { from: destFirst, to: homeFirst } : { from: homeFirst, to: destFirst }),
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-[#DCE9E5] pt-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
                {t("pg.cabin")}
                <select
                  aria-label={t("pg.cabin")}
                  value={booking.cabin}
                  onChange={(e) => {
                    const cabin = e.target.value;
                    // a new cabin goes on every international leg still in the booking's cabin — a leg given its own keeps it
                    onChange({
                      flight_booking: { ...booking, cabin },
                      flights: data.flights.map((f) => (f.leg_order !== "internal" && (!f.cabin_class || f.cabin_class === booking.cabin) ? { ...f, cabin_class: cabin } : f)),
                    });
                  }}
                  className={`${basicField} w-auto px-2`}
                >
                  <CabinOptions value={booking.cabin} />
                </select>
              </label>
              <input
                type="number"
                min={0}
                dir="ltr"
                aria-label={tx("planPrice")}
                placeholder={tx("planPrice")}
                value={booking.intl_price ?? ""}
                onChange={(e) => onChange({ flight_booking: { ...withTypedTotal(booking, "intl", typedNumber(e.target)), intl_currency: booking.intl_currency || "SAR" } })}
                className={`${basicField} tv-tnum w-64 max-w-full text-center`}
              />
              <span className="text-[11px] font-semibold text-[#7a948f]">{canFetch ? tx("fetchHint") : null}</span>
            </div>
            <FlightFare booking={booking} kind="intl" trip={data.trip} field={basicField} onChange={(flight_booking) => onChange({ flight_booking })} />
          </div>
        )
      ) : null}

      {/* ---- the domestic flights, in the same place, after the international ---- */}
      {showDom ? (
        booking.later_dom ? (
          laterLine(tx("laterDom"), "later_dom")
        ) : (
          <div className="space-y-2">
            <h3 className="text-[13px] font-extrabold text-[#0f3d38]">{tx("domFlights")}</h3>
            {dom.map((leg, i) => row(leg, `${i + 1}`, { from: destFirst, to: destFirst }))}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const d = current();
                  onChange({ flights: [...d.flights, newDomesticLeg(d, emptyFlight("internal", d.trip))] });
                }}
                className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#185045] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
              >
                <Plus className="size-4" />
                {tx("addDomestic")}
              </button>
              {dom.length > 0 ? (
                <span className="tv-tnum ms-auto text-[12px] font-extrabold text-[#185045]">
                  {tx("domTotal")}: {(domesticTotal(data.flights) ?? booking.dom_price ?? 0).toLocaleString("en-US")} {booking.dom_currency || "SAR"}
                </span>
              ) : null}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
