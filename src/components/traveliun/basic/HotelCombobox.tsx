"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { cn } from "@/lib/utils";
import { useTraveliunUI } from "../TraveliunUIProvider";

export type HotelOption = { id: string; name: string; stars?: number | null };

/** a stay whose hotel is not in this city's list keeps showing it (an old or typed name) */
const CURRENT = "__current";

/**
 * The hotel of a city, picked by typing part of its name — a long city list
 * (Kuala Lumpur has hundreds) is unusable as a plain dropdown. Matching folds
 * hamza, ta-marbuta and alef-maqsura the way the catalogue does, so «اسطنبول»
 * finds «إسطنبول».
 */
export function HotelCombobox({
  hotels,
  valueId,
  currentName,
  onPick,
  placeholder,
  className,
}: {
  hotels: HotelOption[];
  valueId: string | null;
  currentName?: string | null;
  onPick: (hotel: HotelOption | null) => void;
  placeholder: string;
  className?: string;
}) {
  const { t } = useTraveliunUI();
  const listed = hotels.find((h) => h.id === valueId) ?? null;
  const current = !listed && currentName ? { id: valueId ?? CURRENT, name: currentName } : null;
  const items = current ? [current, ...hotels] : hotels;

  return (
    <Combobox.Root<HotelOption>
      items={items}
      value={listed ?? current}
      onValueChange={(next) => {
        if (next && next.id === current?.id) return;
        onPick(next);
      }}
      itemToStringLabel={(h) => h.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(h, query) => !query.trim() || normalizeName(h.name).includes(normalizeName(query))}
    >
      <div className={cn("relative", className)}>
        <Combobox.Input
          aria-label={placeholder}
          placeholder={placeholder}
          className="h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white pe-8 ps-2.5 text-[12.5px] font-semibold text-[#185045] outline-none focus:border-[#2aa87a] dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]"
        />
        <Combobox.Trigger
          aria-label={placeholder}
          className="absolute inset-y-0 end-0 flex w-8 items-center justify-center text-[#557d78]"
        >
          <ChevronDown className="size-4" />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-[170] outline-none">
          <Combobox.Popup className="max-h-[min(320px,var(--available-height))] w-[var(--anchor-width)] min-w-56 overflow-y-auto rounded-md border border-[#d9e0dc] bg-white p-1 text-[#185045] shadow-[0_10px_30px_rgba(0,0,0,0.16)] outline-none dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]">
            <Combobox.Empty className="px-2 py-2 text-[12px] text-[#93aaa3] empty:hidden">{t("noResults")}</Combobox.Empty>
            <Combobox.List>
              {(h: HotelOption) => (
                <Combobox.Item
                  key={h.id}
                  value={h}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-[#f2f7f5] dark:data-[highlighted]:bg-[#1b2d27]"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <Combobox.ItemIndicator>
                      <Check className="size-4 text-[#2aa87a]" />
                    </Combobox.ItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1">{h.name}</span>
                  {h.stars ? <span className="shrink-0 text-[11px] text-[#c79a2b]">{"★".repeat(h.stars)}</span> : null}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
