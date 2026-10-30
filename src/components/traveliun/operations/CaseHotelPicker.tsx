"use client";

import { useEffect, useState } from "react";
import { caseHotelCatalog, type CaseHotelCatalog, type CatalogHotel } from "@/lib/data/operation-bookings";
import { HotelCombobox } from "../basic/HotelCombobox";
import { useTraveliunUI } from "../TraveliunUIProvider";

/** One fetch per case per page load, shared by «إضافة حجز» and every hotel's edit form. */
const cache = new Map<string, Promise<CaseHotelCatalog>>();

/** The case's hotel catalogue (operations order 4) — asked for only once a form needs it. */
export function useCaseHotels(operationId: string, on: boolean): CaseHotelCatalog | null {
  const [catalog, setCatalog] = useState<CaseHotelCatalog | null>(null);
  useEffect(() => {
    if (!on || catalog) return;
    let live = true;
    let pending = cache.get(operationId);
    if (!pending) {
      pending = caseHotelCatalog(operationId);
      cache.set(operationId, pending);
    }
    pending.then((c) => live && setCatalog(c)).catch(() => cache.delete(operationId));
    return () => {
      live = false;
    };
  }, [operationId, on, catalog]);
  return catalog;
}

/**
 * The hotel picked by typing part of its name — Basic's picker, over the
 * catalogue. Picking one hands back its city; a name the list does not hold is
 * typed in the description instead.
 */
export function CatalogHotelPick({
  catalog,
  valueId,
  currentName,
  onPick,
}: {
  catalog: CaseHotelCatalog | null;
  valueId: string | null;
  currentName?: string | null;
  onPick: (hotel: CatalogHotel | null) => void;
}) {
  const { t } = useTraveliunUI();
  const hotels = catalog?.hotels ?? [];
  return (
    <div className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
      <span>{t("ops.booking.pickHotel")}</span>
      <HotelCombobox
        hotels={hotels}
        valueId={valueId}
        currentName={currentName}
        placeholder={t("ops.booking.pickHotelPh")}
        onPick={(h) => onPick(h ? (hotels.find((x) => x.id === h.id) ?? null) : null)}
      />
      <span className="text-[11px] font-semibold text-tv-text-faint">{t("ops.booking.typedHint")}</span>
    </div>
  );
}
