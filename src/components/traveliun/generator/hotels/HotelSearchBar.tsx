"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Loader2, MapPin, Minus, Plus, Search, UsersRound } from "lucide-react";
import { SuggestInput } from "../../SuggestInput";

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
const cellLabel = "block text-[9.5px] font-bold text-tv-text-faint whitespace-nowrap";
const cellInput =
  "h-6 w-full min-w-0 border-0 bg-transparent p-0 text-[12px] font-bold text-[#123e3a] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus placeholder:text-[#9bb0ac]";

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
    // @container: the bar lays itself out by the width IT is given (the hotels
    // popup), not the screen's — on a wide screen it used to insist on a
    // six-column row ~940px wide inside a much narrower popup and spill out.
    <section className="@container rounded-[24px] border border-[#0e5b52]/12 bg-white/95 p-4 shadow-[0_24px_70px_rgba(14,77,68,0.10)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        className="relative grid items-stretch gap-2 rounded-[19px] border border-[#d5e5df] bg-white p-2 shadow-[0_8px_30px_rgba(15,79,71,0.055)] grid-cols-1"
      >
        {/* the hotel's name — the one thing the agent types here */}
        <label className={`${cell} rounded-[13px] border border-[#e0ebe7]`}>
          <MapPin className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>اسم الفندق</span>
            <SuggestInput
              ariaLabel="اسم الفندق"
              items={hotelNames.map((value) => ({ value }))}
              value={nameFilter}
              onChange={(v) => onNameFilter(v)}
              placeholder={cityName || "إلى أين؟"}
              className={cellInput}
            />
          </span>
        </label>

        {/* the stay's dates and its nights, side by side: moving one moves the others */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 @max-[459px]:grid-cols-1">
        {/* check-in — derived, and not movable on its own */}
        <label
          className={`${cell} rounded-[13px] border border-[#e0ebe7]`}
          title="تاريخ الدخول يأتي من ترتيب المدن في البرنامج"
        >
          <CalendarDays className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>تاريخ الدخول</span>
            <input type="date" dir="ltr" value={checkIn ?? ""} readOnly className={`${cellInput} text-start`} />
          </span>
        </label>

        {/* nights — the stepper the agent reaches for; check-out follows */}
        <div className="flex min-h-[70px] flex-col items-center justify-center gap-1 rounded-[13px] border border-[#e0ebe7] px-3">
          <span className={cellLabel}>الليالي</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNights(Math.max(1, nights - 1))}
              disabled={nights <= 1}
              aria-label="تقليل الليالي"
              className="grid size-7 place-items-center rounded-[8px] border border-[#c9dcd6] text-[#0e5b52] disabled:opacity-40"
            >
              <Minus className="size-3.5" />
            </button>
            <b className="tv-tnum w-6 text-center text-[14px] font-extrabold text-[#123e3a]">{nights}</b>
            <button
              type="button"
              onClick={() => onNights(nights + 1)}
              aria-label="زيادة الليالي"
              className="grid size-7 place-items-center rounded-[8px] border border-[#c9dcd6] text-[#0e5b52] max-sm:min-h-10 max-sm:min-w-10"
            >
              <Plus className="size-3.5" />
            </button>
          </span>
        </div>

        {/* check-out — editable, and it writes the stay's nights */}
        <label className={`${cell} rounded-[13px] border border-[#e0ebe7]`}>
          <CalendarDays className="size-[19px] shrink-0 text-[#0e5b52]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cellLabel}>تاريخ الخروج</span>
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

        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        {/* guests + rooms */}
        <div
          ref={guestRef}
          className={`${cell} rounded-[13px] border border-[#e0ebe7] ${
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
            <div className="absolute end-0 top-[calc(100%+13px)] z-20 w-[min(330px,calc(84vw/var(--tv-zoom)))] rounded-[17px] border border-[#d5e5df] bg-white px-4 pb-4 pt-2 shadow-[0_22px_60px_rgba(11,66,59,0.18)]">
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
              <p className="mt-2 text-[9.5px] font-semibold text-tv-text-faint">
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

        <button
          type="submit"
          disabled={searching}
          aria-label="البحث عن الفنادق"
          className="flex min-w-[140px] items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(145deg,#176e63,#0b5048)] px-5 text-white shadow-[0_10px_20px_rgba(14,91,82,0.23)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {searching ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-[21px]" />}
          <span className="text-[12.5px] font-extrabold">ابحث الآن</span>
        </button>
        </div>
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
        <small className="whitespace-nowrap text-[9px] text-tv-text-faint">{hint}</small>
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
