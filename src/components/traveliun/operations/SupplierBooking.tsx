"use client";

import { useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronDown, RefreshCw, Search, XCircle } from "lucide-react";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import {
  bookHotel,
  cancelSupplierBooking,
  prebookHotel,
  refreshSupplierBooking,
  searchBookingRooms,
  type BookingRoomOption,
  type PriceCheck,
} from "@/lib/data/supplier-booking";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

/**
 * Booking a hotel through TBO, from the operations screen — the path the owner asked to see end to end
 * (2026-10-24): the file was sold on our own rooms at a typed price; here TBO's rooms for this booking's dates and
 * party are asked for, one is chosen, its FINAL price and terms are checked (and set against the typed one, in
 * riyals), the guests are written room by room, and it is booked.
 *
 * Deliberate frictions, each paying for itself:
 *
 * 1. **Search, check, then book — never one button.** TBO's price can move between the quote and the approval, and
 *    a single button would spend the difference silently. A check older than 25 minutes is asked again (TBO keeps a
 *    search's session 30).
 * 2. **Names are typed, room by room.** They are printed on the voucher and read against a passport at the desk.
 * 3. **A lost answer offers «تحقق من الحالة», never «أعد المحاولة».** After a timeout the reservation may exist.
 */

const field =
  "h-10 w-full rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]";
const btn =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] font-bold transition-colors disabled:opacity-60";

type Guest = { title: "Mr" | "Mrs" | "Ms"; first_name: string; last_name: string; type: "Adult" | "Child" };

const WHY: Record<string, string> = {
  not_linked: "هذا الفندق غير مربوط بـTBO — يُحجز يدوياً ويُكتب رقم تأكيده.",
  no_dates: "لا تواريخ لهذا الحجز — أكملها أولاً.",
  not_enabled: "TBO لم يفعّل البحث عن الأسعار لحسابنا بعد (خطأ 500 من جهتهم). احجز الآن من بوابة TBO واكتب رقم التأكيد في الأعلى — يصدر الفاوتشر تلقائياً.",
  none: "لا غرف متاحة عند TBO لهذه التواريخ والأشخاص.",
  unreachable: "تعذّر الوصول إلى TBO الآن، أو أنه موقوف في إعدادات المورّدين — جرّب بعد قليل.",
  done: "هذا الحجز مؤكَّد أو قيد الحجز.",
};

