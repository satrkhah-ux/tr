"use client";

import { Check, Minus, Plane, BedDouble, StickyNote, Car } from "lucide-react";
import { SCOPE_KEYS, SCOPE_LABEL_KEYS, type DraftScope } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * Stage 1 — «خدمات هذا العرض».
 *
 * It was a block near the bottom of the customer stage, which had the order
 * backwards: these four switches decide WHICH STAGES EXIST. An agent used to
 * fill in the customer, walk into «الطيران», and only then learn the offer was
 * never meant to include flights — or worse, not notice and price a leg the
 * client never asked for.
 *
 * Asked first, the wizard that follows is already the right shape: turn a
 * service off and its stage disappears from the bar above.
 */

const SCOPE_ICON: Record<keyof DraftScope, typeof Plane> = {
  flights: Plane,
  hotels: BedDouble,
  visas: StickyNote,
  transport: Car,
};

export function ScopeStage({ data, patch }: StageFormProps) {
  const { t } = useTraveliunUI();
  const scope = data.scope;
  const on = SCOPE_KEYS.filter((key) => scope[key]).length;

  return (
    <section className={sectionClass}>
      <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.scopeTitle")}</h2>
      <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("pg.scopeStageHint")}</p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {SCOPE_KEYS.map((key) => {
          const active = scope[key];
          const Icon = SCOPE_ICON[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => patch({ scope: { ...scope, [key]: !active } })}
              aria-pressed={active}
              className={`flex items-center gap-3 rounded-[13px] border p-4 text-start transition-colors ${
                active
                  ? "border-[#185045] bg-[#185045] text-white"
                  : "border-[#dbe6e1] bg-white text-[#93aaa3] hover:bg-[#f4f8f6]"
              }`}
            >
              <Icon className="size-6 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-extrabold">{t(SCOPE_LABEL_KEYS[key])}</span>
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
        })}
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
