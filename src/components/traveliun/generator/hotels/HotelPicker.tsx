"use client";

import { useState } from "react";
import { Loader2, Search, SlidersHorizontal } from "lucide-react";
import { DirText } from "@/components/DirText";
import { BOARD_LABEL_KEYS, BOARD_TYPES } from "@/lib/offer/draft-types";
import type { HotelOption, HotelRateOption, SupplierNote } from "@/lib/data/hotel-search";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass } from "../stage-props";
import { HotelResultRow } from "./HotelResultRow";

/**
 * Choosing a hotel: one source, one search box, one list.
 *
 * What this replaces is three forms on screen at once — a source toggle, a
 * search panel, and a manual grid that never closed — where nothing said which
 * of them held the price that would be used. Here the agent makes one decision
 * at a time and the layout does not change between sources.
 */

export type PickerSource = {
  code: string;
  label: string;
  /** false → shown but unpickable, with `reason` saying why. Never hidden. */
  enabled: boolean;
  reason?: string;
};

export type PickerFilters = {
  name: string;
  minStars: number;
  board: string;
  refundable: "all" | "yes" | "no";
  maxPrice: string;
  sort: "price" | "price_desc" | "stars";
};

export const EMPTY_FILTERS: PickerFilters = {
  name: "",
  minStars: 0,
  board: "",
  refundable: "all",
  maxPrice: "",
  sort: "price",
};

/** Eight is what an agent reads; the rest is one press away. */
const PAGE = 8;

