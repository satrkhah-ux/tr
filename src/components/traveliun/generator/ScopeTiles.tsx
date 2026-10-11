"use client";

import { Check, Minus, Plane, PlaneTakeoff, BedDouble, StickyNote, Car, ConciergeBell, Camera } from "lucide-react";
import { SCOPE_KEYS, SCOPE_LABEL_KEYS, type DraftData, type DraftScope } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «البرنامج يشمل» — the seven switches that decide which cards exist.
 *
 * They live on the TRIP card, because that is where the shape of the programme
 * is being decided: the country, the dates and what the sale covers are one
 * thought. Asked afterwards, an agent could fill in a flight they were never
 * selling; asked on a card of their own, they were a gate to click through
 * before the work started.
 *
 * «الجولات» is the odd one out, deliberately: it is not a scope key but the
 * tours vehicle leg itself (`transport_plan.tours.enabled`). One fact in one
 * place — a second boolean beside it could disagree with it, and then neither
 * the agent nor the document would know which one the client bought.
 */

const SCOPE_ICON: Record<keyof DraftScope, typeof Plane> = {
  hotels: BedDouble,
  flights_intl: Plane,
  flights_domestic: PlaneTakeoff,
  transport: Car,
  services: ConciergeBell,
  visas: StickyNote,
};

/**
 * The order the agency sells in — the flight first, then where they sleep, then
 * how they move between and around, then the extras and the visa. «الجولات» sits
 * with the vehicles it belongs to, not tacked on at the end.
 */
const TILE_ORDER: (keyof DraftScope | "tours")[] = [
  "flights_intl",
  "hotels",
  "flights_domestic",
  "transport",
  "tours",
  "services",
  "visas",
];

export function ScopeTiles({
  data,
  patch,
}: {
  data: DraftData;
  patch: (slice: Partial<DraftData>) => void;
}) {
  const { t } = useTraveliunUI();
  const scope = data.scope;
  const tours = data.transport_plan.tours.enabled;

  return (
    <div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {TILE_ORDER.map((key) =>
          key === "tours" ? (
            <ScopeTile
              key={key}
              icon={Camera}
              label={t("pg.scope.tours")}
              active={tours}
              onToggle={() =>
                patch({
                  transport_plan: {
                    ...data.transport_plan,
                    tours: { ...data.transport_plan.tours, enabled: !tours },
                  },
                })
              }
            />
          ) : (
            <ScopeTile
              key={key}
              icon={SCOPE_ICON[key]}
              label={t(SCOPE_LABEL_KEYS[key])}
              active={scope[key]}
              onToggle={() => patch({ scope: { ...scope, [key]: !scope[key] } })}
            />
          ),
        )}
      </div>

    </div>
  );
}

function ScopeTile({
  icon: Icon,
  label,
  active,
  onToggle,
}: {
  icon: typeof Plane;
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  const { t } = useTraveliunUI();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-[13px] border p-4 text-start transition-colors ${
        active
          ? "border-[#185045] bg-[#185045] text-white"
          : "border-[#dbe6e1] bg-white text-[#93aaa3] hover:bg-[#f4f8f6]"
      }`}
    >
      <Icon className="size-6 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-extrabold">{label}</span>
        <span className={`block text-[11px] font-bold ${active ? "text-[#8fe3c4]" : "text-[#b6c9c2]"}`}>
          {t(active ? "pg.scope.included" : "pg.scope.excluded")}
        </span>
      </span>
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
          active ? "bg-white/20" : "bg-[#eef4f1]"
        }`}
      >
        {active ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
      </span>
    </button>
  );
}
