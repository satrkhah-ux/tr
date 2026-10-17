"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Clock, Loader2, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { setStepWait } from "@/lib/data/operation-wizard";
import { addDays } from "@/lib/operations/wizard/followup";
import { WAIT_FROM, type StepWait, type WaitFrom, type WizardStep } from "@/lib/operations/wizard/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";

const chip =
  "inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[12px] font-bold transition-colors disabled:opacity-60";

/**
 * «ينتظر» — one press on any step: from whom, until when (tomorrow unless
 * changed), a note if any. Set, it shows as a banner with its own «إلغاء»;
 * the server drops it by itself once the step is done, from whatever screen.
 */
export function WaitButton({ operationId, step, wait, today }: { operationId: string; step: WizardStep; wait: StepWait | undefined; today: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<WaitFrom>("supplier");
  const [until, setUntil] = useState(() => addDays(today, 1));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useSafeTransition();

  const save = (next: Parameters<typeof setStepWait>[2]) =>
    run(async () => {
      setError(null);
      const res = await setStepWait(operationId, step, next);
      if (!res.ok) return setError(t(res.error));
      setOpen(false);
      router.refresh();
    });

  if (wait) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-[#f0d9a8] bg-[#fff8e8] px-3 py-2 text-[12px] font-bold text-[#a86a10]">
        <Clock className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {t("wz.wait.from", { from: t(`wz.from.${wait.from}` as TranslationKey), until: "" })}
          <DirText dir="ltr">{wait.until}</DirText>
          {wait.note ? <span className="ms-1.5 font-semibold text-[#8a6a2a]">— {wait.note}</span> : null}
        </span>
        <button type="button" disabled={pending} onClick={() => save(null)} className={`${chip} h-8 border-[#e6c98a] bg-white text-[#a86a10] hover:bg-[#fffdf6]`}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          {t("wz.wait.clear")}
        </button>
        {error ? <p className="w-full text-[11.5px] text-[#c22850]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${chip} border-[#e6c98a] bg-white text-[#a86a10] hover:bg-[#fff8e8]`}
      >
        <Clock className="size-3.5" />
        {t("wz.wait.button")}
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 rounded-[11px] border border-[#f0d9a8] bg-[#fffdf6] p-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("wz.wait.who")}>
            {WAIT_FROM.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={from === f}
                onClick={() => setFrom(f)}
                className={`${chip} ${from === f ? "border-[#a86a10] bg-[#a86a10] text-white" : "border-[#e6c98a] bg-white text-[#8a6a2a]"}`}
              >
                {t(`wz.from.${f}` as TranslationKey)}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#8a6a2a]">
              {t("wz.wait.until")}
              <input type="date" dir="ltr" min={today} value={until} onChange={(e) => setUntil(e.target.value)} className="tv-tnum h-10 rounded-[9px] border border-[#e6c98a] bg-white px-2 text-[13px] text-[#185045]" />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#8a6a2a]">
              {t("wz.wait.note")}
              <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="h-10 rounded-[9px] border border-[#e6c98a] bg-white px-3 text-[13px] text-[#185045]" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !until}
              onClick={() => save({ from, until, note })}
              className={`${chip} border-[#a86a10] bg-[#a86a10] text-white hover:bg-[#8f5a0d]`}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
              {t("wz.wait.save")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={`${chip} border-[#dbe6e1] bg-white text-[#557d78]`}>
              {t("cancel")}
            </button>
          </div>
          {error ? <p className="text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
