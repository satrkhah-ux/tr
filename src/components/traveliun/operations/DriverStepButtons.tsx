"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDriverStep } from "@/lib/data/public-links";
import type { DriverStep } from "@/lib/operations/drivers";

/**
 * «انطلقت» then «استلمت الضيوف» on one pick-up of the driver's day. The driver
 * is not a system user: no shell, bilingual words, and the page reloads to
 * show what was recorded.
 */
export function DriverStepButtons({ token, bookingId, step }: { token: string; bookingId: string; step: DriverStep | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (step === "done") return null;
  const mark = (next: DriverStep) =>
    start(async () => {
      setError(null);
      try {
        const res = await markDriverStep(token, bookingId, next);
        if (!res.ok) setError(res.message);
        else router.refresh();
      } catch {
        setError("تعذّر الإرسال. حاول مرة أخرى. / Could not send. Try again.");
      }
    });

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {step === null ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => mark("on_way")}
          className="inline-flex h-12 items-center justify-center rounded-[12px] border-2 border-[#135549] bg-white px-4 text-[14px] font-extrabold text-[#135549] disabled:opacity-50"
        >
          انطلقت / On my way
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => mark("done")}
        className="inline-flex h-12 items-center justify-center rounded-[12px] bg-[#135549] px-4 text-[14px] font-extrabold text-white disabled:opacity-50"
      >
        استلمت الضيوف / Guests picked up
      </button>
      {error ? <p className="text-[12.5px] font-bold text-[#c22850] sm:col-span-2">{error}</p> : null}
    </div>
  );
}
