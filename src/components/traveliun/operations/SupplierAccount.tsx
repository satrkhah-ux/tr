"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Pencil, Store, Wallet } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  setSupplierReplyHours,
  type SupplierAccount,
  type SupplierAccountSummary,
} from "@/lib/data/supplier-work";
import type { SupplierBalance } from "@/lib/operations/supplier-request";
import { useRole } from "@/lib/roles/RoleContext";
import { canOpenPath } from "@/lib/roles/section-access";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";
import { PaymentList, SupplierPaymentForm, money } from "./SupplierPanel";

const card = "tv-card rounded-2xl border p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const back =
  "inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]";

/** «علينا له» / «عليه لنا» per currency — a positive balance is ours to pay. */
function BalanceChips({ balances }: { balances: SupplierBalance[] }) {
  const { t } = useTraveliunUI();
  const open = balances.filter((b) => b.balance !== 0);
  if (open.length === 0) {
    return <span className="rounded-full bg-[#eef4f1] px-2.5 py-0.5 text-[11.5px] font-bold text-[#557d78]">{t("ops.sup.settled")}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {open.map((b) => (
        <span
          key={b.currency}
          className={`tv-tnum rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${
            b.balance > 0 ? "bg-tv-status-warning-bg text-tv-status-warning" : "bg-tv-status-success-bg text-tv-status-success"
          }`}
        >
          {t(b.balance > 0 ? "ops.sup.weOwe" : "ops.sup.theyOwe")}{" "}
          <DirText dir="ltr">{money({ amount: Math.abs(b.balance), currency: b.currency })}</DirText>
        </span>
      ))}
    </span>
  );
}

