"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Fragment } from "react";
import { Wallet } from "lucide-react";
import type { CycleView } from "@/lib/data/commissions";
import {
  addAdjustment,
  approveCycle,
  backToDraft,
  openCycle,
  payCycle,
  removeAdjustment,
  sendToReview,
  setMonthlyCost,
  voidCycle,
  type ActionResult,
} from "@/lib/data/commission-actions";
import { TraveliunShell } from "../TraveliunShell";
import { card, danger, field, MonthPicker, Num, primary, sar, secondary, Section, Stat, StatusPill, Tabs, td, th } from "./ui";

const h = (n: unknown) => Number(n ?? 0) / 100;

/** «دورة العمولات» — the month for everyone: calculate, adjust, freeze, approve, pay. */
export function CycleBoard({ view }: { view: CycleView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { cycle, snap, can } = view;
  const calc = snap.calc;
  const status = cycle?.status ?? "none";
  const draft = status === "draft";
  const totals = calc?.result.totals ?? {};
  const level = calc?.policy.target.levels.find((l) => l.id === totals.activeLevelId);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  const name = (id: string) => snap.names[id] ?? view.employees.find((e) => e.id === id)?.name ?? "—";
  const noCost = Object.values(snap.files).flat().filter((f) => f.no_cost);
  const rows = [...(calc?.result.employees ?? [])].sort((a, b) => b.netCommission - a.netCommission || b.grossProfit - a.grossProfit);

  return (
    <TraveliunShell title="nav.commissions">
      <div className="tv-fade-up space-y-4">
        <Tabs active="cycles" manage />
        <section className={`${card} flex flex-wrap items-start justify-between gap-3`}>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
              <Wallet className="size-5" />
              دورة عمولات <Num>{view.month}</Num>
              <StatusPill status={status} />
            </h1>
            <p className="mt-1 max-w-2xl text-[12px] font-semibold leading-6 text-tv-text-faint">
              الملفات المسددة بالكامل في الشهر على ربحها الفعلي. المسودة تُحسب من جديد مع كل فتح؛ عند الإرسال للاعتماد تُجمَّد الأرقام والملفات خلفها، ولا تتغير بعدها.
            </p>
          </div>
          <MonthPicker month={view.month} action="/commissions/cycles" />
        </section>

        {error && <p className={`${card} text-[12.5px] font-bold text-[#c22850]`}>{error}</p>}

        {/* the steps */}
        <section className={`${card} flex flex-wrap items-end gap-2`}>
          {!cycle && can.manage && (
            <button className={primary} disabled={pending} onClick={() => run(() => openCycle(view.month))}>
              فتح دورة هذا الشهر
            </button>
          )}
          {cycle && draft && can.manage && (
            <>
              <CostField cycleId={cycle.id} value={view.monthlyCost} run={run} pending={pending} />
              <button className={primary} disabled={pending || !calc} onClick={() => run(() => sendToReview(cycle.id))}>
                تجميد وإرسال للاعتماد
              </button>
            </>
          )}
          {status === "review" && (
            <>
              {can.approve && (
                <button className={primary} disabled={pending} onClick={() => run(() => approveCycle(cycle!.id))}>
                  اعتماد الدورة
                </button>
              )}
              <button className={secondary} disabled={pending} onClick={() => run(() => backToDraft(cycle!.id))}>
                إرجاع للمسودة
              </button>
            </>
          )}
          {status === "approved" && can.approve && <PayField cycleId={cycle!.id} run={run} pending={pending} />}
          {cycle && ["draft", "review", "approved"].includes(status) && can.approve && (
            <button
              className={`${danger} ms-auto`}
              disabled={pending}
              onClick={() => {
                const reason = window.prompt("سبب إلغاء الدورة؟");
                if (reason?.trim()) run(() => voidCycle(cycle.id, reason));
              }}
            >
              إلغاء الدورة
            </button>
          )}
          {view.payout && (
            <span className="text-[12.5px] font-bold text-[#1f5fa8]">
              صُرف <Num>{sar(view.payout.amount)}</Num> في <Num>{view.payout.paid_at.slice(0, 10)}</Num>
              {view.payout.reference ? ` — مرجع ${view.payout.reference}` : ""}
            </span>
          )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="ربح الملفات المسددة" value={sar(h(totals.totalProfitHalalas))} />
          <Stat label="التكلفة الشهرية" value={sar(view.monthlyCost)} />
          <Stat label="المستوى المحقق" value={level ? `${Math.round(level.rate * 100)}%` : "—"} hint={level?.label ?? "لم تُغطَّ التكلفة — يُطبَّق الحد الأدنى الفردي"} />
          <Stat label="إجمالي المستحق" value={sar(h(totals.totalGrossPayableHalalas ?? totals.employeeNetHalalas))} tone="text-[#17795a]" hint={`وعاء المبيعات ${sar(h(totals.salesPoolHalalas))}`} />
        </div>

        {noCost.length > 0 && (
          <p className={`${card} text-[12.5px] font-bold leading-6 text-[#a86a10]`}>
            {noCost.length} ملف مسدد بلا أي تكلفة موردين مسجّلة، فربحه يساوي كامل المبلغ: {noCost.map((f) => f.serial).join("، ")}. سجّل دفعات الموردين في العمليات قبل
            التجميد.
          </p>
        )}

        {snap.skipped.length > 0 && (
          <p className={`${card} text-[12.5px] font-bold text-[#a86a10]`}>
            لم تُحسب {snap.skipped.length} ملفات لعدم توفر سعر صرف: {snap.skipped.map((s) => `${s.serial} (${s.currency})`).join("، ")}
          </p>
        )}

        <Section title="الموظفون">
          {rows.length === 0 ? (
            <p className="text-[12px] font-semibold text-tv-text-faint">لا يوجد ملف اكتمل سداده في هذا الشهر.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#e2ebe7]">
                    <th className={th}>الموظف</th>
                    <th className={th}>الملفات</th>
                    <th className={th}>المبيعات</th>
                    <th className={th}>الربح</th>
                    <th className={th}>الوزن</th>
                    <th className={th}>العمولة</th>
                    <th className={th}>التعديل</th>
                    <th className={th}>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <Fragment key={e.employeeId}>
                      <tr className="cursor-pointer border-b border-[#f0f4f2] hover:bg-[#fbfdfc]" onClick={() => setOpen(open === e.employeeId ? null : e.employeeId)}>
                        <td className={td}>
                          {name(e.employeeId)}
                          {e.viaFallback && <span className="ms-1 text-[10.5px] text-[#a86a10]">(حد أدنى)</span>}
                        </td>
                        <td className={td}>
                          <Num>{String(snap.files[e.employeeId]?.length ?? 0)}</Num>
                        </td>
                        <td className={td}>
                          <Num>{sar(e.grossSales)}</Num>
                        </td>
                        <td className={td}>
                          <Num>{sar(e.grossProfit)}</Num>
                        </td>
                        <td className={td}>
                          <Num>{`${(e.weight * 100).toFixed(1)}%`}</Num>
                        </td>
                        <td className={td}>
                          <Num>{sar(e.baseCommission)}</Num>
                        </td>
                        <td className={td}>
                          <Num tone={e.adjustmentTotal < 0 ? "text-[#c22850]" : undefined}>{e.adjustmentTotal ? sar(e.adjustmentTotal) : "—"}</Num>
                        </td>
                        <td className={td}>
                          <Num tone="text-[#17795a]">{sar(e.netCommission)}</Num>
                        </td>
                      </tr>
                      {open === e.employeeId && (
                        <tr>
                          <td colSpan={8} className="bg-[#fbfdfc] px-3 py-2">
                            {(snap.files[e.employeeId] ?? []).map((f) => (
                              <div key={f.operation_id} className="flex flex-wrap gap-3 py-0.5 text-[11.5px] font-semibold text-[#557d78]">
                                <Num>{f.serial}</Num>
                                <span>{f.destination ?? "—"}</span>
                                <Num>{f.paid_on}</Num>
                                <span>
                                  ربح <Num>{sar(f.profit)}</Num>
                                </span>
                                {f.no_cost && <span className="text-[#a86a10]">بلا تكلفة مسجّلة</span>}
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {(calc?.result.departments.length ?? 0) > 0 && (
          <Section title="حوافز الأقسام">
            <div className="grid gap-3 sm:grid-cols-3">
              {calc!.result.departments.map((d) => (
                <Stat
                  key={d.departmentId}
                  label={calc!.policy.departments.find((x) => x.id === d.departmentId)?.name ?? d.departmentId}
                  value={sar(d.grossPayable)}
                  hint={`${(d.rate * 100).toFixed(1)}% من الفائض`}
                />
              ))}
            </div>
          </Section>
        )}

        {cycle && (
          <Section title="التعديلات اليدوية">
            {view.adjustments.length === 0 ? (
              <p className="text-[12px] font-semibold text-tv-text-faint">لا توجد تعديلات.</p>
            ) : (
              <ul className="space-y-1.5">
                {view.adjustments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 text-[12.5px] font-bold text-[#185045]">
                    <span>{name(a.employee_id)}</span>
                    <Num tone={a.amount < 0 ? "text-[#c22850]" : "text-[#17795a]"}>{sar(a.amount)}</Num>
                    <span className="font-semibold text-[#557d78]">{a.reason}</span>
                    {draft && can.manage && (
                      <button className="text-[11.5px] text-[#c22850] hover:underline" disabled={pending} onClick={() => run(() => removeAdjustment(a.id))}>
                        حذف
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {draft && can.manage && <AdjustmentForm cycleId={cycle.id} employees={view.employees} run={run} pending={pending} />}
          </Section>
        )}

        {view.cycles.length > 0 && (
          <Section title="كل الدورات">
            <div className="flex flex-wrap gap-2">
              {view.cycles.map((c) => (
                <a key={c.id} href={`/commissions/cycles?month=${c.month}`} className="flex items-center gap-2 rounded-xl border border-[#e2ebe7] px-3 py-1.5 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]">
                  <Num>{c.month}</Num>
                  <StatusPill status={c.status} />
                </a>
              ))}
            </div>
          </Section>
        )}
      </div>
    </TraveliunShell>
  );
}

type Run = (fn: () => Promise<ActionResult>) => void;

function CostField({ cycleId, value, run, pending }: { cycleId: string; value: number; run: Run; pending: boolean }) {
  const [v, setV] = useState(String(value));
  return (
    <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
      التكلفة الشهرية (ر.س)
      <span className="flex gap-2">
        <input type="number" min={0} step="0.01" dir="ltr" value={v} onChange={(e) => setV(e.target.value)} className={`${field} w-40`} />
        <button className={secondary} disabled={pending || Number(v) === value} onClick={() => run(() => setMonthlyCost(cycleId, Number(v)))}>
          حفظ
        </button>
      </span>
    </label>
  );
}

function PayField({ cycleId, run, pending }: { cycleId: string; run: Run; pending: boolean }) {
  const [ref, setRef] = useState("");
  return (
    <span className="flex flex-wrap gap-2">
      <input placeholder="مرجع التحويل (اختياري)" value={ref} onChange={(e) => setRef(e.target.value)} className={`${field} w-56`} />
      <button className={primary} disabled={pending} onClick={() => run(() => payCycle(cycleId, ref))}>
        تسجيل الصرف
      </button>
    </span>
  );
}

function AdjustmentForm({ cycleId, employees, run, pending }: { cycleId: string; employees: { id: string; name: string }[]; run: Run; pending: boolean }) {
  const [emp, setEmp] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#f0f4f2] pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await addAdjustment(cycleId, emp, Number(amount), reason);
          if (r.ok) {
            setAmount("");
            setReason("");
          }
          return r;
        });
      }}
    >
      <select required value={emp} onChange={(e) => setEmp(e.target.value)} className={`${field} w-48`}>
        <option value="">الموظف…</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <input required type="number" step="0.01" dir="ltr" placeholder="المبلغ (+ أو −)" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} w-36`} />
      <input required placeholder="السبب" value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} min-w-56 flex-1`} />
      <button type="submit" className={secondary} disabled={pending}>
        إضافة تعديل
      </button>
    </form>
  );
}
