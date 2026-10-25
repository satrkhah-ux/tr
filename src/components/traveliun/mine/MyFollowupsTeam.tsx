"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import type { TeamRow } from "@/lib/data/my-followups";
import { btn, card, since } from "@/components/traveliun/followups/followup-ui";

/** «فريق المتابعة» — every seller's «متابعتي» in numbers; a name opens their list, to read. */
export function MyFollowupsTeam({ rows, at: now }: { rows: TeamRow[]; at: number }) {
  return (
    <div dir="rtl" className="space-y-4 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3">
      <section className={`${card} flex flex-wrap items-center justify-between gap-4 p-5`}>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <Users /> متابعة الموظفين
          </h1>
          <p className="mt-1 text-sm text-slate-500">ما على كل بائع اليوم في «متابعتي». المتأخر: عميل انتظر أكثر من حدّ الموظف، أو متابعة عرض مستحقة منذ أكثر من يوم.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/my-followups" className={btn}>
            متابعتي
          </Link>
          {/* the reassignment stays where it is today: the follow-up board and Teletel */}
          <Link href="/followups" className={btn}>
            إعادة التوزيع في «المتابعة»
          </Link>
        </div>
      </section>
      <section className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[#185045] text-white">
            <tr>
              {["الموظف", "عليه الآن", "ينتظرون ردّه", "متأخر", "ساخن", "متابعات عروض", "آخر نشاط في النظام"].map((h, i) => (
                <th key={h} className={`p-3 font-bold ${i ? "text-center" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#E3E8E4]">
                <td className="p-3 font-extrabold">
                  <Link href={`/my-followups?employee=${r.id}`} className="text-[#185045] underline-offset-2 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="p-3 text-center font-extrabold">{r.total}</td>
                <td className="p-3 text-center text-[#1D4ED8]">{r.waiting}</td>
                <td className={`p-3 text-center font-extrabold ${r.late ? "text-[#9A3412]" : "text-slate-400"}`}>{r.late}</td>
                <td className="p-3 text-center">{r.hot}</td>
                <td className="p-3 text-center">{r.offers}</td>
                <td className="p-3 text-center text-slate-500">{r.lastSeen ? `قبل ${since(r.lastSeen, now)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
