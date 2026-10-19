"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { setProfitSettings, setUsdRate, type ProfitSettings } from "@/lib/data/app-settings";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { TraveliunShell } from "./TraveliunShell";

/**
 * «سياسة الربح» — the administration decides once who puts the profit on a
 * package (the agent issuing it, or the managers only) and, if it wants, the
 * margin every file starts with.
 */
export function ProfitSettingsAdmin({ initial, usd: usdInitial }: { initial: ProfitSettings; usd: number }) {
  const { t } = useTraveliunUI();
  const [by, setBy] = useState(initial.by);
  const [pct, setPct] = useState<number | null>(initial.default_pct);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // «سعر صرف الدولار» (the owner, 2026-10-19: 3.80 instead of the market's)
  const [usd, setUsd] = useState<number>(usdInitial);
  const [usdState, setUsdState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function saveUsd() {
    setUsdState("saving");
    const result = await setUsdRate(usd);
    setUsdState(result.ok ? "saved" : "error");
  }

  async function save(next: ProfitSettings) {
    setState("saving");
    const result = await setProfitSettings(next);
    setState(result.ok ? "saved" : "error");
  }

  return (
    <TraveliunShell title="nav.profitPolicy">
      <section className="max-w-3xl rounded-[14px] border border-[#cfe0d9] bg-white p-4">
        <h2 className="text-[14px] font-extrabold text-[#185045]">{t("settings.profit.title")}</h2>
        <p className="mt-1 mb-3 text-[12px] font-semibold text-[#93aaa3]">{t("settings.profit.hint")}</p>
        <div role="radiogroup" aria-label={t("settings.profit.title")} className="flex flex-wrap gap-2">
          {(["staff", "managers"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={by === option}
              disabled={state === "saving"}
              onClick={() => {
                setBy(option);
                void save({ by: option, default_pct: pct });
              }}
              className={`inline-flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors disabled:opacity-60 ${
                by === option ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
              }`}
            >
              {by === option ? <CheckCircle2 className="size-4" /> : null}
              {t(option === "staff" ? "settings.profit.staff" : "settings.profit.managers")}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-dashed border-[#DCE9E5] pt-3">
          <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
            {t("settings.profit.defaultPct")}
            <input
              type="number"
              min={0}
              max={500}
              dir="ltr"
              value={pct ?? ""}
              placeholder="—"
              onChange={(e) => setPct(e.target.value === "" ? null : Number(e.target.value))}
              className="h-10 w-32 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-center text-[13px] text-[#0f3d38] outline-none focus:border-[#2aa87a]"
            />
          </label>
          <button
            type="button"
            onClick={() => void save({ by, default_pct: pct })}
            disabled={state === "saving"}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-extrabold text-white disabled:opacity-60"
          >
            {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {t("settings.profit.save")}
          </button>
          <p className="basis-full text-[11.5px] font-semibold text-[#93aaa3]">{t("settings.profit.defaultHint")}</p>
        </div>

        {state === "saved" ? (
          <p role="status" className="mt-2 text-[11.5px] font-bold text-[#0f7a52]">{t("settings.profit.saved")}</p>
        ) : state === "error" ? (
          <p role="alert" className="mt-2 text-[11.5px] font-bold text-[#c22850]">{t("err.db")}</p>
        ) : null}
      </section>

      <section className="mt-4 max-w-3xl rounded-[14px] border border-[#cfe0d9] bg-white p-4">
        <h2 className="text-[14px] font-extrabold text-[#185045]">{t("settings.usd.title")}</h2>
        <p className="mt-1 mb-3 text-[12px] font-semibold text-[#93aaa3]">{t("settings.usd.hint")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
            {t("settings.usd.label")}
            <input
              type="number"
              min={3}
              max={5}
              step={0.01}
              dir="ltr"
              value={usd}
              onChange={(e) => setUsd(Number(e.target.value))}
              className="h-10 w-32 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-center text-[13px] text-[#0f3d38] outline-none focus:border-[#2aa87a]"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveUsd()}
            disabled={usdState === "saving" || !(usd >= 3 && usd <= 5)}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-extrabold text-white disabled:opacity-60"
          >
            {usdState === "saving" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {t("settings.profit.save")}
          </button>
        </div>
        {usdState === "saved" ? (
          <p role="status" className="mt-2 text-[11.5px] font-bold text-[#0f7a52]">{t("settings.profit.saved")}</p>
        ) : usdState === "error" ? (
          <p role="alert" className="mt-2 text-[11.5px] font-bold text-[#c22850]">{t("err.db")}</p>
        ) : null}
      </section>
    </TraveliunShell>
  );
}
