"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, ChevronDown, Loader2, MapPin, Minus, Plus, Search, UsersRound } from "lucide-react";
import type { PickerSource } from "./HotelPicker";

/**
 * The hotel search bar — one row, six cells, the way every booking engine does it.
 *
 * Everything in it is already known: the city and the dates come from the
 * itinerary, the party from the customer stage. So it opens filled in and says
 * so, and the agent's job is to press search, not to re-enter a trip they
 * already entered.
 *
 * The two cells that write BACK are deliberate:
 *   check-out → this stay's nights, because moving a check-out IS changing how
 *               many nights this hotel covers, and the itinerary must stay the
 *               one truth rather than gaining a second, private copy here.
 *   guests    → the trip. Correcting the party size in front of a price should
 *               correct it everywhere, not just for this one search.
 * Check-in is not editable: a stay starts where the previous one ended.
 */

export type SearchBarGuests = { adults: number; children: number; rooms: number };

const cell =
  "relative flex min-h-[70px] min-w-0 items-center gap-2.5 border-e border-[#e0ebe7] px-4 py-2.5 transition-colors last:border-e-0 focus-within:rounded-[13px] focus-within:bg-[#f7fbf9]";
const cellLabel = "block text-[9.5px] font-bold text-[#78948f] whitespace-nowrap";
const cellInput =
  "h-6 w-full min-w-0 border-0 bg-transparent p-0 text-[12px] font-bold text-[#123e3a] outline-none placeholder:text-[#9bb0ac]";

