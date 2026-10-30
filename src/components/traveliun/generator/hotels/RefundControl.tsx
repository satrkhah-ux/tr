"use client";

import { draftRefund, type RefundMode } from "@/lib/operations/refund-mode";

type Value = { refundable: boolean | null; refundable_until: string | null; pay_by: string | null };

/**
 * «غير مسترجع / مسترجع حتى [تاريخ] / يُلغى إن لم ندفع حتى [تاريخ]» (the owner,
 * 2026-10-30) — part of the stay's price, so both screens put it beside the
 * price. The same control in Basic's city card and the generator's stay card.
 * Clicking the active choice clears it. The third is internal: the client's
 * document prints nothing for it (stayCancellation). A supplier rate states its
 * own terms: `locked` shows them, read-only.
 */
export function RefundControl({
  refundable,
  until,
  payBy,
  onChange,
  labels,
  locked,
}: {
  refundable: boolean | null | undefined;
  until: string | null | undefined;
  payBy?: string | null;
  onChange: (next: Value) => void;
  labels: { yes: string; no: string; until: string; payBy: string };
  locked?: boolean;
}) {
  const current = draftRefund({ refundable, refundable_until: until, pay_by: payBy })?.mode ?? (payBy === "" ? "pay_by" : null);
  const date = current === "pay_by" ? (payBy ?? "") : (until ?? "");
  const set = (mode: RefundMode | null, day: string | null) =>
    onChange(
      mode === "non_refundable"
        ? { refundable: false, refundable_until: null, pay_by: null }
        : mode === "refundable_until"
          ? { refundable: true, refundable_until: day, pay_by: null }
          : mode === "pay_by"
            ? // no date yet: "" keeps the choice open until one is typed (normaliseHotel drops it unsaved)
              { refundable: null, refundable_until: null, pay_by: day ?? "" }
            : { refundable: null, refundable_until: null, pay_by: null },
    );
  const choices: [RefundMode, string, string][] = [
    ["non_refundable", labels.no, "bg-[#fdeeee] text-[#c43d3d]"],
    ["refundable_until", labels.yes, "bg-tv-status-success-bg text-tv-status-success"],
    ["pay_by", labels.payBy, "bg-[#fff4e0] text-[#a05a00]"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span role="group" className="inline-flex overflow-hidden rounded-[7px] border border-[#cfe0d9] text-[11.5px] font-bold">
        {choices
          .filter(([mode]) => !locked || mode === current)
          .map(([mode, text, on]) => (
            <button
              key={mode}
              type="button"
              disabled={locked}
              aria-pressed={current === mode}
              onClick={() => set(current === mode ? null : mode, mode === "non_refundable" ? null : date || null)}
              className={`h-8 px-2.5 transition-colors ${current === mode ? on : "bg-white text-[#557d78] hover:bg-[#f4f8f6]"}`}
            >
              {text}
            </button>
          ))}
      </span>
      {!locked && (current === "refundable_until" || current === "pay_by") ? (
        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#557d78]">
          {current === "pay_by" ? null : labels.until}
          <input
            type="date"
            dir="ltr"
            aria-label={current === "pay_by" ? labels.payBy : labels.until}
            value={date}
            onChange={(e) => set(current, e.target.value || null)}
            className="tv-tnum h-8 rounded-[7px] border border-[#cfe0d9] bg-white px-1.5 text-[11.5px] font-bold text-[#185045]"
          />
        </label>
      ) : null}
    </div>
  );
}
