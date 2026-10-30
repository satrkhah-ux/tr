import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentCan, guardPath } from "@/lib/roles/current";
import { loadFinanceTerms } from "@/lib/data/finance-terms";
import { dueAmount, dueText, type FinanceTerm } from "@/lib/offer/finance-terms";

/**
 * «الشروط المالية» as the client files print it (the owner, 2026-10-29) —
 * read-only for every sales and follow-up employee; editing stays the
 * administration's (/offers/bank-accounts, /offers/payment-terms, /offers/instalment).
 */
export default async function FinancialTermsPage() {
  await guardPath("/financial-terms");
  const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
  const [terms, { data: countries }, manage] = await Promise.all([
    loadFinanceTerms(supabase),
    supabase.from("countries").select("id, arabic_name"),
    currentCan("settings.manage"),
  ]);
  const countryName = new Map(((countries ?? []) as { id: string; arabic_name: string }[]).map((c) => [c.id, c.arabic_name]));
  const where = (t: FinanceTerm) => (t.country_id ? (countryName.get(t.country_id) ?? "دولة") : "كل الدول");
  const line = (t: FinanceTerm) =>
    t.kind === "payment" ? [t.text, dueText(t, null, null), dueAmount(t, null, null)].filter(Boolean).join(" — ") : t.text;

  const parts: { title: string; edit: string; rows: FinanceTerm[]; empty: string }[] = [
    { title: "الحسابات البنكية", edit: "/offers/bank-accounts", rows: terms.filter((t) => t.kind === "bank" && t.checked), empty: "لا يوجد حساب محدد للظهور في ملفات العملاء." },
    { title: "شروط الدفع", edit: "/offers/payment-terms", rows: terms.filter((t) => t.kind === "payment"), empty: "لم تُكتب شروط دفع بعد — يظهر للعميل نص الدفع المعتاد." },
    { title: "تقسيط المبلغ", edit: "/offers/instalment", rows: terms.filter((t) => t.kind === "instalment"), empty: "لا يوجد نص للتقسيط." },
  ];

  return (
    <TraveliunShell title="nav.financeTerms">
      <div className="space-y-4">
        <p className="text-[13px] font-semibold text-[#557d78]">
          هذا ما يظهر في ملف العميل تحت «الشروط المالية»، حسب دولة البرنامج. التواريخ والمبالغ تُحسب في الملف من تاريخ السفر وإجمالي العرض.
        </p>
        {parts.map((p) => (
          <section key={p.title} className="tv-card rounded-2xl border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-extrabold text-[#185045] dark:text-[#d6e5df]">{p.title}</h2>
              {manage ? (
                <Link href={p.edit} className="text-[12px] font-bold text-[#0f7a52] underline">
                  تعديل
                </Link>
              ) : null}
            </div>
            {p.rows.length ? (
              <ul className="space-y-1.5">
                {p.rows.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 text-[13px] text-[#263633] dark:text-[#d6e5df]">
                    <span dir="auto" className="whitespace-pre-line">{line(t)}</span>
                    <span className="rounded-full bg-[#f2f7f5] px-2 text-[11px] font-bold text-[#557d78] dark:bg-[#1b2d27]">{where(t)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-tv-text-faint">{p.empty}</p>
            )}
          </section>
        ))}
      </div>
    </TraveliunShell>
  );
}
