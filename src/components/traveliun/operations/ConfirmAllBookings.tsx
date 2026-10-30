"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { confirmBookings, type OperationBooking } from "@/lib/data/operation-bookings";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const field =
  "tv-field h-10 w-full min-w-0 rounded-[9px] border px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";

type Row = { no: string; supplier: string; net: string };

/** Whose booking it is, as the agent groups them: the supplier named on it, else whoever it was given to. */
const supplierOf = (b: OperationBooking) => b.supplier_name.trim() || b.assignee_label?.trim() || "";

/**
 * «تأكيد الكل» (operations order 5): every booking still waiting, one line each
 * — booking · supplier · confirmation number · net — saved in one action. One
 * number can be put on several lines at once: a supplier that answers the whole
 * file with one reference, picked by its name.
 */
export function ConfirmAllBookings({
  operationId,
  bookings,
  canSetNet,
  onDone,
}: {
  operationId: string;
  bookings: OperationBooking[];
  /** the manager's step on this case (operations.write, or manage_own on one's own file): what the supplier charged (0080/0081) — no column for anyone else. */
  canSetNet: boolean;
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(bookings.map((b) => [b.id, { no: b.confirmation_number ?? "", supplier: b.supplier_name, net: "" }])),
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [one, setOne] = useState("");
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const row = (id: string): Row => rows[id] ?? { no: "", supplier: "", net: "" };
  const edit = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...row(id), ...patch } }));
  const suppliers = [...new Set(bookings.map(supplierOf).filter(Boolean))];
  const ready = bookings.filter((b) => row(b.id).no.trim());

  function save() {
    startTransition(async () => {
      setError(null);
      setDone(null);
      const res = await confirmBookings({
        operation_id: operationId,
        entries: ready.map((b) => {
          const r = row(b.id);
          const net = r.net.trim() === "" ? null : Number(r.net);
          return {
            booking_id: b.id,
            confirmation_number: r.no,
            ...(r.supplier.trim() && r.supplier.trim() !== b.supplier_name.trim() ? { supplier_name: r.supplier } : {}),
            ...(canSetNet && net != null && Number.isFinite(net) ? { net_charged: net } : {}),
          };
        }),
      });
      if (!res.ok) setError(t(res.error));
      else setDone(res.confirmed);
      onDone();
    });
  }

  return (
    <div className="mb-3 rounded-[11px] border border-[#d6eadf] bg-[#f6fbf8] p-3">
      <p className="mb-2 text-[11.5px] font-semibold text-[#557d78]">{t("ops.confirmAll.hint")}</p>

      {/* one number onto the chosen lines */}
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="grid min-w-44 flex-1 gap-1 text-[11.5px] font-bold text-[#185045]">
          {t("ops.confirmAll.one")}
          <input dir="ltr" value={one} onChange={(e) => setOne(e.target.value)} className={`${field} tv-tnum text-start`} />
        </label>
        <button
          type="button"
          disabled={!one.trim() || picked.size === 0}
          onClick={() => setRows((r) => ({ ...r, ...Object.fromEntries([...picked].map((id) => [id, { ...row(id), no: one.trim() }])) }))}
          className="inline-flex h-10 items-center rounded-[9px] border border-[#b7d0c7] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-45"
        >
          {t("ops.confirmAll.apply")}
          <DirText dir="ltr" className="ms-1.5 tv-tnum text-tv-text-faint">{`(${picked.size})`}</DirText>
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setPicked((p) => (p.size === bookings.length ? new Set() : new Set(bookings.map((b) => b.id))))}
          className="rounded-full border border-[#b7d0c7] bg-white px-2.5 py-1 text-[11px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        >
          {t("ops.confirmAll.all")}
        </button>
        {suppliers.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPicked(new Set(bookings.filter((b) => supplierOf(b) === s).map((b) => b.id)))}
            className="rounded-full border border-[#b7d0c7] bg-white px-2.5 py-1 text-[11px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            {t("ops.confirmAll.supplierPick", { name: s })}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {bookings.map((b) => {
          const r = row(b.id);
          return (
            <li
              key={b.id}
              className={`grid items-end gap-2 rounded-[9px] border border-[#e2ebe7] bg-white p-2.5 ${canSetNet ? "sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem]" : "sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}
            >
              <input
                type="checkbox"
                aria-label={b.title}
                checked={picked.has(b.id)}
                onChange={(e) =>
                  setPicked((p) => {
                    const next = new Set(p);
                    if (e.target.checked) next.add(b.id);
                    else next.delete(b.id);
                    return next;
                  })
                }
                className="size-4 self-center accent-[#185045]"
              />
              <div className="min-w-0 self-center">
                <p className="truncate text-[12.5px] font-extrabold text-[#0f3d38]">{b.title}</p>
                <p className="tv-tnum text-[11px] font-bold text-tv-text-faint">
                  {t(`ops.booking.${b.kind}` as TranslationKey)}
                  {b.city_name ? ` · ${b.city_name}` : ""}
                  {b.start_date ? <DirText dir="ltr" className="ms-1.5">{b.start_date}</DirText> : null}
                </p>
              </div>
              <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
                {t("ops.confirmAll.supplier")}
                <input value={r.supplier} onChange={(e) => edit(b.id, { supplier: e.target.value })} className={field} />
              </label>
              <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
                {t("ops.booking.confirmationNo")}
                <input dir="ltr" value={r.no} onChange={(e) => edit(b.id, { no: e.target.value })} className={`${field} tv-tnum text-start`} />
              </label>
              {canSetNet ? (
                <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
                  {t("ops.confirmAll.net")}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    dir="ltr"
                    inputMode="decimal"
                    value={r.net}
                    // the quoted net as a hint (staff with the internal view only) — saved only when typed
                    placeholder={b.quoted_net != null ? `${b.quoted_net} ${b.currency}` : b.currency}
                    onChange={(e) => edit(b.id, { net: e.target.value })}
                    className={`${field} tv-tnum`}
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || ready.length === 0}
          onClick={save}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {t("ops.confirmAll.save", { n: ready.length })}
        </button>
        {done != null ? <span className="text-[12px] font-bold text-[#0f7a52]">{t("ops.confirmAll.done", { n: done })}</span> : null}
      </div>
    </div>
  );
}
