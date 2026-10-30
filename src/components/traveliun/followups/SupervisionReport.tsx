"use client";

import { useState } from "react";
import { getSupervisionReport } from "@/lib/followups/supervision/actions";

/** «تقارير الإشراف»: per employee and per supervisor, over a chosen period — within what the viewer may see. */
type Data = NonNullable<Awaited<ReturnType<typeof getSupervisionReport>>>;
const mins = (m: number | null) => (m == null ? "—" : m < 60 ? `${m} د` : `${Math.round(m / 60)} س`);

export function SupervisionReport({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [days, setDays] = useState(30);
  const name = (id: string) => data.names[id] ?? (id === "—" ? "بلا موظف" : "—");
  async function load(d: number) { setDays(d); const r = await getSupervisionReport(d); if (r) setData(r); }
  if (!data.enabled) return null;
  const th = "p-2 text-start text-xs font-bold text-[#557d78]";
  const td = "border-t border-[#eef3f1] p-2 tabular-nums";
  return <section className="space-y-3">
    <div className="flex items-center gap-2">
      <h3 className="font-bold">التقارير</h3>
      <select value={days} onChange={(e) => void load(Number(e.target.value))} className="rounded-lg border border-[#dbe6e1] p-1.5 text-sm" aria-label="الفترة">
        {[7, 30, 90].map((d) => <option key={d} value={d}>آخر {d} يوماً</option>)}
      </select>
    </div>
    <div className="tv-card overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-[#f4f8f6]"><tr>{["الموظف", "المستحق", "المنجز", "المتأخر", "الالتزام", "وقت المعالجة", "التأجيلات"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{data.employees.map((r) => <tr key={r.key}><td className={td}>{name(r.key)}</td><td className={td}>{r.due}</td><td className={td}>{r.done}</td><td className={td}>{r.overdue}</td><td className={td}>{r.compliance}%</td><td className={td}>{mins(r.avgHandleMinutes)}</td><td className={td}>{r.postpones}</td></tr>)}</tbody>
      </table>
    </div>
    {data.supervisors.length > 0 && <div className="tv-card overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-[#f4f8f6]"><tr>{["المشرف", "وصلته", "عالجها قبل التصعيد", "صُعّدت للإدارة", "متوسط استجابته"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{data.supervisors.map((r) => <tr key={r.supervisorId}><td className={td}>{name(r.supervisorId)}</td><td className={td}>{r.reached}</td><td className={td}>{r.actedBeforeEscalation}</td><td className={td}>{r.escalated}</td><td className={td}>{mins(r.avgResponseMinutes)}</td></tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
