"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { keepOne, notDuplicate, unifySpelling, type DupTable, type Duplicates } from "@/lib/data/dedupe";

const TABLE: Record<DupTable, string> = {
  tours: "جولات",
  transfers: "توصيلات",
  services: "خدمات",
  transportation_types: "أنواع السيارات",
  tour_programs: "برامج الجولات",
};
const ERROR: Record<string, string> = {
  forbidden: "هذا القرار للإدارة.",
  used: "لم يُحذف: الصف مستخدم في مكان آخر.",
  backup: "لم يُحذف: تعذّر حفظ نسخة احتياطية أولاً.",
};
const BTN = "inline-flex h-8 items-center rounded-[8px] border px-2.5 text-[11.5px] font-bold disabled:opacity-50";

/**
 * «بيانات مكررة» (the owner, 2026-10-22): each group the same thing more than
 * once, with what each copy holds — the owner keeps one, picks one spelling,
 * or says «ليست مكررة». Nothing changes by itself; only the administration's
 * press (dedupe.ts checks settings.manage again).
 */
export function DuplicatesPanel({ data }: { data: Duplicates }) {
  const router = useRouter();
  const [table, setTable] = useState<DupTable | "spelling" | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const count = (t: DupTable) => data.groups.filter((g) => g.table === t).length;
  const shown = data.groups.filter((g) => !table || g.table === table);

  async function run(key: string, act: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setBusy(key);
    setMsg(null);
    const res = await act();
    setBusy(null);
    if (!res.ok) return setMsg({ text: ERROR[res.error] ?? "لم يُنفّذ. أعد المحاولة.", bad: true });
    setMsg({ text: done });
    router.refresh();
  }

  if (data.groups.length === 0 && data.spellings.length === 0) return null;
  return (
    <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-3 sm:p-4">
      <h2 className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#003c3a]">
        <Copy className="size-4 text-[#a86a10]" />
        بيانات مكررة
      </h2>
      <p className="mt-1 max-w-[75ch] text-[12px] font-semibold leading-6 text-[#557d78]">
        الشيء نفسه مسجّل أكثر من مرة، وغالباً بأسعار مختلفة. اختر الصحيح «إبقاء هذا» فتُحذف النسخ الأخرى بعد حفظ نسخة احتياطية منها (وأسعار سيارات الجولة تنتقل إليه)، أو «ليست مكررة». لا يتغيّر شيء من تلقاء نفسه.
        {data.canChange ? null : <span className="font-extrabold text-[#a86a10]"> القرار هنا للإدارة.</span>}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setTable("")} className={`${BTN} ${table === "" ? "border-[#185045] bg-[#185045] text-white" : "border-[#cfe0d9] text-[#185045]"}`}>
          الكل · {data.groups.length + data.spellings.length}
        </button>
        {(Object.keys(TABLE) as DupTable[]).map((t) =>
          count(t) ? (
            <button key={t} type="button" onClick={() => setTable(t)} className={`${BTN} ${table === t ? "border-[#185045] bg-[#185045] text-white" : "border-[#cfe0d9] text-[#185045]"}`}>
              {TABLE[t]} · {count(t)}
            </button>
          ) : null,
        )}
        {data.spellings.length ? (
          <button type="button" onClick={() => setTable("spelling")} className={`${BTN} ${table === "spelling" ? "border-[#185045] bg-[#185045] text-white" : "border-[#cfe0d9] text-[#185045]"}`}>
            كتابة السيارة · {data.spellings.length}
          </button>
        ) : null}
      </div>
      {msg ? <p className={`mt-2 text-[12px] font-bold ${msg.bad ? "text-[#c22850]" : "text-[#0f7a52]"}`}>{msg.text}</p> : null}

      <div className="mt-3 grid gap-2">
        {table === "spelling" || table === ""
          ? data.spellings.map((s) => (
              <div key={s.key} className="rounded-[12px] border border-[#e2ebe7] p-2.5 text-[12px] font-semibold text-[#185045]">
                <p className="mb-1.5 font-extrabold">السيارة نفسها مكتوبة بأكثر من شكل — اختر الكتابة الصحيحة لكل التوصيلات وأسعار الجولات</p>
                <div className="flex flex-wrap gap-1.5">
                  {s.variants.map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      disabled={!data.canChange || busy !== null}
                      onClick={() => run(s.key, () => unifySpelling(s.key, v.value), `وُحّدت: ${v.value}`)}
                      className={`${BTN} border-[#cfe0d9] text-[#185045] hover:bg-[#f0f7f4]`}
                    >
                      {v.value} ({v.count})
                    </button>
                  ))}
                  <button type="button" disabled={!data.canChange || busy !== null} onClick={() => run(s.key, () => notDuplicate(s.key), "أُخفيت من القائمة")} className={`${BTN} border-[#e2ebe7] text-[#557d78]`}>
                    ليست مكررة
                  </button>
                </div>
              </div>
            ))
          : null}
        {table === "spelling"
          ? null
          : shown.map((g) => (
              <div key={g.key} className="rounded-[12px] border border-[#e2ebe7] p-2.5">
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[12.5px] font-extrabold text-[#185045]">
                    {g.title} <span className="text-[11px] font-bold text-[#93aaa3]">· {TABLE[g.table]}{g.country ? ` · ${g.country}` : ""}</span>
                  </p>
                  <button type="button" disabled={!data.canChange || busy !== null} onClick={() => run(g.key, () => notDuplicate(g.key), "أُخفيت من القائمة")} className={`${BTN} border-[#e2ebe7] text-[#557d78]`}>
                    ليست مكررة
                  </button>
                </div>
                <ul className="grid gap-1">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[9px] bg-[#f8fbfa] px-2.5 py-1.5 text-[12px] font-semibold text-[#185045]">
                      <span className="min-w-0 flex-1 break-words">
                        {r.label}
                        {r.detail ? <span className="text-[#93aaa3]"> · {r.detail}</span> : null}
                        {r.uses ? <span className="text-[#93aaa3]"> · {r.uses} أسعار سيارات</span> : null}
                      </span>
                      {r.price ? <DirText className="tv-tnum font-extrabold">{r.price}</DirText> : null}
                      <button
                        type="button"
                        disabled={!data.canChange || busy !== null}
                        onClick={() =>
                          run(
                            g.key,
                            () => keepOne(g.table, r.id, g.rows.filter((o) => o.id !== r.id).map((o) => o.id)),
                            `أُبقي «${r.label}» وحُذفت النسخ الأخرى (نسخة احتياطية محفوظة)`,
                          )
                        }
                        className={`${BTN} border-[#b7d0c7] text-[#0f7a52] hover:bg-[#eef8f3]`}
                      >
                        {busy === g.key ? <Loader2 className="size-3.5 animate-spin" /> : "إبقاء هذا"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
      </div>
    </section>
  );
}
