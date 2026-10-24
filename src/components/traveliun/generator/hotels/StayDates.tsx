"use client";

import { CalendarPlus, CalendarRange, ChevronDown, Plus, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DirText } from "@/components/DirText";
import type { HotelStay, StayDates } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";

const ADD_LABEL: Record<StayDates, TranslationKey> = {
  after: "pg.stay.after",
  same: "pg.stay.same",
  custom: "pg.stay.custom",
};

/** what each way means, under its name in the menu */
const ADD_HINT: Record<StayDates, TranslationKey> = {
  after: "pg.stay.after.hint",
  same: "pg.stay.same.hint",
  custom: "pg.stay.custom.hint",
};

const ADD_ICON = { after: CalendarRange, same: Users, custom: CalendarPlus } as const;

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
  // a menu of its own, each way with what it means — never three more buttons in the row (the owner, 2026-10-24)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>
        <Plus className="size-3.5" />
        {label}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[19rem]">
        {(Object.keys(ADD_LABEL) as StayDates[]).map((d) => {
          const Icon = ADD_ICON[d];
          return (
            <DropdownMenuItem key={d} onClick={() => onAdd(d)} className="items-start">
              <Icon className="mt-0.5 size-4 shrink-0 text-[#2aa87a]" />
              <span className="grid gap-0.5">
                <span className="text-[12.5px] font-extrabold">{t(ADD_LABEL[d])}</span>
                <span className="text-[11px] font-semibold text-[#7a948f]">{t(ADD_HINT[d])}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