export function HotelPicker({
  sources,
  source,
  onSource,
  filters,
  onFilters,
  onSearch,
  searching,
  error,
  results,
  notes,
  occupancy,
  busyKey,
  onSelect,
  manual,
}: {
  sources: PickerSource[];
  source: string;
  onSource: (code: string) => void;
  filters: PickerFilters;
  onFilters: (next: PickerFilters) => void;
  onSearch: () => void;
  searching: boolean;
  error: string | null;
  results: HotelOption[] | null;
  notes: SupplierNote[];
  /** the line from stage 1 — read-only, never re-asked. */
  occupancy: string;
  busyKey: string | null;
  onSelect: (hotel: HotelOption, rate: HotelRateOption | null) => void;
  /** the manual tab's form — rendered by the caller, which owns the draft line. */
  manual: React.ReactNode;
}) {
  const { t } = useTraveliunUI();
  const [showOptions, setShowOptions] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const active = sources.find((s) => s.code === source);
  const isManual = source === "manual";

  const matches = (hotel: HotelOption, rate: HotelRateOption) => {
    if (filters.board && rate.board !== filters.board) return false;
    if (filters.refundable === "yes" && rate.refundable !== true) return false;
    if (filters.refundable === "no" && rate.refundable !== false) return false;
    if (filters.maxPrice && rate.per_night > Number(filters.maxPrice)) return false;
    if (filters.minStars && (hotel.stars ?? 0) < filters.minStars) return false;
    return true;
  };

  // Filters narrow the RATES, then any hotel left without one drops out — a
  // hotel is only in the list because of a rate the agent could actually pick.
  const visible = (results ?? [])
    .map((h) => ({ ...h, rates: h.rates.filter((r) => matches(h, r)) }))
    .filter((h) => h.rates.length > 0 || (h.rates.length === 0 && !filters.board && !filters.maxPrice))
    .filter((h) => !filters.minStars || (h.stars ?? 0) >= filters.minStars)
    .sort((a, b) => {
      if (filters.sort === "stars") return (b.stars ?? 0) - (a.stars ?? 0);
      const cheap = (h: HotelOption) => h.rates[0]?.per_night ?? Number.POSITIVE_INFINITY;
      return filters.sort === "price_desc" ? cheap(b) - cheap(a) : cheap(a) - cheap(b);
    });

  return (
    <div className="rounded-[11px] border border-[#d6eadf] bg-white p-3">
      {/* WHERE the hotel comes from — the first and only question at this point */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-extrabold text-[#93aaa3]">المصدر</span>
        <div className="inline-flex flex-wrap overflow-hidden rounded-[9px] border border-[#cfe0d9]">
          {sources.map((s) => (
            <button
              key={s.code}
              type="button"
              disabled={!s.enabled}
              title={s.enabled ? undefined : s.reason}
              onClick={() => onSource(s.code)}
              className={`h-8 border-s border-[#cfe0d9] px-3 text-[11.5px] font-bold transition-colors first:border-s-0 disabled:cursor-not-allowed disabled:opacity-45 ${
                s.code === source ? "bg-[#185045] text-white" : "bg-white text-[#557d78] hover:bg-[#f0f7f4]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {active && !active.enabled && active.reason ? (
          <span className="text-[11px] font-bold text-[#a86a10]">{active.reason}</span>
        ) : null}
      </div>

      {isManual ? (
        manual
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShown(PAGE);
              onSearch();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="grid flex-1 gap-1 text-[11.5px] font-bold text-[#185045]">
              اسم الفندق (اختياري)
              <input
                value={filters.name}
                onChange={(e) => onFilters({ ...filters, name: e.target.value })}
                placeholder="اتركه فارغاً لعرض كل المتاح"
                className={`${fieldClass} h-9`}
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12px] font-bold text-white hover:bg-[#0f4439]"
            >
              <Search className="size-3.5" />
              بحث
            </button>
            {/* Everything else is behind one word, because the common search
                needs none of it. */}
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[11.5px] font-bold transition-colors ${
                showOptions ? "border-[#185045] bg-[#f0f7f4] text-[#185045]" : "border-[#dbe6e1] text-[#557d78]"
              }`}
            >
              <SlidersHorizontal className="size-3.5" />
              خيارات
            </button>
          </form>

          {/* what stage 1 already decided — shown, never asked again */}
          <p className="tv-tnum mt-1.5 text-[11px] font-bold text-[#93aaa3]">{occupancy}</p>

          {showOptions ? (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[9px] bg-[#f8fbf9] p-2 text-[11.5px] font-bold text-[#185045]">
              <label className="grid gap-1">
                {t("pg.supplier.stars")}
                <select
                  value={filters.minStars}
                  onChange={(e) => onFilters({ ...filters, minStars: Number(e.target.value) })}
                  className={`${fieldClass} h-8`}
                >
                  <option value={0}>{t("pg.supplier.any")}</option>
                  {[3, 4, 5].map((s) => (
                    <option key={s} value={s}>{s}+</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                {t("pg.board")}
                <select
                  value={filters.board}
                  onChange={(e) => onFilters({ ...filters, board: e.target.value })}
                  className={`${fieldClass} h-8`}
                >
                  <option value="">{t("pg.supplier.allBoards")}</option>
                  {BOARD_TYPES.map((b) => (
                    <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                الاسترداد
                <select
                  value={filters.refundable}
                  onChange={(e) => onFilters({ ...filters, refundable: e.target.value as PickerFilters["refundable"] })}
                  className={`${fieldClass} h-8`}
                >
                  <option value="all">الكل</option>
                  <option value="yes">قابل للاسترداد</option>
                  <option value="no">غير قابل للاسترداد</option>
                </select>
              </label>
              <label className="grid gap-1">
                أعلى سعر لليلة
                <input
                  type="number"
                  dir="ltr"
                  value={filters.maxPrice}
                  onChange={(e) => onFilters({ ...filters, maxPrice: e.target.value })}
                  className={`${fieldClass} tv-tnum h-8 w-24 text-center`}
                />
              </label>
              <label className="grid gap-1">
                الترتيب
                <select
                  value={filters.sort}
                  onChange={(e) => onFilters({ ...filters, sort: e.target.value as PickerFilters["sort"] })}
                  className={`${fieldClass} h-8`}
                >
                  <option value="price">الأرخص</option>
                  <option value="price_desc">الأغلى</option>
                  <option value="stars">النجوم</option>
                </select>
              </label>
            </div>
          ) : null}

          <div className="mt-2.5">
            {searching ? (
              <p className="flex items-center gap-2 py-4 text-[12.5px] font-bold text-[#557d78]">
                <Loader2 className="size-4 animate-spin" />
                {t("pg.supplier.searching")}
              </p>
            ) : error ? (
              <p className="py-2 text-[12.5px] font-bold text-[#c22850]">{error}</p>
            ) : results === null ? (
              <p className="py-3 text-center text-[12px] font-bold text-[#93aaa3]">
                اضغط «بحث» لعرض الفنادق المتاحة لهذه الليالي.
              </p>
            ) : visible.length > 0 ? (
              <div className="space-y-1.5">
                <p className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
                  <DirText dir="ltr">{visible.length}</DirText> فندق
                </p>
                {visible.slice(0, shown).map((hotel) => (
                  <HotelResultRow key={`${hotel.source}-${hotel.id}`} hotel={hotel} busyKey={busyKey} onSelect={onSelect} />
                ))}
                {visible.length > shown ? (
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE)}
                    className="tv-tnum w-full rounded-[9px] border border-[#cfe0d9] py-2 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                  >
                    عرض المزيد ({visible.length - shown})
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="py-2 text-[12.5px] text-[#93aaa3]">
                <p>{t("pg.supplier.noResults")}</p>
                {/* An empty list looked identical whether the supplier refused
                    us, could not be reached, or the city is genuinely full. */}
                {notes.map((n) => (
                  <div key={n.supplier} className="mt-1.5 text-[11.5px] font-bold">
                    {n.reason === "no_country" ? (
                      <span className="text-[#c22850]">{n.name}: الدولة بلا رمز ISO — أضِفه في قسم الدول.</span>
                    ) : n.reason === "credentials" ? (
                      <span className="text-[#c22850]">
                        {n.name}: {n.detail}
                        {/* The one failure with a fix the agent can act on, so
                            it carries the way there instead of a dead end. */}
                        <a href="/settings/suppliers" className="ms-1 underline">
                          افتح إعدادات المزوّدين
                        </a>
                      </span>
                    ) : n.reason === "error" || n.reason === "supplier_error" ? (
                      <span className="text-[#c22850]">
                        {n.name}: {n.detail ?? "تعذّر الوصول إلى المورّد."}
                      </span>
                    ) : n.reason === "nothing" ? (
                      <span className="text-[#a86a10]">{n.name}: لا غرف لهذه المدينة والتواريخ.</span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
