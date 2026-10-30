"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { PartnerCustomer } from "@/lib/partners/customers";
import { TraveliunShell } from "../TraveliunShell";

/** «عملائي»: the clients the partner's offers were issued to — theirs alone. */
export function PartnerCustomers({ customers }: { customers: PartnerCustomer[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) => [c.name, c.phone, c.last_serial, c.last_destination].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [customers, q]);

  return (
    <TraveliunShell title="nav.myCustomers">
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-[var(--tv-brand)]">عملائي</h1>
            <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">
              العملاء الذين أصدرتم لهم عروضاً. لا يراهم غيركم.
            </p>
          </div>
          <label className="relative w-full max-w-[280px]">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
            <input
              id="partner-customers-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث بالاسم أو الجوال أو العرض"
              className="h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white ps-9 pe-3 text-[13px] font-semibold text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[var(--tv-brand)] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]"
            />
          </label>
        </header>

        <section className="tv-card rounded-[14px] border p-4">
          {shown.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[12.5px] font-semibold text-tv-text-faint">
              {customers.length === 0 ? "يظهر عملاؤكم هنا مع أول عرض تُصدرونه باسم عميل." : "لا نتائج لهذا البحث."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right text-[12.5px]">
                <thead>
                  <tr className="text-[11.5px] font-bold text-tv-text-faint">
                    <th className="pb-2">العميل</th>
                    <th className="pb-2">الجوال</th>
                    <th className="pb-2">العروض</th>
                    <th className="pb-2">آخر عرض</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={`${c.name}-${c.last_serial}`} className="border-t border-[#eef4f1] dark:border-[#22443b]">
                      <td className="py-2 font-bold text-[#0f3d38] dark:text-[#d6e5df]">{c.name}</td>
                      <td className="tv-tnum py-2 font-semibold text-[#557d78]">
                        {c.phone ? <DirText dir="ltr">{c.phone}</DirText> : "—"}
                      </td>
                      <td className="tv-tnum py-2 font-semibold">
                        <DirText dir="ltr">{String(c.offers)}</DirText>
                      </td>
                      <td className="py-2 font-semibold text-[#557d78]">
                        <DirText dir="ltr">{c.last_serial}</DirText>
                        {c.last_destination ? ` · ${c.last_destination}` : ""} ·{" "}
                        <DirText dir="ltr">{c.last_at}</DirText>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
