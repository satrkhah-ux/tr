"use client";

import { Combobox } from "@base-ui/react/combobox";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { pickSupplierHotel, searchSupplierHotels } from "@/lib/data/hotel-search";
import { addStaffHotel } from "@/lib/data/catalog-additions";
import { normAr, similarity } from "@/lib/catalog/norm";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { cn } from "@/lib/utils";
import { unzoomedRoot, ZOOMED_POPUP } from "@/components/ui/overlay-root";
import { useTraveliunUI } from "../TraveliunUIProvider";

export type HotelOption = {
  id: string;
  name: string;
  /** our hotel's English name — a name typed in Latin letters finds it by that */
  name_en?: string | null;
  stars?: number | null;
  /** its TBO code — a hotel of ours linked to TBO, or (with a "tbo:" id) one of TBO's still to be added */
  tbo?: string | null;
};

const TBO_ID = "tbo:";

/** a stay whose hotel is not in this city's list keeps showing it (an old or typed name) */
const CURRENT = "__current";
/** «أضف … فندقاً جديداً»: the typed name, made a /hotels row of this city and sent to the data team */
const ADD = "__add__";

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
  supplier,
  tboLabel,
  onFailed,
  addCity,
}: {
  hotels: HotelOption[];
  valueId: string | null;
  currentName?: string | null;
  onPick: (hotel: HotelOption | null) => void;
  placeholder: string;
  className?: string;
  /** search TBO's list of this city too, for a name in English (the owner, 2026-10-24) — staff files only */
  supplier?: { country: string; city: string } | null;
  tboLabel?: string;
  /** a TBO hotel that could not be added */
  onFailed?: () => void;
  /** staff only (the owner, 2026-10-29): the city a typed hotel the list lacks is added to */
  addCity?: string | null;
}) {
  const { t } = useTraveliunUI();
  const listed = hotels.find((h) => h.id === valueId) ?? null;
  const current = !listed && currentName ? { id: valueId ?? CURRENT, name: currentName } : null;
  // what the box shows while typing; null = the chosen hotel's own name
  const [typed, setTyped] = useState<string | null>(null);
  // TBO's hotels for what is typed in Latin letters — the ones we already hold are not offered twice
  // the hits and the query they answer — another query's hits are never shown under this one
  const [remote, setRemote] = useState<{ q: string; hits: HotelOption[] }>({ q: "", hits: [] });
  const [adding, setAdding] = useState(false);
  // a TBO pick lands seconds later: it goes through the card's newest onPick (never the one from the click, which
  // would write the lines as they were then over every edit made meanwhile), and only if no other pick came since
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });
  const picks = useRef(0);
  const query = typed?.trim() ?? "";
  const latin = /[a-z]{2}/i.test(query) && !/[\u0600-\u06FF]/.test(query);
  // by value, not by object: the card makes both afresh on every render
  const where = supplier ? `${supplier.country}|${supplier.city}` : "";
  const ours = hotels.map((h) => h.tbo).filter(Boolean).join(",");
  useEffect(() => {
    if (!where || !latin) return;
    const [country, city] = where.split("|");
    let live = true;
    const timer = window.setTimeout(() => {
      void searchSupplierHotels(country, city, query)
        .then((found) => {
          if (!live) return;
          const held = new Set(ours.split(","));
          setRemote({ q: query, hits: found.filter((f) => !held.has(f.code)).map((f) => ({ id: `${TBO_ID}${f.code}`, name: f.name, stars: f.stars, tbo: f.code })) });
        })
        .catch(() => {
          if (live) setRemote({ q: query, hits: [] });
        });
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [where, latin, query, ours]);
  const shownRemote = supplier && latin && remote.q === query ? remote.hits : [];
  // a name the city's list does not hold, typed by staff: offered as a new hotel — the close
  // spellings stay in the list above it (the filter's «هل تقصد»), so a near-copy is seen first
  const typedName = query.replace(/\s+/g, " ");
  const known = typedName.length >= 3 && hotels.some((h) => normalizeName(h.name) === normalizeName(typedName));
  const addItem: HotelOption[] = addCity && typedName.length >= 3 && !known ? [{ id: ADD, name: typedName }] : [];
  const items = [...(current ? [current] : []), ...hotels, ...shownRemote, ...addItem];
  const chosen = listed ?? current;

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
        const n = ++picks.current;
        if (next.id.startsWith(TBO_ID) && next.tbo && supplier) {
          // one of TBO's: made ours first (a /hotels row linked to its code), then picked
          setAdding(true);
          void pickSupplierHotel(next.tbo, supplier.city)
            .then((res) => {
              if (n !== picks.current) return;
              if (res.ok) pickRef.current(res.hotel);
              else onFailed?.();
            })
            .catch(() => n === picks.current && onFailed?.())
            .finally(() => n === picks.current && setAdding(false));
          return;
        }
        if (next.id === ADD && addCity) {
          setAdding(true);
          void addStaffHotel({ city: addCity, typed: next.name, name: next.name })
            .then((res) => {
              if (n !== picks.current) return;
              if (res.ok) pickRef.current(res.hotel);
              else onFailed?.();
            })
            .catch(() => n === picks.current && onFailed?.())
            .finally(() => n === picks.current && setAdding(false));
          return;
        }
        setAdding(false);
        onPick(next);
      }}
      itemToStringLabel={(h) => h.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      // the chosen hotel's own name in the box is not a search — opening the list shows them all
      filter={(h, query) => {
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        // TBO's hits: every typed word in the name, like the server asked
        if (h.id.startsWith(TBO_ID)) return words.every((w) => h.name.toLowerCase().includes(w));
        if (h.id === ADD) return true;
        return (
          !query.trim() ||
          query === chosen?.name ||
          normalizeName(h.name).includes(normalizeName(query)) ||
          // a misspelt name still finds its hotel: «هيلتن» → «هيلتون»
          (query.trim().length >= 4 && similarity(normAr(h.name), normAr(query)) >= 0.75) ||
          // ours by its English name too, so a hotel linked to TBO is found by the name TBO gives it
          (words.length > 0 && Boolean(h.name_en) && words.every((w) => h.name_en!.toLowerCase().includes(w)))
        );
      }}
    >
      <div className={cn("relative", className)}>
        <Combobox.Input
          aria-label={placeholder}
          placeholder={placeholder}
          onBlur={() => setTyped(null)}
          className={`h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white ${chosen ? "pe-14" : "pe-8"} ps-2.5 text-[12.5px] font-semibold text-[#185045] outline-none focus:border-[#2aa87a] dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]`}
        />
        {adding ? (
          <span className="absolute inset-y-0 start-2 flex items-center text-[#2aa87a]" aria-hidden>
            <Loader2 className="size-3.5 animate-spin" />
          </span>
        ) : null}
        {chosen ? (
          <button
            type="button"
            aria-label="إزالة الفندق"
            title="إزالة الفندق"
            onClick={() => {
              setTyped(null);
              picks.current += 1;
              setAdding(false);
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
                  <span className="min-w-0 flex-1" dir="auto">
                    {h.id === ADD ? <span className="font-extrabold text-[#0f7a52]">＋ أضف «{h.name}» فندقاً جديداً — يُرسل لقسم البيانات</span> : h.name}
                  </span>
                  {h.tbo ? <span className="shrink-0 rounded-full bg-[#eef4ff] px-1.5 text-[10px] font-extrabold text-[#2b5bb5]">{tboLabel ?? "TBO"}</span> : null}
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