/** /operations/suppliers — every supplier and where its account stands. */
export function SupplierAccountsList({
  suppliers,
  replyHours,
  canManage,
}: {
  suppliers: SupplierAccountSummary[];
  replyHours: number;
  canManage: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [hours, setHours] = useState(String(replyHours));
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        <Link href="/operations" className={back}>
          <ArrowRight className="size-4 ltr:rotate-180" />
          {t("ops.backToBoard")}
        </Link>

        <section className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
            <Wallet className="size-5" />
            {t("ops.sup.accounts")}
          </h1>
          <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">{t("ops.sup.listHint")}</p>

          {canManage ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
                {t("ops.sup.replyHours")}
                <input
                  type="number"
                  min={1}
                  max={720}
                  dir="ltr"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="tv-tnum h-10 w-28 rounded-[10px] border border-[#dbe6e1] px-3 text-center text-[13px]"
                />
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const res = await setSupplierReplyHours(Number(hours));
                    if (!res.ok) setError(t(res.error));
                    else router.refresh();
                  })
                }
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("save")}
              </button>
              {error ? <p className="w-full text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
            </div>
          ) : null}

          <ul className="mt-4 space-y-2">
            {suppliers.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/operations/suppliers/${s.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-[#e2ebe7] px-4 py-2.5 hover:bg-[#f8fbf9]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-extrabold text-[#0f3d38]">{s.name}</span>
                    {s.categories ? <span className="text-[11px] font-bold text-tv-text-faint">{s.categories}</span> : null}
                  </span>
                  <BalanceChips balances={s.balances} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </TraveliunShell>
  );
}

/** /operations/suppliers/[id] — one supplier: how to reach it, its bookings, payments and balance. */
export function SupplierAccountView({ account }: { account: SupplierAccount }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const { supplier, bookings, payments, balances } = account;
  const unpaid = bookings.filter((b) => b.status === "confirmed" && !b.is_paid);

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        <Link href="/operations/suppliers" className={back}>
          <ArrowRight className="size-4 ltr:rotate-180" />
          {t("ops.sup.accounts")}
        </Link>

        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
                <Store className="size-5" />
                {supplier.name}
                {supplier.name_en ? <span className="text-[13px] font-bold text-tv-text-faint">{supplier.name_en}</span> : null}
              </h1>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-bold text-[#557d78]">
                {supplier.categories ? <span>{supplier.categories}</span> : null}
                <span>{t(supplier.lang === "en" ? "ops.sup.lang.en" : "ops.sup.lang.ar")}</span>
                {supplier.contact_name ? <span>{supplier.contact_name}</span> : null}
                {supplier.phone ? <DirText dir="ltr">{supplier.phone}</DirText> : null}
                {supplier.email ? <DirText dir="ltr">{supplier.email}</DirText> : null}
              </p>
            </div>
            {canOpenPath("/company-suppliers", can) ? (
              <Link
                href="/company-suppliers"
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                <Pencil className="size-3.5" />
                {t("ops.sup.editContact")}
              </Link>
            ) : null}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {balances.length === 0 ? (
              <p className="text-[12px] font-bold text-tv-text-faint">{t("ops.sup.settled")}</p>
            ) : (
              balances.map((b) => (
                <div key={b.currency} className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 text-[12px] font-bold text-[#557d78]">
                  <p className="tv-tnum flex justify-between">
                    {t("ops.sup.owed")} <DirText dir="ltr">{money({ amount: b.owed, currency: b.currency })}</DirText>
                  </p>
                  <p className="tv-tnum mt-1 flex justify-between">
                    {t("ops.sup.paidTotal")} <DirText dir="ltr">{money({ amount: b.paid, currency: b.currency })}</DirText>
                  </p>
                  <p className="mt-2 border-t border-[#e8efec] pt-2">
                    <BalanceChips balances={[b]} />
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className="mb-2 text-sm font-extrabold text-[#185045]">{t("ops.sup.bookings")}</h2>
          {bookings.length === 0 ? (
            <p className="text-[12.5px] font-semibold text-tv-text-faint">{t("ops.sup.noBookings")}</p>
          ) : (
            <ul className="space-y-1.5">
              {bookings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#eef3f1] px-3 py-2 text-[12px] font-bold">
                  <span className="min-w-0">
                    <Link href={`/operations/${b.operation_id}`} className="tv-tnum me-2 text-[#2b57c4] hover:underline">
                      <DirText dir="ltr">{b.serial || "—"}</DirText>
                    </Link>
                    <span className="text-[#0f3d38]">{b.title}</span>
                    {b.start_date ? (
                      <span className="tv-tnum ms-2 text-tv-text-faint">
                        <DirText dir="ltr">{b.start_date}</DirText>
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={b.status === "confirmed" ? "text-[#0f7a52]" : "text-[#a86a10]"}>
                      {t(`ops.booking.status.${b.status as "pending" | "prebooked" | "in_flight" | "confirmed" | "failed" | "cancelled"}`)}
                    </span>
                    {b.status === "confirmed" ? (
                      <span className={b.is_paid ? "text-[#0f7a52]" : "text-[#a86a10]"}>{t(b.is_paid ? "ops.sup.paid" : "ops.sup.unpaid")}</span>
                    ) : null}
                    <span className="tv-tnum text-[#0f3d38]">
                      {b.cost ? <DirText dir="ltr">{money(b.cost)}</DirText> : t("ops.sup.costNone")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-[#185045]">{t("ops.sup.payments")}</h2>
            <button
              type="button"
              onClick={() => setPaying((v) => !v)}
              className="tv-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-bold max-sm:min-h-10"
            >
              <Wallet className="size-3.5" />
              {t("ops.sup.pay")}
            </button>
          </div>
          {paying ? (
            <SupplierPaymentForm
              supplierId={supplier.id}
              unpaid={unpaid.map((b) => ({ id: b.id, title: `${b.serial} — ${b.title}`, cost: b.cost }))}
              onDone={() => {
                setPaying(false);
                router.refresh();
              }}
            />
          ) : null}
          {payments.length === 0 ? (
            <p className="mt-2 text-[12.5px] font-semibold text-tv-text-faint">{t("ops.sup.noPayments")}</p>
          ) : (
            <PaymentList payments={payments} />
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
