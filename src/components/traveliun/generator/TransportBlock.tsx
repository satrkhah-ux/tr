"use client";

import { Bus, Car, PlaneTakeoff, TrainFront, Check, Minus } from "lucide-react";
import {
  TRANSPORT_MODE_AR,
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
};

const MODES: TransportMode[] = ["car", "flight", "train"];

function LegCard({
  title,
  hint,
  icon: Icon,
  leg,
  onChange,
  children,
}: {
  title: string;
  hint: string;
  icon: typeof Car;
  leg: TransportLeg;
  onChange: (next: Partial<TransportLeg>) => void;
  children?: React.ReactNode;
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
          className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors ${
            leg.enabled ? "bg-[#185045] text-white" : "bg-[#eef4f1] text-[#93aaa3]"
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
          <p className="mt-0.5 text-[11.5px] font-semibold text-[#93aaa3]">{hint}</p>
        </div>
      </div>

      {leg.enabled ? (
        <div className="mt-3 grid gap-2.5">
          {children}
          <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
            {t("pg.transport.vehicle")}
            <input
              value={leg.car_type}
              onChange={(e) => onChange({ car_type: e.target.value })}
              placeholder={t("pg.transport.vehiclePlaceholder")}
              className={`${fieldClass} h-10`}
            />
          </label>
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
  onChange,
}: {
  plan: TransportPlan;
  onChange: (next: TransportPlan) => void;
}) {
  const { t } = useTraveliunUI();

  return (
    <div className="rounded-2xl border border-[#e2ebe7] bg-[#fbfdfc] p-5">
      <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f3d38]">
        <Bus className="size-4 text-[#185045]" />
        {t("pg.transport.title")}
      </h3>
      <p className="mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.transport.hint")}</p>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <LegCard
          title={t("pg.transport.airport")}
          hint={t("pg.transport.airportHint")}
          icon={Car}
          leg={plan.airport}
          onChange={(next) => onChange({ ...plan, airport: { ...plan.airport, ...next } })}
        />
        <LegCard
          title={t("pg.transport.tours")}
          hint={t("pg.transport.toursHint")}
          icon={Bus}
          leg={plan.tours}
          onChange={(next) => onChange({ ...plan, tours: { ...plan.tours, ...next } })}
        />
        <LegCard
          title={t("pg.transport.intercity")}
          hint={t("pg.transport.intercityHint")}
          icon={MODE_ICON[plan.intercity.mode]}
          leg={plan.intercity}
          onChange={(next) => onChange({ ...plan, intercity: { ...plan.intercity, ...next } })}
        >
          {/* Between cities the answer may not be a vehicle at all — a domestic
              flight or a train is the normal choice in Turkey, Japan, Europe. */}
          <div className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
            {t("pg.transport.mode")}
            <div className="flex gap-1.5">
              {MODES.map((mode) => {
                const ModeIcon = MODE_ICON[mode];
                const active = plan.intercity.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChange({ ...plan, intercity: { ...plan.intercity, mode } })}
                    aria-pressed={active}
                    className={`inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] border text-[12px] font-bold transition-colors ${
                      active
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
        </LegCard>
      </div>
    </div>
  );
}
