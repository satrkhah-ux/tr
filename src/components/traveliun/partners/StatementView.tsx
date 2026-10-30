"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { recordPartnerPayment, setPartnerCreditLimit, type PartnerStatement } from "@/lib/partners/ledger";
import { useSafeTransition } from "../useSafeTransition";

/**
 * A partner's account — the same view in its portal and on our company page:
 * what it owes per currency, its limit, and every invoice and payment.
 */

const card = "rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const METHOD: Record<string, string> = { bank_transfer: "تحويل بنكي", cash: "نقداً", card: "بطاقة", other: "أخرى" };

export function StatementView({ statement, title }: { statement: PartnerStatement; title: string }) {
  const { balances, limit, lines } = statement;
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[14px] font-extrabold text-[var(--tv-brand)]">{title}</h2>
        <div className="flex flex-wrap gap-2 text-[12px] font-bold">
          {balances.length === 0 ? (
            <span className="rounded-full bg-[#eef4f1] px-3 py-1 text-[#557d78]">لا مستحقات</span>
          ) : (
            balances.map((b) => (
              <span key={b.currency} className={`tv-tnum rounded-full px-3 py-1 ${b.owed > 0 ? "bg-[#fff4e0] text-[#a86a10]" : "bg-[#e9f7f0] text-[#0f7a52]"}`}>
                {b.owed > 0 ? "المستحق" : "الرصيد لكم"}: <DirText dir="ltr">{`${money(Math.abs(b.owed))} ${b.currency}`}</DirText>
              </span>
            ))
          )}
          <span className="tv-tnum rounded-full bg-[#eef4f1] px-3 py-1 text-[#557d78]">
            الحد الائتماني: {limit.amount == null ? "بلا حد" : <DirText dir="ltr">{`${money(limit.amount)} ${limit.currency}`}</DirText>}
          </span>
        </div>
      </div>
      {lines.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[12.5px] font-semibold text-tv-text-faint">
          تظهر هنا فاتورة كل ملف يؤكّده عميلكم، وكل دفعة تسجَّل.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-right text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] font-bold text-tv-text-faint">
                <th className="pb-2">التاريخ</th>
                <th className="pb-2">البيان</th>
                <th className="pb-2">المرجع</th>
                <th className="pb-2">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.ref} className="border-t border-[#eef4f1] dark:border-[#22443b]">
                  <td className="tv-tnum py-2 font-semibold text-[#557d78]">
                    <DirText dir="ltr">{l.at.slice(0, 10)}</DirText>
                  </td>
                  <td className="py-2 font-semibold">
                    {l.kind === "invoice" ? (
                      <>
                        فاتورة الملف <DirText dir="ltr">{l.serial ?? "—"}</DirText>
                      </>
                    ) : (
                      `دفعة — ${METHOD[l.method ?? ""] ?? l.method ?? ""}`
                    )}
                  </td>
                  <td className="tv-tnum py-2 font-semibold text-[#557d78]">
                    <DirText dir="ltr">{l.ref}</DirText>
                  </td>
                  <td className={`tv-tnum py-2 font-extrabold ${l.kind === "invoice" ? "text-[#a86a10]" : "text-[#0f7a52]"}`}>
                    <DirText dir="ltr">{`${l.kind === "payment" ? "−" : ""}${money(l.amount)} ${l.currency}`}</DirText>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const field =
  "tv-field h-9 rounded-[8px] border px-2.5 text-[12.5px] font-semibold";
const label = "grid gap-1 text-[11.5px] font-bold text-[#185045] dark:text-[#9fc5b8]";

/** Ours only: record a payment the company made, and set its credit limit. */
export function LedgerControls({ partnerId, limit }: { partnerId: string; limit: PartnerStatement["limit"] }) {
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [pay, setPay] = useState({ amount: "", currency: limit.currency, method: "bank_transfer", reference: "", paid_at: "" });
  const [cap, setCap] = useState({ amount: limit.amount == null ? "" : String(limit.amount), currency: limit.currency });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className={`${card} grid gap-4 lg:grid-cols-2`}>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            setNote(null);
            const res = await recordPartnerPayment({ partner_id: partnerId, amount: Number(pay.amount), currency: pay.currency, method: pay.method, reference: pay.reference, paid_at: pay.paid_at || undefined });
            if (res.ok) {
              setNote({ ok: true, text: `سُجّلت الدفعة — سند القبض ${res.receipt ?? ""}` });
              setPay({ ...pay, amount: "", reference: "" });
              router.refresh();
            } else setNote({ ok: false, text: res.message });
          });
        }}
      >
        <h3 className="text-[13px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">تسجيل دفعة من الشركة</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            المبلغ
            <input id={`pay-amount-${partnerId}`} type="number" min={0} step="0.01" dir="ltr" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className={`${field} tv-tnum w-28`} />
          </label>
          <label className={label}>
            العملة
            <input id={`pay-currency-${partnerId}`} dir="ltr" value={pay.currency} onChange={(e) => setPay({ ...pay, currency: e.target.value.toUpperCase() })} className={`${field} w-20`} />
          </label>
          <label className={label}>
            الطريقة
            <select id={`pay-method-${partnerId}`} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className={field}>
              {Object.entries(METHOD).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            التاريخ
            <input id={`pay-date-${partnerId}`} type="date" dir="ltr" value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} className={field} />
          </label>
          <label className={`${label} min-w-[140px] flex-1`}>
            المرجع
            <input id={`pay-ref-${partnerId}`} dir="ltr" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} className={field} />
          </label>
          <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            سجّل
          </button>
        </div>
      </form>

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            setNote(null);
            const res = await setPartnerCreditLimit(partnerId, cap.amount === "" ? null : Number(cap.amount), cap.currency);
            if (res.ok) {
              setNote({ ok: true, text: "حُفظ الحد الائتماني." });
              router.refresh();
            } else setNote({ ok: false, text: res.message });
          });
        }}
      >
        <h3 className="text-[13px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">الحد الائتماني</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            الحد (فارغ = بلا حد)
            <input id={`cap-amount-${partnerId}`} type="number" min={0} step="0.01" dir="ltr" value={cap.amount} onChange={(e) => setCap({ ...cap, amount: e.target.value })} className={`${field} tv-tnum w-32`} />
          </label>
          <label className={label}>
            العملة
            <input id={`cap-currency-${partnerId}`} dir="ltr" value={cap.currency} onChange={(e) => setCap({ ...cap, currency: e.target.value.toUpperCase() })} className={`${field} w-20`} />
          </label>
          <button type="submit" disabled={pending} className="inline-flex h-9 items-center rounded-[9px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] disabled:opacity-60">
            حفظ
          </button>
        </div>
        <p className="text-[11px] font-semibold text-tv-text-faint">
          حين يتجاوز المستحق الحد تُرفض «العميل أكّد» من بوابة الشركة، ويبقى التأكيد ممكناً من قسم العمليات عندنا.
        </p>
      </form>

      {note ? <p className={`text-[12px] font-bold lg:col-span-2 ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{note.text}</p> : null}
    </section>
  );
}
