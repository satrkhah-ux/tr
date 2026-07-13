"use client";

import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  deriveCityDates,
  type DraftData,
  type StageKey,
} from "@/lib/offer/draft-types";
import { flightTiming, formatDurationAr, itineraryStartDate } from "@/lib/offer/schedule";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * The offer document — the SINGLE source of truth for what the client sees.
 * The live preview pane, the /preview stage and the printed PDF all render this
 * exact component, so "what you see is what prints".
 *
 * CLIENT VARIANT ONLY: it reads sell-side fields exclusively. Buy price /
 * profit / margin are not rendered anywhere in this tree — by design.
 *
 * When `onSectionClick` is provided each section becomes a jump-link to the
 * stage that owns it.
 */
function Section({
  stage,
  onSectionClick,
  children,
  className = "",
}: {
  stage: StageKey;
  onSectionClick?: (stage: StageKey) => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (!onSectionClick) return <div className={className}>{children}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSectionClick(stage)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSectionClick(stage);
      }}
      className={`cursor-pointer rounded-[10px] outline-none transition-shadow hover:ring-2 hover:ring-[#2aa87a]/50 focus-visible:ring-2 focus-visible:ring-[#2aa87a] ${className}`}
    >
      {children}
    </div>
  );
}

const th = "px-3 py-2 text-[11px] font-bold text-white";
const td = "px-3 py-2 text-[12px] text-[#0f3d38] border-b border-[#eef2f0]";

