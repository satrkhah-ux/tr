"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import type { TargetsView } from "@/lib/data/commissions";
import { setSalesTarget } from "@/lib/data/commission-actions";
import { TraveliunShell } from "../TraveliunShell";
import { card, field, MonthPicker, Tabs, td, th } from "./ui";

/**
 * «أهداف المبيعات» (the owner, 2026-10-30): the manager types each seller's monthly
 * target (SAR) and, when one month differs, that month's own figure. An empty box clears it.
 */
export function TargetsEditor({ view }: { view: TargetsView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save(employeeId: string, month: string | null, raw: string, was: number | undefined) {
    const text = raw.replace(/[,\s]/g, "");
    const amount = text ? Number(text) : null;
    if (amount === (was ?? null)) return;
    if (amount !== null && !(amount > 0)) return setMsg({ ok: false, text: "اكتب مبلغاً موجباً، أو اترك الخانة فارغة لحذف الهدف." });
    start(async () => {
      const r = await setSalesTarget(employeeId, month, amount);
      setMsg(r.ok ? { ok: true, text: "حُفظ." } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  const box = (employeeId: string, month: string | null, was: number | undefined, label: string) => (
    <input
      key={`${employeeId}-${month}-${was ?? ""}`}
      defaultValue={was ?? ""}
      inputMode="numeric"
      dir="ltr"
      aria-label={label}
      placeholder="—"
      disabled={pending}
      onBlur={(e) => save(employeeId, month, e.target.value, was)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${field} w-32 tv-tnum`}
    />
  );

  return (
    <TraveliunShell title="nav.commissions">
      <div className="tv-fade-up space-y-4">
        <Tabs active="targets" manage />
        <section className={`${card} flex flex-wrap items-start justify-between gap-3`}>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
              <Target className="size-5" />
              أهداف المبيعات
            </h1>
            <p className="mt-1 max-w-2xl text-[12px] font-semibold leading-6 text-[#93aaa3]">
              الهدف الشهري بالريال لكل موظف، ويظهر له وحده في رئيسيته مع ما حققه. المحقق = مبيعات الملفات التي أكمل عميلها الدفع في الشهر (كما في «عمولتي»).
              هدف الشهر المختار يغلب الهدف الثابت لذلك الشهر فقط. اترك الخانة فارغة لحذف الهدف.
            </p>
          </div>
          <MonthPicker month={view.month} action="/commissions/targets" />
        </section>
        {msg && <p role="status" className={`text-[12.5px] font-bold ${msg.ok ? "text-[#17795a]" : "text-[#c22850]"}`}>{msg.text}</p>}
        <section className={`${card} overflow-x-auto p-0`}>
          <table className="w-full">
            <thead className="border-b border-[#eef3f1]">
              <tr>
                <th className={th}>الموظف</th>
                <th className={th}>الهدف الشهري (ر.س)</th>
                <th className={th}>هدف {view.month} فقط</th>
              </tr>
            </thead>
            <tbody>
              {view.employees.map((e) => (
                <tr key={e.id} className="border-b border-[#f3f6f5] last:border-0">
                  <td className={td}>{e.name}</td>
                  <td className={td}>{box(e.id, null, view.targets.monthly[e.id], `الهدف الشهري — ${e.name}`)}</td>
                  <td className={td}>{box(e.id, view.month, view.targets.months[view.month]?.[e.id], `هدف ${view.month} — ${e.name}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </TraveliunShell>
  );
}
