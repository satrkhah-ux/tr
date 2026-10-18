"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";
import type { PolicyView } from "@/lib/data/commissions";
import type { CommissionPolicyDocument } from "@/lib/commissions/policy";
import { approvePolicy, discardPolicyDraft, savePolicyDraft, type ActionResult } from "@/lib/data/commission-actions";
import { TraveliunShell } from "../TraveliunShell";
import { card, danger, field, Num, primary, secondary, Section, Tabs } from "./ui";

const pct = (r: number) => String(Math.round(r * 10000) / 100);
const rate = (s: string) => Math.round(Number(s) * 100) / 10000;

/**
 * «سياسة العمولة» — the numbers the month is calculated with. A change is a
 * draft until someone OTHER than its writer approves it (0092 four-eyes), and
 * a frozen month keeps the policy it was frozen with.
 */
export function PolicyEditor({ view }: { view: PolicyView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<CommissionPolicyDocument>(view.active.doc);
  const [note, setNote] = useState("");
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      else setNote("");
      router.refresh();
    });
  const set = (f: (d: CommissionPolicyDocument) => void) =>
    setDoc((d) => {
      const next = structuredClone(d);
      f(next);
      return next;
    });
  const levelIds = doc.target.levels.map((l) => l.id);

  return (
    <TraveliunShell title="nav.commissions">
      <div className="tv-fade-up space-y-4">
        <Tabs active="policy" manage />
        <section className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
            <Scale className="size-5" />
            سياسة العمولة
          </h1>
          <p className="mt-1 max-w-3xl text-[12px] font-semibold leading-6 text-[#93aaa3]">
            ربح الملفات المسددة في الشهر يُقارن بالتكلفة الشهرية. أعلى مستوى يتحقق يحدد نسبة الوعاء من الفائض (الربح − التكلفة)، ويُوزَّع الوعاء على الموظفين بحسب
            حصتهم من عدد الملفات ومن المبيعات. إن لم تُغطَّ التكلفة يأخذ كل موظف نسبة الحد الأدنى من ربحه. أي تعديل يُحفظ مسودة، ويعتمده شخص غير الذي كتبه.
          </p>
          <p className="mt-2 text-[12px] font-bold text-[#185045]">
            {view.active.id ? (
              <>
                السياسة المعتمدة منذ <Num>{view.active.approved_at?.slice(0, 10) ?? ""}</Num>
              </>
            ) : (
              "لا توجد سياسة معتمدة بعد — يُحسب بالقيم الأصلية لنظام العمولات حتى تُعتمد سياسة."
            )}
          </p>
        </section>

        {error && <p className={`${card} text-[12.5px] font-bold text-[#c22850]`}>{error}</p>}

        <Section title="المستويات">
          <div className="grid gap-3 md:grid-cols-3">
            {doc.target.levels.map((l, i) => (
              <div key={l.id} className="space-y-2 rounded-xl border border-[#e2ebe7] p-3">
                <input
                  value={l.label}
                  onChange={(e) => set((d) => void (d.target.levels[i].label = e.target.value))}
                  className={`${field} w-full font-bold`}
                  aria-label="اسم المستوى"
                />
                <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                  يتحقق عند (× التكلفة الشهرية)
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    dir="ltr"
                    value={l.costMultiplier}
                    onChange={(e) => set((d) => void (d.target.levels[i].costMultiplier = Number(e.target.value)))}
                    className={field}
                  />
                </label>
                <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                  نسبة الوعاء من الفائض %
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    dir="ltr"
                    value={pct(l.rate)}
                    onChange={(e) => set((d) => void (d.target.levels[i].rate = rate(e.target.value)))}
                    className={field}
                  />
                </label>
              </div>
            ))}
          </div>
        </Section>

        <Section title="التوزيع والحد الأدنى">
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
              وزن عدد الملفات % (والباقي للمبيعات)
              <input
                type="number"
                min={0}
                max={100}
                dir="ltr"
                value={pct(doc.target.weightBlend)}
                onChange={(e) => set((d) => void (d.target.weightBlend = rate(e.target.value)))}
                className={`${field} w-40`}
              />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
              الحد الأدنى الفردي % من ربح الموظف
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={doc.individualFallback.enabled}
                  onChange={(e) => set((d) => void (d.individualFallback.enabled = e.target.checked))}
                  className="size-4"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  dir="ltr"
                  value={pct(doc.individualFallback.rate)}
                  onChange={(e) => set((d) => void (d.individualFallback.rate = rate(e.target.value)))}
                  className={`${field} w-28`}
                />
              </span>
            </label>
          </div>
        </Section>

        <Section title="حوافز الأقسام (% من الفائض لكل مستوى)">
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <tbody>
                {doc.departments.map((dep, di) => (
                  <tr key={dep.id}>
                    <td className="py-1 pe-3 text-[12.5px] font-bold text-[#185045]">{dep.name}</td>
                    {levelIds.map((id) => (
                      <td key={id} className="py-1 pe-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          dir="ltr"
                          aria-label={`${dep.name} ${id}`}
                          value={pct(dep.levelRates[id] ?? 0)}
                          onChange={(e) => set((d) => void (d.departments[di].levelRates[id] = rate(e.target.value)))}
                          className={`${field} w-24`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="موظفون لا تُصرف لهم عمولة">
          <div className="flex flex-wrap gap-2">
            {view.employees.map((e) => {
              const on = doc.excludedEmployeeIds.includes(e.id);
              return (
                <label key={e.id} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold ${on ? "border-[#c22850] text-[#c22850]" : "border-[#dbe6e1] text-[#185045]"}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(ev) =>
                      set((d) => {
                        d.excludedEmployeeIds = ev.target.checked ? [...d.excludedEmployeeIds, e.id] : d.excludedEmployeeIds.filter((x) => x !== e.id);
                      })
                    }
                  />
                  {e.name}
                </label>
              );
            })}
          </div>
        </Section>

        <section className={`${card} flex flex-wrap items-end gap-2`}>
          <input placeholder="ملاحظة على التعديل (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} className={`${field} min-w-64 flex-1`} />
          <button className={secondary} disabled={pending} onClick={() => setDoc(view.active.doc)}>
            تراجع
          </button>
          <button className={primary} disabled={pending} onClick={() => run(() => savePolicyDraft(doc, note))}>
            حفظ كمسودة للاعتماد
          </button>
        </section>

        {view.drafts.length > 0 && (
          <Section title="مسودات بانتظار الاعتماد">
            <ul className="space-y-2">
              {view.drafts.map((d) => {
                const mine = d.created_by === view.me;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e2ebe7] p-3 text-[12.5px] font-bold text-[#185045]">
                    <Num>{d.created_at.slice(0, 16).replace("T", " ")}</Num>
                    <span className="font-semibold text-[#557d78]">
                      {d.doc.target.levels.map((l) => `${pct(l.rate)}%`).join(" / ")}
                      {d.note ? ` — ${d.note}` : ""}
                    </span>
                    <span className="ms-auto flex gap-2">
                      <button className={secondary} onClick={() => setDoc(d.doc)}>
                        عرض
                      </button>
                      {view.can.approve && (
                        <button className={primary} disabled={pending || mine} title={mine ? "كتبتها أنت — يعتمدها شخص آخر" : undefined} onClick={() => run(() => approvePolicy(d.id))}>
                          اعتماد
                        </button>
                      )}
                      <button className={danger} disabled={pending} onClick={() => run(() => discardPolicyDraft(d.id))}>
                        حذف
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>
    </TraveliunShell>
  );
}