export function OfferDocument({
  data,
  serial,
  onSectionClick,
}: {
  data: DraftData;
  serial?: string | null;
  onSectionClick?: (stage: StageKey) => void;
}) {
  const { t } = useTraveliunUI();
  // hotel check-in dates follow the itinerary (outbound flight's local landing
  // date), not merely the trip start — same rule as the generator and produce.
  const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
  const hotelByCity = new Map(data.hotels.map((h) => [h.city_name, h]));

  return (
    <article className="mx-auto w-full max-w-[794px] overflow-hidden rounded-[14px] border border-[#dce7e2] bg-white text-[#0f3d38] shadow-[0_10px_30px_rgba(0,60,58,0.08)]">
      {/* brand header */}
      <Section onSectionClick={onSectionClick} stage="trip">
        <header className="flex items-center justify-between bg-[#185045] px-6 py-5 text-white">
          <div>
            <p className="text-[18px] font-extrabold">{t("brand")}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-[#bfe0d6]">{data.trip.destination || data.trip.country || "—"}</p>
          </div>
          <div className="text-end">
            <p className="tv-tnum text-[12px] font-bold">
              <DirText dir="ltr">{serial ?? data.produced_serial ?? "DRAFT"}</DirText>
            </p>
            {data.trip.arrival_date ? (
              <p className="tv-tnum mt-0.5 text-[11px] text-[#bfe0d6]">
                <DirText dir="ltr">{data.trip.arrival_date}</DirText>
              </p>
            ) : null}
          </div>
        </header>
      </Section>

      <div className="space-y-5 p-6">
        {/* customer + travelers */}
        <Section onSectionClick={onSectionClick} stage="customer">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-[#f4f8f6] px-4 py-3">
            <div>
              <p className="text-[11px] font-bold text-[#93aaa3]">{t("pg.customerName")}</p>
              <p className="text-[13px] font-extrabold text-[#185045]">{data.customer.customer_name || "—"}</p>
            </div>
            <div className="text-end">
              <p className="text-[11px] font-bold text-[#93aaa3]">{t("hub.travellers")}</p>
              <p className="tv-tnum text-[12.5px] font-bold">
                {t("pg.docTravelers", { adults: data.trip.adults, children: data.trip.children, infants: data.trip.infants })}
              </p>
            </div>
            <div className="text-end">
              <p className="text-[11px] font-bold text-[#93aaa3]">{t("col.duration")}</p>
              <p className="tv-tnum text-[12.5px] font-bold">
                <DirText dir="ltr">{`${data.trip.days} / ${data.trip.nights}`}</DirText>
              </p>
            </div>
          </div>
        </Section>

        {/* itinerary: cities + hotels */}
        <Section onSectionClick={onSectionClick} stage="hotels">
          <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{t("pg.docItinerary")}</h3>
          {cities.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-4 text-center text-[12px] text-[#93aaa3]">{t("pg.docNoContent")}</p>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-[#e2ebe7]">
              <table className="w-full border-collapse text-start">
                <thead>
                  <tr className="bg-[#185045]">
                    <th className={th}>{t("pg.city")}</th>
                    <th className={th}>{t("pg.hotel")}</th>
                    <th className={th}>{t("pg.roomType")}</th>
                    <th className={th}>{t("pg.board")}</th>
                    <th className={th}>{t("pg.cityNights")}</th>
                    <th className={th}>{t("pg.checkIn")}</th>
                    <th className={th}>{t("pg.checkOut")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cities.map((c, i) => {
                    const h = hotelByCity.get(c.city_name);
                    return (
                      <tr key={i} className="odd:bg-white even:bg-[#f8fbf9]">
                        <td className={`${td} font-bold`}>{c.city_name}</td>
                        <td className={td}>{h?.hotel_name || "—"}</td>
                        <td className={td}>{h?.room_type_name || "—"}</td>
                        <td className={td}>{h?.board_type ? t(BOARD_LABEL_KEYS[h.board_type]) : "—"}</td>
                        <td className={`${td} tv-tnum`}><DirText dir="ltr">{String(c.nights)}</DirText></td>
                        <td className={`${td} tv-tnum`}>{c.check_in ? <DirText dir="ltr">{c.check_in}</DirText> : "—"}</td>
                        <td className={`${td} tv-tnum`}>{c.check_out ? <DirText dir="ltr">{c.check_out}</DirText> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* flights */}
        {data.flights.length > 0 ? (
          <Section onSectionClick={onSectionClick} stage="flights">
            <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{t("pg.docFlights")}</h3>
            <div className="overflow-hidden rounded-[10px] border border-[#e2ebe7]">
              <table className="w-full border-collapse text-start">
                <thead>
                  <tr className="bg-[#185045]">
                    <th className={th}>{t("pg.legOrder")}</th>
                    <th className={th}>{t("pg.airline")}</th>
                    <th className={th}>{t("pg.flightNo")}</th>
                    <th className={th}>{t("pg.fromAirport")}</th>
                    <th className={th}>{t("pg.toAirport")}</th>
                    <th className={th}>{t("pg.departureAt")}</th>
                    <th className={th}>{t("pg.arrivalAt")}</th>
                    <th className={th}>{t("pg.flightDuration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flights.map((f, i) => {
                    const timing = flightTiming(f);
                    const duration = formatDurationAr(timing.durationMinutes);
                    const dayUnit = timing.dayOffset === 1 ? t("pg.dayUnitOne") : t("pg.dayUnitMany");
                    return (
                      <tr key={i} className="odd:bg-white even:bg-[#f8fbf9]">
                        <td className={`${td} font-bold`}>{t(`pg.leg.${f.leg_order}`)}</td>
                        <td className={td}>{f.airline || "—"}</td>
                        <td className={`${td} tv-tnum`}>{f.flight_no ? <DirText dir="ltr">{f.flight_no}</DirText> : "—"}</td>
                        <td className={td}>{f.from_airport || "—"}</td>
                        <td className={td}>{f.to_airport || "—"}</td>
                        <td className={`${td} tv-tnum`}>{f.departure_at ? <DirText dir="ltr">{f.departure_at.replace("T", " ")}</DirText> : "—"}</td>
                        <td className={`${td} tv-tnum`}>
                          {f.arrival_at ? (
                            <>
                              <DirText dir="ltr">{f.arrival_at.replace("T", " ")}</DirText>
                              {timing.dayOffset > 0 ? (
                                <span className="ms-1 rounded bg-[#eaf1ff] px-1 py-0.5 text-[9px] font-extrabold text-[#2b57c4]">
                                  <DirText dir="ltr">{`+${timing.dayOffset}`}</DirText> {dayUnit}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${td} tv-tnum`}>{duration ? <DirText dir="ltr">{duration}</DirText> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        {/* transport */}
        {data.transport.length > 0 ? (
          <Section onSectionClick={onSectionClick} stage="transport">
            <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{t("pg.docTransport")}</h3>
            <ul className="space-y-1.5">
              {data.transport.map((tr, i) => (
                <li key={i} className="rounded-[8px] bg-[#f4f8f6] px-3 py-2 text-[12px]">
                  <span className="font-bold">{tr.from_place}</span> ← <span className="font-bold">{tr.to_place}</span>
                  {tr.car_type ? <span className="text-[#557d78]"> · {tr.car_type}</span> : null}
                  {tr.date ? <span className="tv-tnum text-[#93aaa3]"> · <DirText dir="ltr">{tr.date}</DirText></span> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* visas */}
        {data.visas.length > 0 ? (
          <Section onSectionClick={onSectionClick} stage="visas">
            <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{t("pg.docVisas")}</h3>
            <ul className="space-y-1.5">
              {data.visas.map((v, i) => (
                <li key={i} className="rounded-[8px] bg-[#f4f8f6] px-3 py-2 text-[12px]">
                  <span className="font-bold">{v.visa_type || v.country}</span>
                  <span className="tv-tnum text-[#557d78]"> × <DirText dir="ltr">{String(v.count)}</DirText></span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* includes / excludes */}
        <Section onSectionClick={onSectionClick} stage="services">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[13px] font-extrabold text-[#0f7a52]">{t("pg.includes")}</h3>
              {data.services.includes.length === 0 ? (
                <p className="text-[12px] text-[#93aaa3]">{t("pg.docNoContent")}</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {data.services.includes.map((item, i) => (
                    <li key={i} className="flex items-start gap-2"><span className="mt-0.5 text-[#0f7a52]">✓</span>{item}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-[13px] font-extrabold text-[#c22850]">{t("pg.excludes")}</h3>
              {data.services.excludes.length === 0 ? (
                <p className="text-[12px] text-[#93aaa3]">—</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {data.services.excludes.map((item, i) => (
                    <li key={i} className="flex items-start gap-2"><span className="mt-0.5 text-[#c22850]">✕</span>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>

        {/* price box — SELL side only, ever */}
        <Section onSectionClick={onSectionClick} stage="pricing">
          <div className="flex items-center justify-between rounded-[12px] bg-[#185045] px-5 py-4 text-white">
            <p className="text-[13px] font-extrabold">{t("pg.docPrice")}</p>
            <p className="tv-tnum text-[20px] font-extrabold">
              {data.pricing.final_total != null ? (
                <>
                  <DirText dir="ltr">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(data.pricing.final_total)}</DirText>{" "}
                  <span className="text-[13px] font-bold text-[#bfe0d6]">{data.pricing.display_currency}</span>
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
        </Section>

        {/* terms */}
        {data.services.terms.length > 0 ? (
          <Section onSectionClick={onSectionClick} stage="services">
            <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{t("pg.docTerms")}</h3>
            <ol className="list-inside list-decimal space-y-1 text-[11.5px] text-[#557d78]">
              {data.services.terms.map((term, i) => (
                <li key={i}>{term}</li>
              ))}
            </ol>
          </Section>
        ) : null}
      </div>
    </article>
  );
}
