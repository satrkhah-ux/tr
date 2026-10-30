"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateBooking, type OperationBooking } from "@/lib/data/operation-bookings";
import { isRefundMode, REFUND_MODE_KEY, refundBadge, riyadhDay, type RefundMode } from "@/lib/operations/refund-mode";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

type Row = Pick<OperationBooking, "id" | "detail" | "cancellation_deadline" | "is_paid">;

const modeOf = (b: Row): RefundMode | null => {
  const m = b.detail?.[REFUND_MODE_KEY];
  return isRefundMode(m) ? m : null;
};
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

const TONE = {
  red: "bg-[#fdeeee] text-[#c43d3d]",
  amber: "bg-[#fff4e0] text-[#a05a00]",
  green: "bg-tv-status-success-bg text-tv-status-success",
  grey: "bg-[#eef2f1] text-[#557d78]",
} as const;

/** «يُلغى إن لم يُدفع قبل …» red within 3 days and unpaid · «استرجاع حتى …» · «غير مسترجع» (refund-mode.ts refundBadge). */
export function RefundBadge({ booking }: { booking: Row }) {
  const badge = refundBadge(modeOf(booking), riyadhDay(booking.cancellation_deadline), booking.is_paid, today());
  if (!badge) return null;
  return <span className={`tv-tnum whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TONE[badge.tone]}`}>{badge.text}</span>;
}

/** The mode and its day, set or changed by operations (updateBooking's `refund`). */
export function RefundEditor({ booking }: { booking: Row }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [mode, setMode] = useState<RefundMode | "">(modeOf(booking) ?? "");
  const [date, setDate] = useState(riyadhDay(booking.cancellation_deadline) ?? "");
  const [error, setError] = useState<string | null>(null);
  const dated = mode === "refundable_until" || mode === "pay_by";

  function save() {
    startTransition(async () => {
      setError(null);
      const res = await updateBooking({ id: booking.id, refund: { mode: mode || null, date: dated ? date || null : null } });
      if (!res.ok) return setError(t(res.error));
      router.refresh();
    });
  }

  const field = "h-9 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-bold text-[#185045]";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select value={mode} onChange={(e) => setMode(e.target.value as RefundMode | "")} aria-label={t("pg.refundable")} className={field}>
        <option value="">—</option>
        <option value="non_refundable">{t("pg.nonRefundable")}</option>
        <option value="refundable_until">{`${t("pg.refundable")} ${t("pg.refundUntil")}`}</option>
        <option value="pay_by">{t("pg.payBy")}</option>
      </select>
      {dated ? <input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("pg.refundUntil")} className={`tv-tnum ${field}`} /> : null}
      <button type="button" disabled={pending} onClick={save} className={`${field} hover:bg-[#f4f8f6] disabled:opacity-50`}>
        {t("save")}
      </button>
      {error ? <span className="text-[11.5px] font-bold text-[#c22850]">{error}</span> : null}
    </div>
  );
}
