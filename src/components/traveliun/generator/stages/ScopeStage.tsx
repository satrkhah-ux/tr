"use client";

import { Check, Minus, Plane, PlaneTakeoff, BedDouble, StickyNote, Car, ConciergeBell, Camera } from "lucide-react";
import { SCOPE_KEYS, SCOPE_LABEL_KEYS, type DraftScope } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * «البرنامج يشمل» — asked FIRST, deliberately.
 *
 * These switches decide WHICH STAGES EXIST. An agent used to fill in the
 * customer, walk into «الطيران», and only then learn the offer was never meant
 * to include flights — or worse, not notice and price a leg the client never
 * asked for.
 *
 * «الجولات» is the odd one out and on purpose: it is not a scope key but the
 * tours vehicle leg itself (transport_plan.tours.enabled). One fact, one place
 * — a separate boolean beside it could disagree with it, and then neither the
 * agent nor the document would know which one the client bought.
 */

const SCOPE_ICON: Record<keyof DraftScope, typeof Plane> = {
  hotels: BedDouble,
  flights_intl: Plane,
  flights_domestic: PlaneTakeoff,
  transport: Car,
  services: ConciergeBell,
  visas: StickyNote,
};

export function ScopeStage({ data, patch }: StageFormProps) {
  const { t } = useTraveliunUI();
  const scope = data.scope;
  const tours = data.transport_plan.tours.enabled;
  const on = SCOPE_KEYS.filter((key) => scope[key]).length + (tours ? 1 : 0);

  return (
    <section className={sectionClass}>
      <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.scopeTitle")}</h2>
      <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("pg.scopeStageHint")}</p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {SCOPE_KEYS.map((key) => (
          <ScopeTile
            key={key}
            icon={SCOPE_ICON[key]}
            label={t(SCOPE_LABEL_KEYS[key])}
            active={scope[key]}
            onToggle={() => patch({ scope: { ...scope, [key]: !scope[key] } })}
          />
        ))}
        <ScopeTile
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
      </div>

      {/* Turning everything off leaves a wizard with nothing in it. Said here
          rather than caught later as a validation error, because the fix is one
          tap away and the agent is looking right at it. */}
      {on === 0 ? (
        <p className="mt-4 rounded-[10px] border border-[#f2e2b4] bg-[#fffdf7] px-4 py-3 text-[12px] font-bold text-[#a86a10]">
          {t("pg.scope.noneOn")}
        </p>
      ) : null}
    </section>
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
