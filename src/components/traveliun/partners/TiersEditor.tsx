"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { saveTiers } from "@/lib/partners/tiers-admin";
import type { Tier } from "@/lib/partners/tiers";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «سلّم العمولة» — after N confirmed files in a quarter the percentage
 * becomes X. For one company (partnerId) or the default ladder (null).
 */
const field =
  "tv-field h-9 rounded-[8px] border px-2.5 text-[12.5px] font-semibold";

export function TiersEditor({ partnerId, initial, title, hint }: { partnerId: string | null; initial: Tier[]; title: string; hint: string }) {
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [rows, setRows] = useState(initial.map((t) => ({ min: String(t.min_confirmed), pct: String(t.pct) })));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const key = partnerId ?? "default";

  return (
    <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
      <h2 className="text-[14px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">{title}</h2>
      <p className="mb-3 mt-0.5 text-[12px] font-semibold text-tv-text-faint">{hint}</p>
      <div className="grid gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              بعد ملفات مؤكدة في الربع
              <input id={`tier-min-${key}-${i}`} type="number" min={1} dir="ltr" value={r.min} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} className={`${field} tv-tnum w-28`} />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              النسبة %
              <input id={`tier-pct-${key}-${i}`} type="number" min={0} max={100} step="0.5" dir="ltr" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className={`${field} tv-tnum w-24`} />
            </label>
            <button type="button" aria-label="حذف الدرجة" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="flex size-9 items-center justify-center rounded-[8px] border border-[#f0c7c7] text-[#c22850] max-sm:min-h-10 max-sm:min-w-10">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows([...rows, { min: "", pct: "" }])} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] max-sm:min-h-10">
          <Plus className="size-4" />
          درجة
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              setNote(null);
              const res = await saveTiers(partnerId, rows.map((r) => ({ min_confirmed: Number(r.min), pct: Number(r.pct) })));
              if (res.ok) {
                setNote({ ok: true, text: "حُفظ السلّم." });
                router.refresh();
              } else setNote({ ok: false, text: res.message });
            })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          حفظ
        </button>
        {note ? <span className={`text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{note.text}</span> : null}
      </div>
    </section>
  );
}