export function HotelSearchBar({
  cityName,
  nameFilter,
  onNameFilter,
  checkIn,
  checkOut,
  nights,
  onNights,
  guests,
  onGuests,
  sources,
  source,
  onSource,
  searching,
  onSearch,
  hotelNames,
}: {
  cityName: string;
  nameFilter: string;
  onNameFilter: (v: string) => void;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
  onNights: (n: number) => void;
  guests: SearchBarGuests;
  onGuests: (g: SearchBarGuests) => void;
  sources: PickerSource[];
  source: string;
  onSource: (code: string) => void;
  searching: boolean;
  onSearch: () => void;
  /** hotels we already know in this city, for the datalist. */
  hotelNames: string[];
}) {
  const [openGuests, setOpenGuests] = useState(false);
  const guestRef = useRef<HTMLDivElement>(null);

  // A menu that stays open after you have looked away is a menu covering the
  // results you opened it to reach.
  useEffect(() => {
    if (!openGuests) return;
    const onDown = (e: MouseEvent) => {
      if (guestRef.current && !guestRef.current.contains(e.target as Node)) setOpenGuests(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openGuests]);

  const guestSummary = [
    `${guests.adults} ${guests.adults === 1 ? "بالغ" : "بالغين"}`,
    guests.children > 0 ? `${guests.children} ${guests.children === 1 ? "طفل" : "أطفال"}` : null,
    `${guests.rooms} ${guests.rooms === 1 ? "غرفة" : "غرف"}`,
  ]
    .filter(Boolean)
    .join("، ");

  /** check-out moved → this stay covers that many nights. */
  function setCheckOut(value: string) {
    if (!checkIn || !value) return;
    const from = Date.parse(`${checkIn}T12:00:00`);
    const to = Date.parse(`${value}T12:00:00`);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    const diff = Math.round((to - from) / 86_400_000);
    if (diff > 0) onNights(diff);
  }

  return (
    <section className="rounded-[24px] border border-[#0e5b52]/12 bg-white/95 p-5 shadow-[0_24px_70px_rgba(14,77,68,0.10)]">
      <div className="flex flex-wrap items-center justify-between gap-4 px-1 pb-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#e9f4f0] text-[#0e5b52]">
            <MapPin className="size-5" />
          </span>
          <span className="flex flex-col gap-0.5">
            <small className="text-[10px] font-semibold text-[#78948f]">المدينة المختارة</small>
            <strong className="text-[16px] font-extrabold text-[#123e3a]">{cityName || "—"}</strong>
          </span>
        </div>
        <p className="hidden text-[11px] font-semibold text-[#89a09c] sm:block">
          البيانات الحالية مسحوبة تلقائياً من الإدخال الأولي
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        className="relative grid items-stretch gap-2 rounded-[19px] border border-[#d5e5df] bg-white p-2 shadow-[0_8px_30px_rgba(15,79,71,0.055)] max-[1130px]:grid-cols-2 min-[1131px]:gap-0 min-[1131px]:[grid-template-columns:minmax(180px,1.35fr)_repeat(2,minmax(150px,1fr))_minmax(200px,1.25fr)_minmax(175px,1.05fr)_68px] max-[650px]:grid-cols-1"
      >
        {/* city / hotel name */}
        <label className={`${cell} max-[1130px]:rounded-[13px] max-[1130px]:border max-[1130px]:border-[#e0ebe7]`}>
          <MapPin className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>المدينة أو الفندق</span>
            <input
              value={nameFilter}
              onChange={(e) => onNameFilter(e.target.value)}
              list="hotel-bar-names"
              placeholder={cityName || "إلى أين؟"}
              className={cellInput}
            />
            <datalist id="hotel-bar-names">
              {hotelNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </span>
        </label>

        {/* check-in — derived, and not movable on its own */}
        <label
          className={`${cell} max-[1130px]:rounded-[13px] max-[1130px]:border max-[1130px]:border-[#e0ebe7]`}
          title="تاريخ الدخول يأتي من ترتيب المدن في البرنامج"
        >
          <CalendarDays className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>تاريخ الدخول</span>
            <input type="date" dir="ltr" value={checkIn ?? ""} readOnly className={`${cellInput} text-start`} />
          </span>
        </label>

        {/* check-out — editable, and it writes the stay's nights */}
        <label className={`${cell} max-[1130px]:rounded-[13px] max-[1130px]:border max-[1130px]:border-[#e0ebe7]`}>
          <CalendarDays className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>
              تاريخ الخروج <span className="text-[#a9bdb9]">· {nights} ليلة</span>
            </span>
            <input
              type="date"
              dir="ltr"
              value={checkOut ?? ""}
              min={checkIn ?? undefined}
              onChange={(e) => setCheckOut(e.target.value)}
              className={`${cellInput} text-start`}
            />
          </span>
        </label>

        {/* guests + rooms */}
        <div
          ref={guestRef}
          className={`${cell} max-[1130px]:rounded-[13px] max-[1130px]:border max-[1130px]:border-[#e0ebe7] ${
            openGuests ? "z-[4] rounded-[13px] bg-[#f7fbf9]" : ""
          }`}
        >
          <UsersRound className="size-[19px] shrink-0 text-[#0e5b52]" />
          <button
            type="button"
            onClick={() => setOpenGuests((v) => !v)}
            aria-expanded={openGuests}
            className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-start"
          >
            <span className={cellLabel}>الأشخاص والغرف</span>
            <span className="truncate text-[11.5px] font-bold text-[#123e3a]">{guestSummary}</span>
          </button>
          <ChevronDown className={`size-4 shrink-0 text-[#0e5b52] transition-transform ${openGuests ? "rotate-180" : ""}`} />

          {openGuests ? (
            <div className="absolute end-0 top-[calc(100%+13px)] z-20 w-[min(330px,84vw)] rounded-[17px] border border-[#d5e5df] bg-white px-4 pb-4 pt-2 shadow-[0_22px_60px_rgba(11,66,59,0.18)]">
              <Counter
                title="البالغون"
                hint="العمر 13 سنة أو أكثر"
                value={guests.adults}
                min={1}
                max={16}
                onChange={(adults) => onGuests({ ...guests, adults })}
              />
              <Counter
                title="الأطفال"
                hint="حتى عمر 12 سنة"
                value={guests.children}
                min={0}
                max={10}
                onChange={(children) => onGuests({ ...guests, children })}
              />
              <Counter
                title="الغرف"
                hint="عدد الغرف المطلوبة"
                value={guests.rooms}
                min={1}
                max={10}
                onChange={(rooms) => onGuests({ ...guests, rooms })}
              />
              <p className="mt-2 text-[9.5px] font-semibold text-[#8ba19d]">
                تعديل الأشخاص هنا يحدّث بيانات الرحلة، والغرف تخصّ هذا الفندق.
              </p>
              <button
                type="button"
                onClick={() => setOpenGuests(false)}
                className="mt-3 w-full rounded-[10px] bg-[#0e5b52] py-2 text-[11px] font-extrabold text-white"
              >
                تم
              </button>
            </div>
          ) : null}
        </div>

        {/* which system to search */}
        <label className={`${cell} max-[1130px]:rounded-[13px] max-[1130px]:border max-[1130px]:border-[#e0ebe7]`}>
          <Building2 className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>نظام الحجز</span>
            <select
              value={source}
              onChange={(e) => onSource(e.target.value)}
              className={`${cellInput} cursor-pointer appearance-none pe-4`}
            >
              {sources.map((s) => (
                <option key={s.code} value={s.code} disabled={!s.enabled}>
                  {s.label}
                  {s.enabled ? "" : " — غير متاح"}
                </option>
              ))}
            </select>
          </span>
          <ChevronDown className="pointer-events-none absolute bottom-5 end-3.5 size-4 text-[#0e5b52]" />
        </label>

        <button
          type="submit"
          disabled={searching}
          aria-label="البحث عن الفنادق"
          className="flex min-w-0 items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(145deg,#176e63,#0b5048)] text-white shadow-[0_10px_20px_rgba(14,91,82,0.23)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 max-[1130px]:col-span-full max-[1130px]:min-h-[52px]"
        >
          {searching ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-[23px]" />}
          <span className="text-[12px] font-extrabold min-[1131px]:hidden">ابحث الآن</span>
        </button>
      </form>
    </section>
  );
}

function Counter({
  title,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  title: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex min-h-[62px] items-center justify-between gap-5 border-b border-[#edf3f1]">
      <span className="flex flex-col gap-0.5">
        <strong className="text-[12px] font-bold text-[#123e3a]">{title}</strong>
        <small className="whitespace-nowrap text-[9px] text-[#8ba19d]">{hint}</small>
      </span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`تقليل ${title}`}
          className="grid size-[30px] place-items-center rounded-[9px] border border-[#c9dcd6] bg-white text-[#0e5b52] disabled:opacity-40"
        >
          <Minus className="size-4" />
        </button>
        <b className="w-4 text-center text-[12px] font-bold text-[#123e3a]">{value}</b>
        <button
          type="button"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`زيادة ${title}`}
          className="grid size-[30px] place-items-center rounded-[9px] border border-[#c9dcd6] bg-white text-[#0e5b52] disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </span>
    </div>
  );
}
