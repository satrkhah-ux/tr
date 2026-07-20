import type { ReactNode } from "react";
import { DirText } from "@/components/DirText";
import type { ClientOfferDTO, InternalOfferDTO } from "@/lib/offer/dto";
import type { ClimateLevel } from "@/lib/types";
import {
  AR,
  BOARD_AR,
  CLIMATE_LEVEL_AR,
  FACILITY_AR,
  ITEM_TYPE_AR,
  LEG_AR,
  fmtDate,
  fmtDateTime,
  fmtNum,
  stars,
} from "./labels";
import { TRAVELIUN_MARK_DATA_URI } from "./logo";
import { OFFER_DOC_CSS } from "./styles";

/**
 * THE offer document — one fixed-layout React template rendered identically for
 * the on-screen preview and the headless-Chromium PDF (see src/lib/offer-doc).
 * Server-safe (no hooks): also used via renderToStaticMarkup for the PDF.
 *
 * Discriminated variant: the CLIENT branch is typed `ClientOfferDTO`, so buy
 * price / profit are not even in scope — the omission is by construction. Only
 * the INTERNAL branch can read buy/profit, and only in section 9.
 *
 * Sections render in a FIXED order; empty/optional ones are omitted entirely
 * (never an empty box). Page-independence lives in styles.ts.
 */
export type OfferDocumentProps =
  | { variant: "client"; offer: ClientOfferDTO }
  | { variant: "internal"; offer: InternalOfferDTO };

const Ltr = ({ children }: { children: ReactNode }) => <DirText dir="ltr">{children}</DirText>;

