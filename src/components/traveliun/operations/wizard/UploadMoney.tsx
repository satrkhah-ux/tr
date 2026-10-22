"use client";

import { DirText } from "@/components/DirText";
import type { MoneyRead } from "@/lib/data/upload-sort";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * The money lines of «ارفع كل الملفات» (the owner, 2026-10-23: «فاتورة
 * الفنادق و التذكرة و كم سدد العميل و كم تبقى عليه .. وطبعا يتم التدقيق من
 * الموظف»): each shows what the paper says beside what the file holds, and
 * waits for its own «تحقّقت». An invoice's lines are cost — the panel draws
 * them only for pricing.internal, and every action checks again.
 */

export type MoneyFields = {
  money: MoneyRead | null;
  /** the figures as the employee leaves them */
  amount: string;
  currency: string;
  /** «تحقّقت» — every money line needs its own */
  checked: boolean;
  /** an invoice's supplier: one of ours (id), «new» from the paper, or "" — leave the file's */
  supplier: string;
  /** the paper says paid: record the payment to that supplier too */
  payTo: boolean;
  /** a client's payment already on file — same reference, or same amount on the same day */
  duplicate: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const field = "tv-tnum h-9 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045]";

/** «إجمالي البكج · سدّد العميل · المتبقي», and after the payments ticked here. */
export function MoneySummary({ total, paid, ticked, currency }: { total: number | null; paid: number; ticked: number; currency: string }) {
  const { t } = useTraveliunUI();
  const line = (p: number) => t("wz.up.money.summary", { total: total == null ? "—" : fmt(total), paid: fmt(p), left: total == null ? "—" : fmt(Math.max(total - p, 0)), cur: currency });
  return (
    <div className="rounded-[11px] bg-[#f2fbf6] px-3 py-2 text-[12px] font-extrabold text-[#0f7a52]">
      <DirText dir="auto">{line(paid)}</DirText>
      {ticked > 0 ? (
        <p className="mt-0.5 text-[11.5px] font-bold text-[#185045]">
          {t("wz.up.money.after")} <DirText dir="auto">{line(paid + ticked)}</DirText>
        </p>
      ) : null}
    </div>
  );
}

/**
 * One money line's own part, under the place picker: the figures (editable),
 * what the file holds, an invoice's supplier and its «سُدّد للمورد», a
 * payment's amount in the package's currency, and «تحقّقت».
 */
export function MoneyFieldsRow({
  kind,
  fields,
  caseCurrency,
  inCase,
  onChange,
  disabled,
}: {
  kind: "hotel_invoice" | "ticket_invoice" | "payment";
  fields: MoneyFields;
  caseCurrency: string;
  /** a payment in another currency, at the system's rate — null when it is the package's own */
  inCase: { amount: number; rate: number } | null;
  onChange: (next: Partial<MoneyFields>) => void;
  disabled: boolean;
}) {
  const { t } = useTraveliunUI();
  const m = fields.money;
  if (!m) return null;
  const invoice = kind !== "payment";
  return (
    <div className="mt-2 grid gap-1.5 rounded-[10px] bg-[#f8fbfa] p-2.5 text-[11.5px] font-semibold text-[#557d78]">
      <div className="flex flex-wrap items-center gap-2">
        <input value={fields.amount} onChange={(e) => onChange({ amount: e.target.value })} disabled={disabled} inputMode="decimal" dir="ltr" aria-label={t("wz.up.money.amount")} className={`${field} w-28`} />
        <input value={fields.currency} onChange={(e) => onChange({ currency: e.target.value.toUpperCase().slice(0, 3) })} disabled={disabled} dir="ltr" aria-label={t("wz.up.money.currency")} className={`${field} w-16 text-center`} />
        {inCase ? (
          <span className="tv-tnum">
            ≈ <DirText dir="ltr">{`${fmt(inCase.amount)} ${caseCurrency}`}</DirText> <DirText dir="ltr">{`(× ${inCase.rate})`}</DirText>
          </span>
        ) : null}
        {[m.date, m.reference && `#${m.reference}`, m.sender].filter(Boolean).length ? (
          <DirText dir="auto" className="tv-tnum">
            {[m.date, m.reference && `#${m.reference}`, m.sender].filter(Boolean).join(" · ")}
          </DirText>
        ) : null}
      </div>

      {invoice ? (
        <>
          {/* what the file holds, beside what the paper says */}
          <p>
            {t("wz.up.money.onFile")}:{" "}
            <DirText dir="ltr" className="tv-tnum">
              {m.cost?.amount != null ? `${fmt(m.cost.amount)} ${m.cost.currency ?? ""}` : "—"}
            </DirText>
            {" · "}
            {t("wz.up.money.supplierOnFile")}: {m.onFile?.name ?? "—"}
            {m.issuer ? (
              <>
                {" · "}
                {t("wz.up.money.supplierOnPaper")}: <DirText dir="auto">{m.issuer}</DirText>
              </>
            ) : null}
          </p>
          <label className="flex flex-wrap items-center gap-2">
            {t("wz.up.money.supplier")}
            <select value={fields.supplier} onChange={(e) => onChange({ supplier: e.target.value })} disabled={disabled} className={`${field} min-w-0 max-w-full`}>
              <option value="">{m.onFile ? t("wz.up.money.keep", { name: m.onFile.name }) : t("wz.up.money.noSupplier")}</option>
              {m.supplier && m.supplier.id !== m.onFile?.id ? <option value={m.supplier.id}>{t("wz.up.money.use", { name: m.supplier.name })}</option> : null}
              {m.issuer && !m.supplier ? <option value="new">{t("wz.up.money.new", { name: m.issuer })}</option> : null}
            </select>
          </label>
          {m.paid ? (
            <label className="flex items-center gap-2 font-bold text-[#185045]">
              <input type="checkbox" checked={fields.payTo} onChange={(e) => onChange({ payTo: e.target.checked })} disabled={disabled} className="size-4 accent-[#185045]" />
              {t("wz.up.money.payTo")}
            </label>
          ) : null}
        </>
      ) : fields.duplicate ? (
        <p className="font-bold text-[#a86a10]">{t("wz.up.money.duplicate")}</p>
      ) : null}

      <label className="flex items-center gap-2 font-bold text-[#185045]">
        <input type="checkbox" checked={fields.checked} onChange={(e) => onChange({ checked: e.target.checked })} disabled={disabled} className="size-4 accent-[#185045]" />
        {t("wz.up.money.checked")}
      </label>
    </div>
  );
}
