"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2, PlaneTakeoff } from "lucide-react";
import { getReadiness } from "@/lib/data/operation-followup";
import { setExecutionStatus } from "@/lib/data/operations";
import type { ReadinessItem } from "@/lib/operations/progress";
import type { ExecutionStatus } from "@/lib/operations/state";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «جاهز للسفر» — the checklist the status waits for (operations order 6). Each
 * missing line in red, linking to the part of the page that fixes it; the
 * button appears only when every line is green (the server checks again).
 */
export function ReadinessPanel({ operationId, execution }: { operationId: string; execution: ExecutionStatus }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [items, setItems] = useState<ReadinessItem[] | null>(null);
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getReadiness(operationId).then((next) => {
      if (live) setItems(next);
    });
    return () => {
      live = false;
    };
  }, [operationId, execution]);

  if (execution === "ready_to_travel" || execution === "travelled" || execution === "cancelled") return null;
  const ready = items !== null && items.every((i) => i.ok);

  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-extrabold text-[#003c3a]">{t("ops.ready.title")}</h2>
        {ready ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                setError(null);
                const res = await setExecutionStatus(operationId, "ready_to_travel");
                if (res.ok) router.refresh();
                else setError(t(res.error));
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#0f7a52] px-3 text-[12px] font-bold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PlaneTakeoff className="size-4" />}
            {t("ops.ready.mark")}
          </button>
        ) : null}
      </div>
      {items === null ? (
        <p className="text-[12px] font-semibold text-[#93aaa3]">{t("ops.ready.loading")}</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.key}>
              <a
                href={`#${i.anchor}`}
                className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] font-bold ${i.ok ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fdeef2] text-[#c22850] hover:underline"}`}
              >
                {i.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <Circle className="size-4 shrink-0" />}
                <span className="min-w-0">{i.detail}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </section>
  );
}
