"use client";

import { Bus, Car, PlaneTakeoff, Ship, TrainFront, Check, Minus } from "lucide-react";
import {
  hopKey,
  hopMode,
  intercityModes,
  TRANSPORT_MODE_AR,
  type LookupCarType,
  type TransportLeg,
  type TransportMode,
  type TransportPlan,
} from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fieldClass } from "./stage-props";

/**
 * «المواصلات» — asked with the customer, because that is when it is decided.
 *
 * It used to be its own stage holding a table of from/to rows the agent
 * composed by hand, with ONE vehicle type for the whole file. That model could
 * not express the ordinary case: two travellers with six suitcases need a van
 * at the airport and a sedan for the day tours. The agent either priced the van
 * all week or explained the luggage at the kerb.
 *
 * So: three questions, each with its own vehicle. The rows the document prints
 * are derived from the answers (deriveTransportRows) — nothing downstream had
 * to learn a new shape.
 */

const MODE_ICON: Record<TransportMode, typeof Car> = {
  car: Car,
  flight: PlaneTakeoff,
  train: TrainFront,
  ship: Ship,
};

const MODES: TransportMode[] = ["car", "flight", "train"];

function LegCard({
  title,
  hint,
  icon: Icon,
  leg,
  carTypes,
  onChange,
  children,
  vehicle = true,
}: {
  title: string;
  hint: string;
  icon: typeof Car;
  leg: TransportLeg;
  carTypes: LookupCarType[];
  onChange: (next: Partial<TransportLeg>) => void;
  children?: React.ReactNode;
  /** false when the leg is never driven (every hop flown or by train) — no car to ask for. */
  vehicle?: boolean;
}) {
  const { t } = useTraveliunUI();
  return (
    <div
      className={`rounded-[13px] border p-4 transition-colors ${
        leg.enabled ? "border-[#cfe0d9] bg-white" : "border-[#e9eeec] bg-[#fafbfb]"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onChange({ enabled: !leg.enabled })}
          aria-pressed={leg.enabled}
          className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors max-sm:min-h-10 max-sm:min-w-10 ${
            leg.enabled ? "bg-[#185045] text-white" : "bg-[#eef4f1] text-tv-text-faint"
          }`}
          aria-label={title}
        >
          {leg.enabled ? <Check className="size-4" /> : <Minus className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-[#0f3d38]">
            <Icon className="size-4 text-[#185045]" />
            {title}
          </div>
          <p className="mt-0.5 text-[11.5px] font-semibold text-tv-text-faint">{hint}</p>
        </div>
      </div>

      {leg.enabled ? (
        <div className="mt-3 grid gap-2.5">
          {children}
          {vehicle ? (
          <div className="grid grid-cols-[1fr_5.5rem] gap-2">
            {/*
              The vehicle is CHOSEN, not typed. It used to be a free-text box,
              so the same van was written «فان», «ڤان» and «جي إم سي ٧ ركاب»
              across three files, none of them saying how many people fit —
              and the seat count is the whole question being answered.

              A value an older draft already holds stays selectable even when
              it is not in the catalogue: blanking an agent's own answer
              because a list changed is worse than showing an unknown name.
            */}
            <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
              {t("pg.transport.vehicle")}
              <select
                value={leg.car_type}
                onChange={(e) => onChange({ car_type: e.target.value })}
                className={`${fieldClass} h-10`}
              >
                <option value="">{t("pg.transport.chooseVehicle")}</option>
                {carTypes.map((car) => (
                  <option key={car.name} value={car.name}>
                    {car.pax ? `${car.name} — ${car.pax} ركاب` : car.name}
                  </option>
                ))}
                {leg.car_type && !carTypes.some((c) => c.name === leg.car_type) ? (
                  <option value={leg.car_type}>{leg.car_type}</option>
                ) : null}
              </select>
            </label>
            {/* Nine travellers are two vans. «فان» on its own both priced and
                promised one, and the second was argued about at the kerb. */}
            <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
              {t("pg.transport.cars")}
              <input
                type="number"
                min={1}
                dir="ltr"
                value={leg.cars}
                onChange={(e) => onChange({ cars: Math.max(Math.trunc(Number(e.target.value)) || 1, 1) })}
                className={`${fieldClass} tv-tnum h-10 text-center`}
              />
            </label>
          </div>
          ) : null}
          <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
            {t("pg.transport.note")}
            <input
              value={leg.note}
              onChange={(e) => onChange({ note: e.target.value })}
              className={`${fieldClass} h-10`}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function TransportBlock({
  plan,
  carTypes,
  cities,
  onChange,
}: {
  plan: TransportPlan;
  carTypes: LookupCarType[];
  /** The programme's cities in order — the intercity hops are derived from them. */
  cities: string[];
  onChange: (next: TransportPlan) => void;
}) {
  const { t } = useTraveliunUI();
  const cityCount = cities.length;
  const modes = intercityModes(plan);
  const hops = cities.slice(1).map((to, i) => ({ from: cities[i], to }));

  /** Several modes may be on at once — a country can use all three — but never none. */
  function toggleMode(mode: TransportMode) {
    const on = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    if (on.length === 0) return;
    const next = MODES.filter((m) => on.includes(m));
    onChange({ ...plan, intercity: { ...plan.intercity, modes: next, mode: next[0] } });
  }

  function setHop(from: string, to: string, mode: TransportMode) {
    const hop_modes = { ...plan.intercity.hop_modes, [hopKey(from, to)]: mode };
    onChange({ ...plan, intercity: { ...plan.intercity, hop_modes } });
  }

  return (
    <div className="rounded-2xl border border-[#e2ebe7] bg-[#fbfdfc] p-5">
      <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f3d38]">
        <Bus className="size-4 text-[#185045]" />
        {t("pg.transport.title")}
      </h3>
      <p className="mt-1 text-[11.5px] font-semibold text-tv-text-faint">{t("pg.transport.hint")}</p>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <LegCard
          title={t("pg.transport.airport")}
          hint={t("pg.transport.airportHint")}
          icon={Car}
          leg={plan.airport}
          carTypes={carTypes}
          onChange={(next) => onChange({ ...plan, airport: { ...plan.airport, ...next } })}
        />
        <LegCard
          title={t("pg.transport.tours")}
          hint={t("pg.transport.toursHint")}
          icon={Bus}
          leg={plan.tours}
          carTypes={carTypes}
          onChange={(next) => onChange({ ...plan, tours: { ...plan.tours, ...next } })}
        />
        <LegCard
          title={t("pg.transport.intercity")}
          hint={t("pg.transport.intercityHint")}
          icon={MODE_ICON[modes[0]]}
          leg={plan.intercity}
          carTypes={carTypes}
          vehicle={hops.length === 0 ? modes.includes("car") : hops.some((h) => hopMode(plan, h.from, h.to) === "car")}
          onChange={(next) => onChange({ ...plan, intercity: { ...plan.intercity, ...next } })}
        >
          {/*
            The intercity rows are DERIVED from the city list — one per hop —
            so with fewer than two cities this leg produces nothing anywhere:
            no row on the document, no note on a day. Turning it on and seeing
            no effect reads as a broken switch, and the cities are entered on
            the NEXT card, so say which is missing rather than leaving the
            agent to discover it.
          */}
          {cityCount < 2 ? (
            <p className="rounded-[9px] border border-[#f2e2b4] bg-[#fffdf7] px-3 py-2 text-[11.5px] font-bold text-[#a86a10]">
              {t("pg.transport.intercityNeedsCities")}
            </p>
          ) : null}

          {/* Between cities the answer may not be a vehicle at all — and in
              Malaysia or Turkey one programme drives one hop, flies the next
              and takes the train after. So several modes, then one per hop. */}
          <div className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
            {t("pg.transport.mode")}
            <span className="text-[10.5px] font-semibold text-tv-text-faint">{t("pg.transport.modesHint")}</span>
            <div className="flex gap-1.5">
              {MODES.map((mode) => {
                const ModeIcon = MODE_ICON[mode];
                const active = modes.includes(mode);
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => toggleMode(mode)}
                    aria-pressed={active}
                    className={`inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] border text-[12px] font-bold transition-colors ${
                      active
                        ? "border-[#185045] bg-[#185045] text-white"
                        : "border-[#dbe6e1] bg-white text-[#557d78] hover:bg-[#f4f8f6]"
                    }`}
                  >
                    {active ? <Check className="size-3.5" /> : <ModeIcon className="size-3.5" />}
                    {TRANSPORT_MODE_AR[mode]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* With more than one mode, each hop says which it takes. */}
          {modes.length > 1 && hops.length > 0 ? (
            <div className="grid gap-1.5 rounded-[10px] border border-[#e2ebe7] bg-[#fbfdfc] p-2.5">
              <p className="text-[11px] font-bold text-[#557d78]">{t("pg.transport.perHop")}</p>
              {hops.map(({ from, to }) => {
                const current = hopMode(plan, from, to);
                return (
                  <div key={`${from}>${to}`} className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[12px] font-bold text-[#185045]">
                      {from} ← {to}
                    </span>
                    <div className="flex gap-1">
                      {modes.map((mode) => {
                        const ModeIcon = MODE_ICON[mode];
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setHop(from, to, mode)}
                            aria-pressed={current === mode}
                            title={TRANSPORT_MODE_AR[mode]}
                            className={`inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-bold ${
                              current === mode
                                ? "border-[#185045] bg-[#185045] text-white"
                                : "border-[#dbe6e1] bg-white text-[#557d78] hover:bg-[#f4f8f6]"
                            }`}
                          >
                            <ModeIcon className="size-3.5" />
                            {TRANSPORT_MODE_AR[mode]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </LegCard>
      </div>
    </div>
  );
}
