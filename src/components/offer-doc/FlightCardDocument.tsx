import { DirText } from "@/components/DirText";
import type { ClientOfferDTO } from "@/lib/offer/dto";
import type { ParsedTicket } from "@/lib/flights/ticket-parse";
import { CompanyHeader, FlightCards } from "./OfferDocument";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import { TRAVELIUN_BRAND } from "./brand";
import { AR } from "./labels";
import { OFFER_DOC_CSS } from "./styles";

/**
 * «بطاقة الطيران» — a client's ticket, re-set in our identity.
 *
 * Built from the offer document's own parts — the cover's company block, the
 * boarding-pass FlightCards, OFFER_DOC_CSS, the world-map sheet — so a card sent
 * on its own looks exactly like the flight page of an offer. Server-safe (no
 * hooks): the editor previews it live, the print route renders the same markup.
 *
 * `fit` lets the sheet end under its content instead of at A4's 297mm: the PNG
 * is a picture for WhatsApp, where a half-empty page is just a smaller ticket.
 */

const CARD_CSS = `
.fc-title{margin-top:11mm;}
.od-page.fc-fit{min-height:0;padding-bottom:24mm;}
.fc-names{display:flex;flex-wrap:wrap;gap:1.5mm 5mm;font-weight:700;}
.fc-refund{display:inline-block;padding:0.6mm 3mm;border-radius:2mm;font-weight:700;}
.fc-refund-refundable{background:#e3efe9;color:#185045;}
.fc-refund-partial{background:#fbf1dd;color:#8a5a0b;}
.fc-refund-non_refundable{background:#fbe9ed;color:#a3263f;}
.fc-refund-note{display:block;margin-top:1mm;font-size:0.92em;color:#5c726c;}
`;

const at = (date: string, time: string) => (date ? (time ? `${date}T${time}` : date) : null);
const place = (name: string, code: string) => (code ? `${name || code} (${code})` : name || null);

/** The confirmed legs in the offer document's flight shape. Carrier marks come by IATA from our own table. */
export function ticketFlights(ticket: ParsedTicket, logos: Record<string, string>): ClientOfferDTO["flights"] {
  return ticket.legs.map((l) => ({
    airline: l.airline || l.airline_iata || null,
    flight_no: l.flight_no || null,
    from_airport: place(l.from_name, l.from_iata),
    to_airport: place(l.to_name, l.to_iata),
    departure_at: at(l.dep_date, l.dep_time),
    arrival_at: l.arr_date || l.arr_time ? at(l.arr_date || l.dep_date, l.arr_time) : null,
    cabin_class: l.cabin || null,
    baggage_allowance: l.baggage || null,
    airline_iata: l.airline_iata || null,
    airline_logo_url: logos[l.airline_iata] ?? null,
    leg_order: l.leg_order,
    sell_price: null,
    sell_currency: null,
  }));
}

export function FlightCardDocument({
  ticket,
  logos = {},
  assets = DEFAULT_OFFER_DOC_ASSETS,
  fit = false,
}: {
  ticket: ParsedTicket;
  logos?: Record<string, string>;
  assets?: OfferDocAssets;
  fit?: boolean;
}) {
  const brand = TRAVELIUN_BRAND;
  const codes = ticket.legs.flatMap((l, i) => (i === 0 ? [l.from_iata, l.to_iata] : [l.to_iata]));
  // left to right, as codes are read: in an RTL run «RUH ← JED» comes out reversed
  const route = codes.every(Boolean) ? codes.join(" → ") : "";

  return (
    <article className="od-root" dir="rtl" lang="ar" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")` }}>
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS + CARD_CSS }} />
      <section className={`od-page${fit ? " fc-fit" : ""}`} data-section="Flight Card">
        <CompanyHeader brand={brand} logoUrl={brand.logoUrl ?? assets.logoUrl} />

        <div className="od-title fc-title">
          <h2>{AR.flightCard}</h2>
          {route ? (
            <small>
              <DirText>{route}</DirText>
            </small>
          ) : null}
        </div>

        <div className="od-panel">
          <div className="od-panel-head">
            <span>{AR.bookingDetails}</span>
            {ticket.passengers.length > 0 ? <span>{AR.passengerCount(ticket.passengers.length)}</span> : null}
          </div>
          <table className="od-info">
            <tbody>
              <tr>
                <th>{AR.pnr}</th>
                <td>
                  <DirText>{ticket.pnr || "—"}</DirText>
                </td>
              </tr>
              {ticket.refund ? (
                <tr>
                  <th>{AR.refund}</th>
                  <td>
                    <span className={`fc-refund fc-refund-${ticket.refund}`}>{AR.refundStatus[ticket.refund]}</span>
                    {ticket.refund_note ? <bdi className="fc-refund-note">{ticket.refund_note}</bdi> : null}
                  </td>
                </tr>
              ) : null}
              <tr>
                <th>{AR.passengers}</th>
                <td>
                  {ticket.passengers.length > 0 ? (
                    <div className="fc-names">
                      {ticket.passengers.map((name, i) => (
                        <bdi key={i}>{name}</bdi>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="od-subhead od-subhead-major">{AR.flights}</h3>
        <FlightCards flights={ticketFlights(ticket, logos)} />
        <p className="od-note">{AR.flightCardNote}</p>

        <div className="od-foot">
          <span>{ticket.pnr}</span>
          <span>{brand.nameLatin} · Flight Card</span>
        </div>
      </section>
    </article>
  );
}
