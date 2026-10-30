"use client";

import Link from "next/link";
import { BadgePercent } from "lucide-react";
import type { MyCommission as Data } from "@/lib/data/commissions";
import { TraveliunShell } from "../TraveliunShell";
import { card, MonthPicker, Num, sar, Section, Stat, StatusPill, Tabs, td, th } from "./ui";

/** «عمولتي» — the employee's own figures only (the owner, 2026-10-18): no colleague, no company total. */
export function MyCommission({ data, manage }: { data: Data; manage: boolean }) {
  return (
    <TraveliunShell title="nav.commissions">
      <div className="tv-fade-up space-y-4">
        <Tabs active="mine" manage={manage} />
        <section className={`${card} flex flex-wrap items-start justify-between gap-3`}>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
              <BadgePercent className="size-5" />
              عمولتي
              <StatusPill status={data.status} />
            </h1>
            <p className="mt-1 max-w-2xl text-[12px] font-semibold leading-6 text-tv-text-faint">
              يدخل الملف في عمولة الشهر الذي اكتمل فيه سداد العميل، ويُحسب على ربحه الفعلي: المستلم من العميل ناقص ما دُفع للموردين وما بقي عليهم.
              {data.frozen ? " أرقام هذا الشهر مجمّدة ولن تتغير." : " الرقم تقديري ويتحدث حتى تعتمد الإدارة الشهر."}
            </p>
          </div>
          <MonthPicker month={data.month} action="/commissions" />
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="ملفات مسددة بالكامل" value={String(data.files.length)} />
          <Stat label="المبيعات المحصّلة" value={sar(data.sales)} />
          <Stat label="ربحي الفعلي" value={sar(data.profit)} tone={data.profit < 0 ? "text-[#c22850]" : undefined} />
          <Stat
            label={data.frozen ? "عمولتي" : "عمولتي المتوقعة"}
            value={sar(data.net)}
            tone="text-[#17795a]"
            hint={[data.viaFallback ? "بالحد الأدنى الفردي" : "", data.adjustments ? `منها تعديل ${sar(data.adjustments)}` : ""].filter(Boolean).join(" · ") || undefined}
          />
        </div>

        {data.skipped > 0 && (
          <p className={`${card} text-[12.5px] font-bold text-[#a86a10]`}>
            {data.skipped} ملف بعملة لا يتوفر لها سعر صرف — لم يُحسب، وستراجعه الإدارة.
          </p>
        )}

        <Section title="ملفات الشهر">
          {data.files.length === 0 ? (
            <p className="text-[12px] font-semibold text-tv-text-faint">لا يوجد ملف اكتمل سداده في هذا الشهر.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#e2ebe7]">
                    <th className={th}>الملف</th>
                    <th className={th}>الوجهة</th>
                    <th className={th}>اكتمل السداد</th>
                    <th className={th}>المستلم</th>
                    <th className={th}>التكلفة</th>
                    <th className={th}>الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((f) => (
                    <tr key={f.operation_id} className="border-b border-[#f0f4f2] last:border-0">
                      <td className={td}>
                        <Link href={`/operations/${f.operation_id}`} className="text-[#185045] underline-offset-2 hover:underline">
                          <Num>{f.serial}</Num>
                        </Link>
                      </td>
                      <td className={td}>{f.destination ?? "—"}</td>
                      <td className={td}>
                        <Num>{f.paid_on}</Num>
                      </td>
                      <td className={td}>
                        <Num>{sar(f.revenue)}</Num>
                      </td>
                      <td className={td}>
                        <Num>{sar(f.cost)}</Num>
                      </td>
                      <td className={td}>
                        <Num tone={f.profit < 0 ? "text-[#c22850]" : "text-[#17795a]"}>{sar(f.profit)}</Num>
                        {f.no_cost && <span className="ms-1.5 rounded-full bg-[#fff8e8] px-2 py-0.5 text-[10.5px] text-[#a86a10]">بلا تكلفة مسجّلة</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="الأشهر السابقة">
          {data.history.length === 0 ? (
            <p className="text-[12px] font-semibold text-tv-text-faint">لا توجد أشهر معتمدة بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#e2ebe7]">
                    <th className={th}>الشهر</th>
                    <th className={th}>الحالة</th>
                    <th className={th}>ربحي</th>
                    <th className={th}>عمولتي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.month} className="border-b border-[#f0f4f2] last:border-0">
                      <td className={td}>
                        <Link href={`/commissions?month=${h.month}`} className="text-[#185045] hover:underline">
                          <Num>{h.month}</Num>
                        </Link>
                      </td>
                      <td className={td}>
                        <StatusPill status={h.status} />
                      </td>
                      <td className={td}>
                        <Num>{sar(h.profit)}</Num>
                      </td>
                      <td className={td}>
                        <Num tone="text-[#17795a]">{sar(h.net)}</Num>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </TraveliunShell>
  );
}
