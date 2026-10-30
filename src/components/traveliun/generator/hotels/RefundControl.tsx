"use client";

/**
 * «مسترد / غير مسترد» and, when refundable, until when — part of the stay's
 * price, so both screens put it beside the price. The same control in Basic's
 * city card and the generator's stay card. Clicking the active choice clears it.
 */
export function RefundControl({
  refundable,
  until,
  onChange,
  labels,
}: {
  refundable: boolean | null | undefined;
  until: string | null | undefined;
  onChange: (next: { refundable: boolean | null; refundable_until: string | null }) => void;
  labels: { yes: string; no: string; until: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span role="group" className="inline-flex overflow-hidden rounded-[7px] border border-[#cfe0d9] text-[11.5px] font-bold">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={refundable === v}
            onClick={() => {
              const next = refundable === v ? null : v;
              // a date belongs to «مسترد» only
              onChange({ refundable: next, refundable_until: next ? (until ?? null) : null });
            }}
            className={`h-8 px-2.5 transition-colors ${
              refundable === v
                ? v
                  ? "bg-tv-status-success-bg text-tv-status-success"
                  : "bg-[#fdeeee] text-[#c43d3d]"
                : "bg-white text-[#557d78] hover:bg-[#f4f8f6]"
            }`}
          >
            {v ? labels.yes : labels.no}
          </button>
        ))}
      </span>
      {refundable ? (
        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#557d78]">
          {labels.until}
          <input
            type="date"
            dir="ltr"
            value={until ?? ""}
            onChange={(e) => onChange({ refundable: true, refundable_until: e.target.value || null })}
            className="tv-tnum h-8 rounded-[7px] border border-[#cfe0d9] bg-white px-1.5 text-[11.5px] font-bold text-[#185045]"
          />
        </label>
      ) : null}
    </div>
  );
}
