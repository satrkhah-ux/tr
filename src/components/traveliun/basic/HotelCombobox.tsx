"use client";

import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { cn } from "@/lib/utils";
import { unzoomedRoot, ZOOMED_POPUP } from "@/components/ui/overlay-root";
import { useTraveliunUI } from "../TraveliunUIProvider";

export type HotelOption = { id: string; name: string; stars?: number | null };

/** a stay whose hotel is not in this city's list keeps showing it (an old or typed name) */
const CURRENT = "__current";

/**
 * The hotel of a city, picked by typing part of its name — a long city list
 * (Kuala Lumpur has hundreds) is unusable as a plain dropdown. Matching folds
 * hamza, ta-marbuta and alef-maqsura the way the catalogue does, so «اسطنبول»
 * finds «إسطنبول».
 *
 * Typing or erasing the name never removes the hotel (the evaluator, 2026-10-22: an
 * emptied box saved the stay with no hotel 700 ms later). The hotel changes only
 * when another one is picked, or by «إزالة الفندق»; leaving the box without a
 * pick puts the hotel's name back.
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
  const chosen = listed ?? current;
  // what the box shows while typing; null = the chosen hotel's own name
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <Combobox.Root<HotelOption>
      items={items}
      value={chosen}
      inputValue={typed ?? chosen?.name ?? ""}
      onInputValueChange={(value) => setTyped(value)}
      onOpenChange={(open) => {
        // closed without a pick: the hotel's name comes back
        if (!open) setTyped(null);
      }}
      onValueChange={(next) => {
        setTyped(null);
        // an emptied box is not a choice — only «إزالة الفندق» removes the hotel
        if (!next || next.id === current?.id) return;
        onPick(next);
      }}
      itemToStringLabel={(h) => h.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      // the chosen hotel's own name in the box is not a search — opening the list shows them all
      filter={(h, query) => !query.trim() || query === chosen?.name || normalizeName(h.name).includes(normalizeName(query))}
    >
      <div className={cn("relative", className)}>
        <Combobox.Input
          aria-label={placeholder}
          placeholder={placeholder}
          onBlur={() => setTyped(null)}
          className={`h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white ${chosen ? "pe-14" : "pe-8"} ps-2.5 text-[12.5px] font-semibold text-[#185045] outline-none focus:border-[#2aa87a] dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]`}
        />
        {chosen ? (
          <button
            type="button"
            aria-label="إزالة الفندق"
            title="إزالة الفندق"
            onClick={() => {
              setTyped(null);
              onPick(null);
            }}
            className="absolute inset-y-0 end-7 flex w-6 items-center justify-center text-[#93aaa3] hover:text-[#c22850]"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        <Combobox.Trigger
          aria-label={placeholder}
          className="absolute inset-y-0 end-0 flex w-8 items-center justify-center text-[#557d78]"
        >
          <ChevronDown className="size-4" />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal container={unzoomedRoot()}>
        <Combobox.Positioner sideOffset={4} className="z-[170] outline-none">
          <Combobox.Popup className={`${ZOOMED_POPUP} min-w-56 overflow-y-auto rounded-md border border-[#d9e0dc] bg-white p-1 text-[#185045] shadow-[0_10px_30px_rgba(0,0,0,0.16)] outline-none dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]`}>
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