const money = (n: number | null | undefined, c: string) => (n == null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`);

/** the party shared out room by room, like the search asked (tboPaxRooms) */
function blankRooms(rooms: number, adults: number, children: number): Guest[][] {
  const share = (total: number, i: number) => Math.floor(total / rooms) + (i < total % rooms ? 1 : 0);
  return Array.from({ length: rooms }, (_, i) => [
    ...Array.from({ length: Math.max(1, share(adults, i)) }, (): Guest => ({ title: "Mr", first_name: "", last_name: "", type: "Adult" })),
    ...Array.from({ length: share(children, i) }, (): Guest => ({ title: "Mr", first_name: "", last_name: "", type: "Child" })),
  ]);
}

export function SupplierBooking({
  booking,
  canBook,
  onDone,
}: {
  booking: OperationBooking;
  canBook: boolean;
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const [pending, startTransition] = useSafeTransition();
  const [options, setOptions] = useState<BookingRoomOption[] | null>(null);
  const [typed, setTyped] = useState<{ amount: number | null; currency: string; sar: number | null } | null>(null);
  const [party, setParty] = useState<{ rooms: number; adults: number; children: number } | null>(null);
  const [canCheck, setCanCheck] = useState(false);
  const [price, setPrice] = useState<PriceCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [contact, setContact] = useState({ email: "", phone: "" });
  const [rooms, setRooms] = useState<Guest[][]>([]);
  const [terms, setTerms] = useState(false);

  if (booking.kind !== "hotel") return null;

  const inFlight = booking.status === "in_flight";
  const confirmed = booking.status === "confirmed";
  const dearer = price?.difference != null && price.difference > 0;

  // an error is a key — said in words, never printed as «ops.err.…»
  const say = (res: { ok: boolean; error?: TranslationKey; message?: string }) =>
    setMessage("message" in res && res.message ? res.message : "error" in res && res.error ? t(res.error) : null);

  const search = () =>
    startTransition(async () => {
      setMessage(null);
      setUnknown(null);
      setPrice(null);
      setOptions(null);
      const res = await searchBookingRooms(booking.id);
      if (!res.ok) {
        if ("why" in res) setMessage(WHY[res.why] ?? null);
        else say(res);
        return;
      }
      setOptions(res.options);
      setTyped(res.typed);
      setParty(res.party);
      setCanCheck(res.can_check);
    });

  const check = (option: BookingRoomOption) =>
    startTransition(async () => {
      setMessage(null);
      const res = await prebookHotel(booking.id, option.rate_key, option.token);
      if (res.ok) {
        setPrice(res);
        const count = Math.max(res.rooms.length, party?.rooms ?? 1);
        const next = blankRooms(count, party?.adults ?? count, party?.children ?? 0);
        // names already typed stay, when the rooms are the same as before
        setRooms((prev) => (prev.length === next.length && prev.every((r, i) => r.length === next[i].length) ? prev : next));
      } else {
        setPrice(null);
        say(res);
      }
      onDone();
    });

  const setGuest = (r: number, g: number, slice: Partial<Guest>) =>
    setRooms((list) => list.map((room, i) => (i === r ? room.map((x, j) => (j === g ? { ...x, ...slice } : x)) : room)));

  return (
    <div className="mt-2 rounded-[10px] border border-[#cfdcf5] bg-[#f6f9ff] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] font-extrabold text-[#2b5bb5]">الحجز عبر TBO</span>

        {!confirmed && !inFlight ? (
          <button type="button" disabled={pending} onClick={search} className={`${btn} border-[#b7c9ee] bg-white text-[#2b5bb5] hover:bg-[#eef4ff]`}>
            <Search className="size-3.5" />
            {options ? "ابحث من جديد" : "ابحث عن غرف TBO"}
          </button>
        ) : null}

        {/* Shown whenever there is anything to ask about — an in-flight attempt
            OR a confirmed booking whose hotel reference may have arrived since. */}
        {inFlight || booking.confirmation_number ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setMessage(null);
                const res = await refreshSupplierBooking(booking.id);
                if (res.ok) {
                  setUnknown(null);
                  setMessage(`الحالة لدى المورّد: ${res.status}` + (res.hotel_confirmation_number ? ` — رقم الفندق ${res.hotel_confirmation_number}` : ""));
                } else say(res);
                onDone();
              })
            }
            className={`${btn} border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]`}
          >
            <RefreshCw className="size-3.5" />
            تحقق من الحالة
          </button>
        ) : null}

        {canBook && booking.confirmation_number && booking.status !== "cancelled" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (!window.confirm("إلغاء الحجز لدى TBO؟ قد تُطبَّق رسوم الإلغاء.")) return;
                setMessage(null);
                const res = await cancelSupplierBooking(booking.id);
                say(res);
                onDone();
              })
            }
            className={`${btn} border-[#f2c7c7] bg-white text-[#c43d3d] hover:bg-[#fff1f1]`}
          >
            <XCircle className="size-3.5" />
            ألغِ لدى المورّد
          </button>
        ) : null}
      </div>

      {/* An unresolved attempt outranks everything else on this row. */}
      {inFlight ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-[8px] bg-[#fff8e8] p-2 text-[11.5px] font-bold text-[#a86a10]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            محاولة حجز لم تُحسم. قد يكون الحجز تمّ لدى المورّد — اضغط «تحقق من الحالة» بعد دقيقتين، ولا تعِد الحجز.
            {unknown ? <span className="block font-semibold">{unknown}</span> : null}
          </span>
        </p>
      ) : null}

      {message ? <p className="mt-2 text-[11.5px] font-bold text-[#557d78]">{message}</p> : null}

      {/* 1. TBO's rooms for this booking, beside what the file was sold on */}
      {options && !price && !confirmed ? (
        <div className="mt-2 grid gap-1.5">
          {typed ? (
            <p className="text-[11.5px] font-bold text-[#557d78]">
              السعر المكتوب في الملف: <DirText dir="ltr" className="tv-tnum">{money(typed.amount, typed.currency)}</DirText>
              {typed.sar != null && typed.currency !== "SAR" ? <DirText dir="ltr" className="tv-tnum">{` ≈ ${money(typed.sar, "SAR")}`}</DirText> : null}
            </p>
          ) : null}
          {party ? <p className="text-[11px] font-semibold text-[#93aaa3]">{`${party.rooms} غرف · ${party.adults} بالغ · ${party.children} طفل`}</p> : null}
          {!canCheck ? (
            <p className="text-[11.5px] font-bold text-[#a86a10]">التحقق من السعر والحجز لمن يملك صلاحية «الحجز من المورّد» — أو احجز يدوياً واكتب رقم التأكيد في الأعلى.</p>
          ) : null}
          <ul className="grid gap-1">
            {options.map((o) => (
              <li key={o.rate_key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[8px] bg-white px-2.5 py-2 text-[12px]">
                <DirText dir="ltr" className="font-bold text-[#0f3d38]">{o.name}</DirText>
                <span className="text-[#557d78]">{o.board}</span>
                <span className={o.refundable ? "text-[#0f7a52]" : "text-[#c22850]"}>{o.policy}</span>
                {o.total != null ? (
                  <DirText dir="ltr" className="tv-tnum ms-auto font-extrabold text-[#185045]">
                    {money(o.total, o.currency)}
                    {o.total_sar != null && o.currency !== "SAR" ? ` ≈ ${money(o.total_sar, "SAR")}` : ""}
                  </DirText>
                ) : (
                  <span className="ms-auto" />
                )}
                {canCheck ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => check(o)}
                    className={`${btn} border-transparent bg-[#2b5bb5] text-white hover:bg-[#244c97]`}
                  >
                    اختر وتحقق من السعر
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 2. the final price and terms, then the guests room by room, then «احجز» */}
      {price && !confirmed ? (
        <div className="mt-2 grid gap-2">
          <div className="rounded-[8px] border border-[#dbe6e1] bg-white p-2.5">
            <p className="tv-tnum text-[12.5px] font-extrabold text-[#0f3d38]">
              <DirText dir="ltr">{price.room_name}</DirText> — <DirText dir="ltr">{money(price.total, price.currency)}</DirText>
              {price.total_sar != null && price.currency !== "SAR" ? <DirText dir="ltr">{` ≈ ${money(price.total_sar, "SAR")}`}</DirText> : null}
            </p>
            <p className="mt-0.5 text-[11.5px] font-bold text-[#557d78]">{price.cancellation_policy}</p>
            {price.previous != null ? (
              <p className="mt-0.5 text-[11.5px] font-semibold text-[#557d78]">
                المكتوب في الملف: <DirText dir="ltr" className="tv-tnum">{money(price.previous, price.previous_currency)}</DirText>
              </p>
            ) : null}
            {price.difference != null && price.difference !== 0 ? (
              <p className={`mt-1 text-[11.5px] font-extrabold ${dearer ? "text-[#c43d3d]" : "text-[#0f7a52]"}`}>
                {dearer ? "سعر TBO أعلى" : "سعر TBO أقل"} من المكتوب بمقدار <DirText dir="ltr" className="tv-tnum">{money(Math.abs(price.difference), "SAR")}</DirText>
                {dearer ? " — راجع الربح قبل الاعتماد." : "."}
              </p>
            ) : null}
            {price.supplements.length ? (
              <div className="mt-1.5 text-[11.5px] font-bold text-[#7a5a12]">
                <p>إضافات (اعرضها على العميل):</p>
                <ul dir="ltr" className="list-disc ps-5 text-start font-semibold">
                  {price.supplements.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
            ) : null}
            {price.conditions.length ? (
              <div className="mt-1.5">
                <button type="button" onClick={() => setTerms((v) => !v)} aria-expanded={terms} className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#2b5bb5]">
                  شروط السعر ({price.conditions.length})
                  <ChevronDown className={`size-3.5 transition-transform ${terms ? "rotate-180" : ""}`} />
                </button>
                {terms ? (
                  <ul dir="ltr" className="mt-1 list-disc ps-5 text-start text-[11px] font-semibold text-[#557d78]">
                    {price.conditions.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          {canBook ? (
            <>
              <p className="text-[11px] font-bold text-[#93aaa3]">
                أسماء النزلاء بالحروف اللاتينية كما في الجواز، كل غرفة وحدها — هذا ما يُطبع على الفاوتشر.
              </p>
              {rooms.map((room, r) => (
                <fieldset key={r} className="grid gap-1.5 rounded-[8px] border border-[#e2ebe7] bg-white p-2">
                  <legend className="px-1 text-[11.5px] font-extrabold text-[#185045]">
                    {`الغرفة ${r + 1}`}
                    {price.rooms[r] ? <DirText dir="ltr" className="ms-1 font-semibold text-[#557d78]">{price.rooms[r]}</DirText> : null}
                  </legend>
                  {room.map((g, i) => (
                    <div key={i} className="grid gap-1.5 sm:grid-cols-[90px_1fr_1fr_90px]">
                      <select value={g.title} onChange={(e) => setGuest(r, i, { title: e.target.value as Guest["title"] })} className={field} aria-label="Title">
                        <option value="Mr">Mr</option>
                        <option value="Mrs">Mrs</option>
                        <option value="Ms">Ms</option>
                      </select>
                      <input dir="ltr" placeholder="First name" value={g.first_name} onChange={(e) => setGuest(r, i, { first_name: e.target.value })} className={field} />
                      <input dir="ltr" placeholder="Last name" value={g.last_name} onChange={(e) => setGuest(r, i, { last_name: e.target.value })} className={field} />
                      <select value={g.type} onChange={(e) => setGuest(r, i, { type: e.target.value as Guest["type"] })} className={field} aria-label="Type">
                        <option value="Adult">بالغ</option>
                        <option value="Child">طفل</option>
                      </select>
                    </div>
                  ))}
                </fieldset>
              ))}

              <div className="grid gap-1.5 sm:grid-cols-2">
                <input dir="ltr" type="email" placeholder="Email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} className={field} />
                <input dir="ltr" placeholder="Phone (966…)" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} className={field} />
              </div>

              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setMessage(null);
                    const res = await bookHotel({
                      booking_id: booking.id,
                      // The figure on screen, not the one in the row: booking is
                      // authorising THIS number, and the check is server-side too.
                      approved_total: price.total,
                      rooms,
                      email: contact.email,
                      phone: contact.phone,
                      // only the check this screen showed
                      checked_at: price.checked_at,
                    });
                    if (res.ok) {
                      setMessage(`تم الحجز — رقم التأكيد ${res.confirmation_number}`);
                      setPrice(null);
                      setOptions(null);
                    } else if ("unknown" in res) {
                      setUnknown(`${res.message} (مرجعنا ${res.booking_reference})`);
                    } else say(res);
                    onDone();
                  })
                }
                className={`${btn} justify-self-start border-transparent bg-[#185045] px-3 text-white hover:bg-[#123c34]`}
              >
                <BadgeCheck className="size-3.5" />
                {dearer ? "اعتمد سعر TBO واحجز" : "احجز من TBO"}
              </button>
            </>
          ) : (
            <p className="text-[11.5px] font-bold text-[#a86a10]">التحقق من السعر متاح لك، أمّا الحجز فيحتاج صلاحية «الحجز من المورّد».</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
