"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { HotelStay, StayDates } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";

const ADD_LABEL: Record<StayDates, TranslationKey> = {
  after: "pg.stay.after",
  same: "pg.stay.same",
  custom: "pg.stay.custom",
};

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * When a stay is: its check-in and check-out, the «بنفس تواريخ فندق X» badge,
 * and — for a stay on dates of its own — the date and nights, held inside the
 * city's dates. Shared by the generator's stay card and the basic screen.
 */
export function StayDatesLine({
  stay,
  city,
  inputClass,
  onChange,
}: {
  stay: HotelStay;
  city: { check_in: string | null; check_out: string | null; nights: number };
  inputClass: string;
  onChange: (slice: { check_in?: string; nights?: number }) => void;
}) {
  const { t } = useTraveliunUI();
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#557d78]">
      {stay.dates === "custom" ? (
        <>
          <label className="inline-flex items-center gap-1">
            {t("pg.checkIn")}
            <input
              type="date"
              dir="ltr"
              min={city.check_in ?? undefined}
              max={city.check_out ? dayBefore(city.check_out) : undefined}
              value={stay.line.check_in ?? ""}
              onChange={(e) => e.target.value && onChange({ check_in: e.target.value })}
              className={`${inputClass} tv-tnum w-36`}
            />
          </label>
          <label className="inline-flex items-center gap-1">
            {t("pg.cityNights")}
            <input
              type="number"
              min={1}
              max={Math.max(city.nights, 1)}
              dir="ltr"
              value={stay.nights}
              onChange={(e) => onChange({ nights: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })}
              className={`${inputClass} tv-tnum w-16 text-center`}
            />
          </label>
        </>
      ) : null}
      {stay.check_in && stay.check_out ? (
        <span className="tv-tnum">
          {t("pg.checkIn")} <DirText dir="ltr">{stay.check_in}</DirText> · {t("pg.checkOut")} <DirText dir="ltr">{stay.check_out}</DirText>
        </span>
      ) : null}
      {stay.same_as ? (
        <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] text-[#185045]">
          {t("pg.stay.sameAs", { hotel: stay.same_as.hotel_name.trim() || t("pg.stay.previous") })}
        </span>
      ) : null}
    </span>
  );
}

/** «فندق آخر»: after it, on the same dates (the rooms split), or on dates of its own. */
export function AddStayMenu({ label, className, onAdd }: { label: string; className: string; onAdd: (dates: StayDates) => void }) {
  const { t } = useTraveliunUI();
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={className}>
        <Plus className="size-3.5" />
        {label}
      </button>
      {open
        ? (Object.keys(ADD_LABEL) as StayDates[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd(d);
              }}
              className="inline-flex h-8 items-center rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
            >
              {t(ADD_LABEL[d])}
            </button>
          ))
        : null}
    </span>
  );
}
