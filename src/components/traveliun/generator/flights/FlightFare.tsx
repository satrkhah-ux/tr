"use client";

import { DirText } from "@/components/DirText";
import type { DraftTrip, FlightBooking, FlightFare as Fare } from "@/lib/offer/draft-types";
import { flightBookingTotal, withFare, type FlightKind } from "@/lib/offer/flight-fare";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * «إجمالي / للفرد» beside a flight booking's price — on the generator's flights
 * card and on Basic's. «للفرد» asks a ticket per adult, per child (only when the
 * trip has children) and per infant (only with infants), and shows the total it
 * comes to as it is typed; the booking's own price box shows that total too.
 */
export function FlightFare({
  booking,
  kind,
  trip,
  field,
  onChange,
}: {
  booking: FlightBooking;
  kind: FlightKind;
  trip: Pick<DraftTrip, "adults" | "children" | "infants">;
  /** the screen's own input style */
  field: string;
  onChange: (booking: FlightBooking) => void;
}) {
  const { t } = useTraveliunUI();
  const fare = kind === "intl" ? booking.intl_fare : booking.dom_fare;
  const total = flightBookingTotal(booking, trip, kind);
  const currency = (kind === "intl" ? booking.intl_currency : booking.dom_currency) || "SAR";
  const set = (change: Partial<Fare>) => onChange(withFare(booking, trip, kind, change));

  const ticket = (label: string, value: number | null, placeholder: string, onValue: (v: number | null) => void) => (
    <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#185045]">
      {label}
      <input
        type="number"
        min={0}
        dir="ltr"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onValue(e.target.value === "" ? null : Number(e.target.value))}
        className={`${field} tv-tnum w-28 text-center`}
      />
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label={t("pg.fare.mode")} className="inline-flex rounded-[8px] border border-[#cfe0d9] bg-white p-0.5">
        {(["total", "per_person"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={fare.price_mode === mode}
            onClick={() => set({ price_mode: mode })}
            className={`h-7 rounded-[6px] px-3 text-[11.5px] font-bold ${fare.price_mode === mode ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
          >
            {t(mode === "total" ? "pg.fare.total" : "pg.fare.perPerson")}
          </button>
        ))}
      </div>
      {fare.price_mode === "per_person" ? (
        <>
          {ticket(t("pg.fare.adult"), fare.adult_price, "0", (adult_price) => set({ adult_price }))}
          {/* a child flies at the adult's fare until told otherwise */}
          {trip.children > 0
            ? ticket(t("pg.fare.child"), fare.child_price, fare.adult_price != null ? String(fare.adult_price) : t("pg.fare.childSame"), (child_price) => set({ child_price }))
            : null}
          {trip.infants > 0 ? ticket(t("pg.fare.infant"), fare.infant_price, t("pg.fare.infantNone"), (infant_price) => set({ infant_price })) : null}
          <span aria-live="polite" className="text-[12px] font-extrabold text-[#0f3d38]">
            {t("pg.fare.sum")}{" "}
            <DirText className="tv-tnum">{total != null ? `${total.toLocaleString("en-US")} ${currency}` : "—"}</DirText>
          </span>
        </>
      ) : null}
    </div>
  );
}
