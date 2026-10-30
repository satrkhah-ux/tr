"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { DirText } from "@/components/DirText";
import { addIssue, listIssues, resolveIssue, type OperationIssue } from "@/lib/data/operation-followup";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «مشكلات أثناء الرحلة» and, once back, the client's rating (operations order 6):
 * what happened, when, how it was solved — the case's memory for the next trip.
 */
export function IssuesPanel({ operationId }: { operationId: string }) {
  const { t } = useTraveliunUI();
  const [state, setState] = useState<Awaited<ReturnType<typeof listIssues>> | null>(null);
  const [text, setText] = useState("");
  const [solving, setSolving] = useState<Record<string, string>>({});
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => listIssues(operationId).then(setState), [operationId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section id="issues" className="tv-card rounded-2xl border p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-extrabold text-[#003c3a]">{t("ops.issue.title")}</h2>
        {state?.rating ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#fff8e8] px-2.5 py-1 text-[12px] font-bold text-[#a86a10]">
            <Star className="size-3.5" />
            {t("ops.issue.rating", { score: String(state.rating.score) })}
            {state.rating.comment ? ` — ${state.rating.comment}` : ""}
          </span>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {(state?.issues ?? []).map((i: OperationIssue) => (
          <li key={i.id} className="rounded-[10px] border border-[#e9f0ed] p-2.5 text-[12.5px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[#003c3a]">{i.description}</span>
              <span className="tv-tnum text-[11px] font-bold text-tv-text-faint">
                <DirText dir="ltr">{i.happened_at.slice(0, 16).replace("T", " ")}</DirText>
              </span>
            </div>
            {i.resolved_at ? (
              <p className="mt-1 font-semibold text-[#0f7a52]">✓ {i.resolution}</p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <input
                  id={`issue-fix-${i.id}`}
                  value={solving[i.id] ?? ""}
                  onChange={(e) => setSolving({ ...solving, [i.id]: e.target.value })}
                  placeholder={t("ops.issue.resolutionPlaceholder")}
                  className="h-8 min-w-0 flex-1 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[12px] font-semibold"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      setError(null);
                      const res = await resolveIssue(i.id, solving[i.id] ?? "");
                      if (res.ok) await load();
                      else setError(t(res.error));
                    })
                  }
                  className="inline-flex h-8 items-center rounded-[8px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045]"
                >
                  {t("ops.issue.resolve")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <input
          id={`issue-new-${operationId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("ops.issue.placeholder")}
          className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#dbe6e1] px-3 text-[12.5px] font-semibold"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              setError(null);
              const res = await addIssue(operationId, text);
              if (res.ok) {
                setText("");
                await load();
              } else setError(t(res.error));
            })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("ops.issue.add")}
        </button>
      </div>
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </section>
  );
}