export function OfferDocument(props: OfferDocumentProps) {
  const offer = props.offer; // union — shared (sell-side) fields only
  const travellers = Math.max(offer.adults + offer.children, 1);
  const perPerson = offer.total != null ? offer.total / travellers : null;
  const climateByCity = new Map(offer.climate.map((c) => [c.city_name, c]));
  const hasServices = offer.includes.length > 0 || offer.excludes.length > 0;
  // `internal` = a domestic hop inside the destination country; everything else
  // (outbound/inbound, and legs with no order) is international.
  const internationalFlights = offer.flights.filter((f) => f.leg_order !== "internal");
  const domesticFlights = offer.flights.filter((f) => f.leg_order === "internal");

  return (
    <article className="od-root" dir="rtl" lang="ar">
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS }} />

      {/* page background + watermark — fixed, so EVERY page carries the identity */}
      <div className="od-page-bg" aria-hidden="true" />
      <div className="od-watermark" aria-hidden="true">
        <img src={TRAVELIUN_MARK_DATA_URI} alt="" />
      </div>

      {/* 1 — brand header band (RUNNING: repeats on every page) */}
      <header className="od-fixed-head">
        <div className="od-band">
          <div className="od-band-id">
            <img className="od-band-mark" src={TRAVELIUN_MARK_DATA_URI} alt="" />
            <div>
              <div className="od-band-brand">{AR.brand}</div>
              <div className="od-band-sub">{AR.brandLatin} · Travel &amp; Tourism</div>
            </div>
          </div>
          <div className="od-band-meta">
            <div>{AR.serial}: <b><Ltr>{offer.serial}</Ltr></b></div>
            {offer.issue_date ? <div>{AR.issueDate}: <b><Ltr>{fmtDate(offer.issue_date)}</Ltr></b></div> : null}
            {offer.validity_date ? <div>{AR.validityDate}: <b><Ltr>{fmtDate(offer.validity_date)}</Ltr></b></div> : null}
          </div>
        </div>
      </header>

      {/* running footer: brand · serial · contact (the page counter is drawn by
          Chromium's footerTemplate — CSS counters don't resolve in fixed boxes) */}
      <footer className="od-fixed-foot">
        <div className="od-foot">
          <span><b>{AR.brand}</b> · <Ltr>{offer.serial}</Ltr></span>
          <span>{AR.contact}</span>
        </div>
      </footer>

      <div className="od-body">
        {/* 2 — personal data with prominent destination */}
        <section className="od-section od-avoid">
          <div className="od-personal">
            <div className="od-dest">
              <span className="k">{AR.destination}</span>
              <span className="v">{offer.destination || "—"}</span>
            </div>
            <div className="od-fields">
              <Field k={AR.customer} v={offer.customer_name || "—"} />
              <Field k={AR.phone} v={offer.customer_phone ? <Ltr>{offer.customer_phone}</Ltr> : "—"} />
              <Field k={AR.employee} v={offer.employee_name || "—"} />
              <Field
                k={AR.travelers}
                v={<Ltr>{`${offer.adults} ${AR.adults} · ${offer.children} ${AR.children} · ${offer.infants} ${AR.infants}`}</Ltr>}
              />
              <Field
                k={`${AR.arrival} → ${AR.departure}`}
                v={<Ltr>{`${fmtDate(offer.arrival_date)} → ${fmtDate(offer.departure_date)}`}</Ltr>}
              />
              <Field k={AR.duration} v={offer.duration || "—"} />
            </div>
          </div>
        </section>

        {/* 3 — trip summary strip (city + nights chips, itinerary order) */}
        {offer.hotels.length > 0 ? (
          <section className="od-section od-avoid">
            <h2 className="od-h">{AR.tripSummary}</h2>
            <div className="od-chips">
              {offer.hotels.map((h, i) => (
                <span key={i} className="od-chip">
                  <b>{h.city_name || h.hotel_name || "—"}</b>
                  {h.nights != null ? <span className="n"><Ltr>{String(h.nights)}</Ltr> {AR.nights}</span> : null}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {/* 4 — flights, split: international (outbound/inbound) then domestic
             (internal hops). The domestic block only prints when the itinerary
             actually has one — most destinations don't. */}
        {internationalFlights.length > 0 ? (
          <section className="od-section">
            <h2 className="od-h">{domesticFlights.length > 0 ? AR.flightsIntl : AR.flights}</h2>
            <FlightTable flights={internationalFlights} />
          </section>
        ) : null}

        {domesticFlights.length > 0 ? (
          <section className="od-section">
            <h2 className="od-h">{AR.flightsDomestic}</h2>
            <FlightTable flights={domesticFlights} />
          </section>
        ) : null}

        {/* 5 — accommodation: one atomic card per city, with climate note */}
        {offer.hotels.length > 0 ? (
          <section className="od-section">
            <h2 className="od-h">{AR.accommodation}</h2>
            {offer.hotels.map((h, i) => {
              const climate = h.city_name ? climateByCity.get(h.city_name) : undefined;
              return (
                <div key={i} className="od-hotel">
                  {h.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="od-hotel-img" src={h.image_url} alt={h.hotel_name ?? ""} />
                  ) : null}
                  <div className="od-hotel-head">
                    <div>
                      <div className="od-hotel-city">{h.city_name || "—"}</div>
                      <div className="od-hotel-name">{h.hotel_name || "—"}</div>
                    </div>
                    {stars(h.stars) ? <div className="od-stars">{stars(h.stars)}</div> : null}
                  </div>
                  <div className="od-hotel-grid">
                    <Cell k={AR.roomType} v={h.room_type || "—"} />
                    <Cell k={AR.board} v={h.board_type ? BOARD_AR[h.board_type] : "—"} />
                    <Cell k={AR.rooms} v={<Ltr>{String(h.rooms_count)}</Ltr>} />
                    <Cell k={AR.checkIn} v={<Ltr>{fmtDate(h.check_in)}</Ltr>} />
                    <Cell k={AR.checkOut} v={<Ltr>{fmtDate(h.check_out)}</Ltr>} />
                    <Cell k={AR.nights} v={h.nights != null ? <Ltr>{String(h.nights)}</Ltr> : "—"} />
                  </div>
                  {h.cancellation_policy ? (
                    <div className="od-hotel-note"><b>{AR.cancellation}: </b>{h.cancellation_policy}</div>
                  ) : null}
                  {h.excluded_surcharges.length > 0 ? (
                    <div className="od-hotel-note">
                      <b>{AR.payAtHotel}: </b>
                      {h.excluded_surcharges.map((s, j) => (
                        <span key={j}>
                          {j > 0 ? "، " : ""}
                          {s.name} (<Ltr>{`${s.amount} ${s.currency}`}</Ltr>)
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {h.facilities.length > 0 ? (
                    <div className="od-facil">
                      <b>{AR.facilities}: </b>
                      {h.facilities.map((f, j) => (
                        <span key={j} className="od-facil-chip">{FACILITY_AR[f] ?? f}</span>
                      ))}
                    </div>
                  ) : null}
                  {climate ? <ClimateNote climate={climate} /> : null}
                </div>
              );
            })}
          </section>
        ) : null}

        {/* 6 — transportation */}
        {offer.transport.length > 0 ? (
          <section className="od-section od-avoid">
            <h2 className="od-h">{AR.transport}</h2>
            <ul className="od-list">
              {offer.transport.map((t, i) => (
                <li key={i}><span className="od-mark yes">•</span>{t}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 7 — services: included / not included, two columns */}
        {hasServices ? (
          <section className="od-section od-avoid">
            <h2 className="od-h">{AR.services}</h2>
            <div className="od-cols">
              {offer.includes.length > 0 ? (
                <div>
                  <p className="od-sub yes">{AR.includes}</p>
                  <ul className="od-list">
                    {offer.includes.map((s, i) => (
                      <li key={i}><span className="od-mark yes">✓</span>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {offer.excludes.length > 0 ? (
                <div>
                  <p className="od-sub no">{AR.excludes}</p>
                  <ul className="od-list">
                    {offer.excludes.map((s, i) => (
                      <li key={i}><span className="od-mark no">✕</span>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* 8 — visas */}
        {offer.visas.length > 0 ? (
          <section className="od-section od-avoid">
            <h2 className="od-h">{AR.visas}</h2>
            <ul className="od-list">
              {offer.visas.map((v, i) => (
                <li key={i}><span className="od-mark yes">•</span>{v}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 9 — price (client: sell only; internal: full buy/sell/profit) */}
        <section className="od-section">
          <h2 className="od-h">{AR.price}</h2>
          {props.variant === "internal" ? <InternalPrice offer={props.offer} /> : null}
          <div className="od-price">
            <div>
              <div className="label">{AR.price}</div>
              {perPerson != null ? (
                <div className="per"><Ltr>{`${fmtNum(perPerson)} ${offer.currency ?? ""}`}</Ltr> {AR.perPerson}</div>
              ) : null}
            </div>
            <div className="value">
              <Ltr>{offer.total != null ? `${fmtNum(offer.total)} ${offer.currency ?? ""}` : "—"}</Ltr>
            </div>
          </div>
          <p className="od-pay">{AR.paymentTerms}</p>
        </section>

        {/* 10 — terms & conditions (forced page break before; omitted when empty) */}
        {offer.terms.length > 0 ? (
          <section className="od-section od-terms">
            <h2 className="od-h">{AR.terms}</h2>
            <div>
              {offer.terms.map((t, i) => (
                <div key={i} className="od-clause">
                  <span className="n"><Ltr>{String(i + 1)}</Ltr>.</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}

/** Flight table shared by the international and domestic sections. */
function FlightTable({ flights }: { flights: ClientOfferDTO["flights"] }) {
  return (
    <table className="od-table">
      <thead>
        <tr>
          <th>{AR.flightLeg}</th>
          <th>{AR.airline}</th>
          <th>{AR.flightNo}</th>
          <th>{AR.route}</th>
          <th>{AR.flightTime}</th>
          <th>{AR.cabin}</th>
          <th>{AR.baggage}</th>
        </tr>
      </thead>
      <tbody>
        {flights.map((f, i) => (
          <tr key={i}>
            <td>{f.leg_order ? LEG_AR[f.leg_order] : "—"}</td>
            <td>{f.airline || "—"}</td>
            <td>{f.flight_no ? <Ltr>{f.flight_no}</Ltr> : "—"}</td>
            <td><Ltr>{`${f.from_airport || "—"} → ${f.to_airport || "—"}`}</Ltr></td>
            <td className="od-tnum">
              {f.departure_at || f.arrival_at ? (
                <Ltr>{`${fmtDateTime(f.departure_at)} → ${fmtDateTime(f.arrival_at)}`}</Ltr>
              ) : (
                "—"
              )}
            </td>
            <td>{f.cabin_class || "—"}</td>
            <td>{f.baggage_allowance || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="od-field">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function Cell({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="od-hotel-cell">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function ClimateNote({ climate }: { climate: { avg_high_c: number | null; avg_low_c: number | null; rain_level: ClimateLevel | null; humidity_level: ClimateLevel | null; advice_ar: string | null } }) {
  return (
    <div className="od-climate">
      <b>{AR.climate}:</b>
      {climate.avg_high_c != null ? <span className="t">{AR.climateHigh} <Ltr>{`${fmtNum(climate.avg_high_c, 1)}°`}</Ltr></span> : null}
      {climate.avg_low_c != null ? <span className="t">{AR.climateLow} <Ltr>{`${fmtNum(climate.avg_low_c, 1)}°`}</Ltr></span> : null}
      {climate.rain_level ? <span className="t">{AR.rain} {CLIMATE_LEVEL_AR[climate.rain_level]}</span> : null}
      {climate.humidity_level ? <span className="t">{AR.humidity} {CLIMATE_LEVEL_AR[climate.humidity_level]}</span> : null}
      {climate.advice_ar ? <span>{climate.advice_ar}</span> : null}
    </div>
  );
}

/** INTERNAL-only pricing table (buy / sell / profit). Never in the client tree. */
function InternalPrice({ offer }: { offer: InternalOfferDTO }) {
  const p = offer.pricing;
  return (
    <div className="od-avoid" style={{ marginBottom: "var(--sp-4)" }}>
      <div className="od-internal-note">{AR.internalNote}</div>
      <table className="od-table">
        <thead>
          <tr>
            <th>{AR.item}</th>
            <th>{AR.buy}</th>
            <th>{AR.sell}</th>
            <th>{AR.profit}</th>
            <th>{AR.margin}</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((line, i) => (
            <tr key={i}>
              <td>{line.description || (line.item_type ? ITEM_TYPE_AR[line.item_type] : "—")}</td>
              <td className="od-tnum"><Ltr>{fmtNum(line.base_buy, 2)}</Ltr></td>
              <td className="od-tnum"><Ltr>{fmtNum(line.base_sell, 2)}</Ltr></td>
              <td className="od-tnum"><Ltr>{fmtNum(line.profit_base, 2)}</Ltr></td>
              <td className="od-tnum"><Ltr>{line.margin_pct != null ? `${fmtNum(line.margin_pct, 1)}%` : "—"}</Ltr></td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 800 }}>{p.base}</td>
            <td className="od-tnum" style={{ fontWeight: 800 }}><Ltr>{fmtNum(p.total_buy, 2)}</Ltr></td>
            <td className="od-tnum" style={{ fontWeight: 800 }}><Ltr>{fmtNum(p.total_sell, 2)}</Ltr></td>
            <td className="od-tnum" style={{ fontWeight: 800, color: "#0f7a52" }}><Ltr>{fmtNum(p.profit, 2)}</Ltr></td>
            <td className="od-tnum" style={{ fontWeight: 800 }}><Ltr>{p.margin_pct != null ? `${fmtNum(p.margin_pct, 1)}%` : "—"}</Ltr></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
