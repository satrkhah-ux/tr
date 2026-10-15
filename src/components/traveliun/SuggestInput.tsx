"use client";

import { useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { ChevronDown } from "lucide-react";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { cn } from "@/lib/utils";
import { unzoomedRoot, ZOOMED_POPUP } from "@/components/ui/overlay-root";

/**
 * One suggestion: the text it puts in the field, a hint beside it (a price, a
 * city), and other words it is found by (an airport by its city: «جدة»).
 */
export type Suggestion = { value: string; hint?: string; keywords?: string };

/**
 * A free-text field with its list — what `<input list>` + `<datalist>` was
 * meant to be. The browser's datalist only shows the entries that match what is
 * already in the box, so a field holding a tour («جولة المدينة», or a day's
 * title) opened an empty list and the other tours could not be seen. Here a
 * click or the arrow opens the WHOLE list; it narrows only on what the agent
 * types after that (hamza / ta-marbuta folded, as the catalogue matches).
 *
 * `onChange(value, picked)`: `picked` is true when the value came from the
 * list, false when it was typed. Only those two reach it: Base UI also empties
 * the input itself (Escape with the list closed, a close that «clears the
 * query»), which here would have dropped a day's tour or its title — the field
 * is controlled, so ignoring them keeps it as it was. Nothing matching what is
 * typed hides the list: a free title is not an error. The field is the same
 * element with or without a list, so a list that arrives while the agent types
 * never takes the caret away.
 */
export function SuggestInput({
  value,
  items,
  onChange,
  placeholder,
  ariaLabel,
  className,
  disabled,
  arrow = true,
}: {
  value: string;
  items: Suggestion[];
  onChange: (value: string, picked: boolean) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** the input's own classes (the screen's field style). */
  className?: string;
  disabled?: boolean;
  /** the arrow at the field's end — off where something else sits there (FlightBuilder's swap); a click still opens the list. */
  arrow?: boolean;
}) {
  // each entry once, none blank — a list may repeat a name (two hotels, two countries' lists)
  const list = [...new Map(items.filter((s) => s.value.trim()).map((s) => [s.value, s] as const)).values()];
  // what was typed since the list opened; null — show it all
  const [query, setQuery] = useState<string | null>(null);

  return (
    <Autocomplete.Root
      items={list}
      value={value}
      openOnInputClick
      disabled={disabled}
      itemToStringValue={(s: Suggestion) => s.value}
      filter={(s: Suggestion) => !query?.trim() || normalizeName(`${s.value} ${s.keywords ?? ""}`).includes(normalizeName(query))}
      onOpenChange={(open) => {
        if (!open) setQuery(null);
      }}
      onValueChange={(next, details) => {
        const picked = details.reason === "item-press";
        if (!picked && details.reason !== "input-change") return;
        setQuery(picked ? null : next);
        onChange(next, picked);
      }}
    >
      <div className="relative min-w-0">
        <Autocomplete.Input aria-label={ariaLabel} placeholder={placeholder} className={cn(className, arrow && list.length > 0 && "pe-8")} />
        {arrow && list.length > 0 ? (
          <Autocomplete.Trigger
            aria-label={ariaLabel}
            disabled={disabled}
            className="absolute inset-y-0 end-0 flex w-8 items-center justify-center text-[#557d78] disabled:opacity-40"
          >
            <ChevronDown className="size-4" />
          </Autocomplete.Trigger>
        ) : null}
      </div>
      <Autocomplete.Portal container={unzoomedRoot()}>
        <Autocomplete.Positioner sideOffset={4} className="z-[170] outline-none data-[empty]:hidden">
          <Autocomplete.Popup className={`${ZOOMED_POPUP} min-w-56 overflow-y-auto rounded-md border border-[#d9e0dc] bg-white p-1 text-[#185045] shadow-[0_10px_30px_rgba(0,0,0,0.16)] outline-none dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]`}>
            <Autocomplete.List>
              {(s: Suggestion) => (
                <Autocomplete.Item
                  key={s.value}
                  value={s}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-[#f2f7f5] dark:data-[highlighted]:bg-[#1b2d27]"
                >
                  <span className="min-w-0 flex-1">{s.value}</span>
                  {s.hint ? <span className="tv-tnum shrink-0 text-[11px] font-bold text-[#557d78]">{s.hint}</span> : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
