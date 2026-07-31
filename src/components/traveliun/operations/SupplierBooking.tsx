"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, BadgeCheck, RefreshCw, Search, XCircle } from "lucide-react";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import {
  bookHotel,
  cancelSupplierBooking,
  prebookHotel,
  refreshSupplierBooking,
  type PriceCheck,
} from "@/lib/data/supplier-booking";
import { DirText } from "@/components/DirText";

/**
 * Booking a hotel through the supplier's API, from the operations screen.
 *
 * Three deliberate frictions, each paying for itself:
 *
 * 1. **Two steps, never one.** «تحقق من السعر» then «احجز». The supplier's price
 *    can move between the quote and the approval, and a single button would spend
 *    the difference silently.
 * 2. **Names are typed, not derived.** They are printed on the voucher and read
 *    against a passport at the desk; one letter apart is a family turned away. The
 *    operator copies them from the passport and sees exactly what will be sent.
 * 3. **A lost answer offers «تحقق من الحالة», never «أعد المحاولة».** After a
 *    timeout the reservation may exist, and a retry button is how it gets made
 *    twice.
 */

const field =
  "h-10 w-full rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]";
const btn =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] font-bold transition-colors disabled:opacity-60";

type Guest = { title: "Mr" | "Mrs"; first_name: string; last_name: string; type: "Adult" | "Child" };

export function SupplierBooking({
  booking,
  canBook,
  onDone,
}: {
  booking: OperationBooking;
  canBook: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [price, setPrice] = useState<PriceCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState({ email: "", phone: "" });
  const [guests, setGuests] = useState<Guest[]>([{ title: "Mr", first_name: "", last_name: "", type: "Adult" }]);

  if (booking.kind !== "hotel") return null;

  const inFlight = booking.status === "in_flight";
  const dearer = price?.difference != null && price.difference > 0;

  const say = (res: { ok: boolean; error?: string; message?: string }) =>
    setMessage("message" in res && res.message ? res.message : "error" in res && res.error ? res.error : null);

  return (
    <div className="mt-2 rounded-[9px] border border-[#dbe6e1] bg-[#f8fbf9] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-extrabold text-[#557d78]">الحجز الآلي — TBO</span>

        <button
          type="button"
          disabled={pending || booking.status === "confirmed"}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              setUnknown(null);
              const res = await prebookHotel(booking.id);
              if (res.ok) {
                setPrice(res);
                setOpen(true);
              } else {
                setPrice(null);
                say(res);
              }
              onDone();
            })
          }
          className={`${btn} border-[#b7d0c7] text-[#185045] hover:bg-[#f0f7f4]`}
        >
          <Search className="size-3.5" />
          تحقق من السعر
        </button>

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
                  setMessage(
                    `الحالة لدى المورّد: ${res.status}` +
                      (res.hotel_confirmation_number ? ` — رقم الفندق ${res.hotel_confirmation_number}` : ""),
                  );
                } else say(res);
                onDone();
              })
            }
            className={`${btn} border-[#b7d0c7] text-[#185045] hover:bg-[#f0f7f4]`}
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
                setMessage(null);
                const res = await cancelSupplierBooking(booking.id);
                say(res);
                onDone();
              })
            }
            className={`${btn} border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1]`}
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
            محاولة حجز لم تُحسم. قد يكون الحجز تمّ لدى المورّد — اضغط «تحقق من الحالة»، ولا تعِد الحجز.
            {unknown ? <span className="block font-semibold">{unknown}</span> : null}
          </span>
        </p>
      ) : null}

      {message ? <p className="mt-2 text-[11.5px] font-bold text-[#557d78]">{message}</p> : null}

      {price && open && booking.status !== "confirmed" ? (
        <div className="mt-2 grid gap-2">
          <div className="rounded-[8px] border border-[#dbe6e1] bg-white p-2.5">
            <p className="tv-tnum text-[12px] font-extrabold text-[#0f3d38]">
              {price.room_name} — <DirText dir="ltr">{`${price.total.toFixed(2)} ${price.currency}`}</DirText>
            </p>
            <p className="mt-0.5 text-[11px] font-bold text-[#557d78]">{price.cancellation_policy}</p>
            {price.difference != null && price.difference !== 0 ? (
              <p
                className={`mt-1 text-[11.5px] font-extrabold ${dearer ? "text-[#c43d3d]" : "text-[#0f7a52]"}`}
              >
                {dearer ? "ارتفع" : "انخفض"} عن السعر السابق بمقدار{" "}
                <DirText dir="ltr">{`${Math.abs(price.difference).toFixed(2)} ${price.currency}`}</DirText>
                {dearer ? " — راجع الربح قبل الاعتماد." : "."}
              </p>
            ) : null}
          </div>

          {canBook ? (
            <>
              <p className="text-[11px] font-bold text-[#93aaa3]">
                أسماء النزلاء بالحروف اللاتينية كما في الجواز — هذا ما يُطبع على الفاوتشر.
              </p>
              {guests.map((g, i) => (
                <div key={i} className="grid gap-1.5 sm:grid-cols-4">
                  <select
                    value={g.title}
                    onChange={(e) =>
                      setGuests((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value as Guest["title"] } : x)))
                    }
                    className={field}
                  >
                    <option value="Mr">Mr</option>
                    <option value="Mrs">Mrs</option>
                  </select>
                  <input
                    dir="ltr"
                    placeholder="First name"
                    value={g.first_name}
                    onChange={(e) =>
                      setGuests((list) => list.map((x, j) => (j === i ? { ...x, first_name: e.target.value } : x)))
                    }
                    className={field}
                  />
                  <input
                    dir="ltr"
                    placeholder="Last name"
                    value={g.last_name}
                    onChange={(e) =>
                      setGuests((list) => list.map((x, j) => (j === i ? { ...x, last_name: e.target.value } : x)))
                    }
                    className={field}
                  />
                  <select
                    value={g.type}
                    onChange={(e) =>
                      setGuests((list) => list.map((x, j) => (j === i ? { ...x, type: e.target.value as Guest["type"] } : x)))
                    }
                    className={field}
                  >
                    <option value="Adult">بالغ</option>
                    <option value="Child">طفل</option>
                  </select>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setGuests((l) => [...l, { title: "Mr", first_name: "", last_name: "", type: "Adult" }])}
                className="justify-self-start text-[11.5px] font-bold text-[#2aa87a]"
              >
                + نزيل آخر
              </button>

              <div className="grid gap-1.5 sm:grid-cols-2">
                <input
                  dir="ltr"
                  placeholder="Email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  className={field}
                />
                <input
                  dir="ltr"
                  placeholder="Phone"
                  value={contact.phone}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  className={field}
                />
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
                      guests,
                      email: contact.email,
                      phone: contact.phone,
                    });
                    if (res.ok) {
                      setMessage(`تم الحجز — رقم التأكيد ${res.confirmation_number}`);
                      setOpen(false);
                    } else if ("unknown" in res) {
                      setUnknown(`${res.message} (مرجعنا ${res.booking_reference})`);
                    } else say(res);
                    onDone();
                  })
                }
                className={`${btn} justify-self-start border-transparent bg-[#185045] px-3 text-white hover:bg-[#123c34]`}
              >
                <BadgeCheck className="size-3.5" />
                {dearer ? "اعتمد السعر الجديد واحجز" : "احجز من المورّد"}
              </button>
            </>
          ) : (
            <p className="text-[11.5px] font-bold text-[#a86a10]">
              التحقق من السعر متاح لك، أمّا الحجز فيحتاج صلاحية «الحجز من المورّد».
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
