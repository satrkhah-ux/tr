"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TranslationKey } from "@/lib/i18n";
import { FEATURES, isFeature, type Feature, type FeatureFlags } from "@/lib/features";
import { whenText } from "@/lib/developer/health";
import { setFeature } from "@/lib/data/app-settings";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «خدمات النظام» — the developer's switches (features.ts). A flip shows at once
 * and rolls back if the save fails; a saved one refreshes the page so the menu
 * and every gate read the new state.
 */

/** What each switch is called, and what turning it off actually does. */
const FEATURE_TEXT: Record<Feature, { label: TranslationKey; hint: TranslationKey }> = {
  legacy_generator: { label: "dev.f.legacy_generator", hint: "dev.f.legacy_generator.hint" },
  repackage: { label: "dev.f.repackage", hint: "dev.f.repackage.hint" },
  flight_card: { label: "dev.f.flight_card", hint: "dev.f.flight_card.hint" },
  ready_offers: { label: "dev.f.ready_offers", hint: "dev.f.ready_offers.hint" },
  kanban: { label: "dev.f.kanban", hint: "dev.f.kanban.hint" },
  ai_itinerary: { label: "dev.f.ai_itinerary", hint: "dev.f.ai_itinerary.hint" },
  flight_lookup: { label: "dev.f.flight_lookup", hint: "dev.f.flight_lookup.hint" },
  flight_tracking: { label: "dev.f.flight_tracking", hint: "dev.f.flight_tracking.hint" },
  murad_suggest: { label: "murad.f.suggest", hint: "murad.f.suggest.hint" },
  murad_auto: { label: "murad.f.auto", hint: "murad.f.auto.hint" },
};

export type FeatureChange = { id: string; at: string; who: string | null; feature: string; on: boolean };

export function ServiceSwitches({ flags, changes }: { flags: FeatureFlags; changes: FeatureChange[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [state, setState] = useState(flags);
  const [pending, setPending] = useState<Feature | null>(null);
  const [failed, setFailed] = useState<Feature | null>(null);

  async function toggle(feature: Feature) {
    const on = !state[feature];
    setFailed(null);
    setPending(feature);
    setState((s) => ({ ...s, [feature]: on }));
    let saved = false;
    try {
      saved = (await setFeature(feature, on)).ok;
    } catch {
      saved = false;
    }
    setPending(null);
    if (!saved) {
      setState((s) => ({ ...s, [feature]: !on }));
      setFailed(feature);
      return;
    }
    router.refresh();
  }

  const nameOf = (feature: string) => (isFeature(feature) ? t(FEATURE_TEXT[feature].label) : feature);

  return (
    <section className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">{t("dev.services")}</h2>
      <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">{t("dev.services.hint")}</p>

      <ul className="mt-2 divide-y divide-[#e2ebe7] dark:divide-[#294039]">
        {FEATURES.map((feature) => {
          const on = state[feature];
          const { label, hint } = FEATURE_TEXT[feature];
          return (
            <li key={feature} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-[#0f3d38]">
                  {t(label)}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${
                      on
                        ? "bg-[#e3f6ee] text-[#0f7a52] dark:bg-[#123a2c] dark:text-[#6fe0b0]"
                        : "bg-[#fdeaef] text-[#c22850] dark:bg-[#3d1621] dark:text-[#f68aa5]"
                    }`}
                  >
                    {t(on ? "dev.services.on" : "dev.services.off")}
                  </span>
                </p>
                <p className="mt-0.5 text-[11.5px] font-semibold text-[#93aaa3]">{t(hint)}</p>
                {failed === feature ? (
                  <p role="alert" className="mt-1 text-[11.5px] font-bold text-[#c22850]">
                    {t("dev.services.failed")}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={t(label)}
                disabled={pending !== null}
                onClick={() => void toggle(feature)}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                  on ? "bg-[#185045] dark:bg-[#2aa87a]" : "bg-[#c8d2cd] dark:bg-[#33554b]"
                }`}
              >
                <span
                  className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                    on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-4 border-t border-dashed border-[#dce7e2] pt-3 text-[12.5px] font-extrabold text-[#557d78]">{t("dev.changes")}</h3>
      {changes.length === 0 ? (
        <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">{t("dev.changes.empty")}</p>
      ) : (
        <ul className="mt-1.5 grid gap-1">
          {changes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] font-semibold text-[#557d78]">
              <span className="min-w-0 break-words">
                {t(c.on ? "dev.changes.on" : "dev.changes.off", { who: c.who ?? "—", feature: nameOf(c.feature) })}
              </span>
              <time dateTime={c.at} dir="ltr" className="text-[11px] font-bold text-[#93aaa3]">
                {whenText(c.at, true)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
