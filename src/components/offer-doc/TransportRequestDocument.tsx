import type { ReactNode } from "react";
import type { DocBrand } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import type { OfferDocAssets } from "./assets";

/**
 * «طباعة الحجز» — one Almatar request (0101) on paper, in ALMATAR's identity:
 * its client's name and phone and every service with its day, time and places.
 * No prices: Almatar hands this to its own client, and what it pays us is not
 * theirs to read. Server-safe, printed by renderDocHtml.
 */
export type TransportRequestLine = {
  ref: string;
  service: string;
  scope: string;
  date: string;
  time: string;
  vehicle: string;
  units: number;
  flight_no: string | null;
  pickup: string | null;
  dropoff: string | null;
};

export type TransportRequest = {
  ref: string;
  kind: string;
  created_at: string;
  country: string;
  client_name: string;
  client_phone: string | null;
  passengers: number;
  notes: string | null;
  lines: TransportRequestLine[];
};

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;
const COMPACT = ".od-tr .od-table th{padding:2.2mm 2.4mm;font-size:9.6pt;}.od-tr .od-table td{padding:2mm 2.4mm;font-size:9.4pt;}";

/** lines on the first sheet (under the header), then on each sheet after */
const FIRST = 8;
const REST = 16;

export function TransportRequestDocument({ request, brand, assets }: { request: TransportRequest; brand: DocBrand; assets: OfferDocAssets }) {
  const pages = [request.lines.slice(0, FIRST)];
  for (let i = FIRST; i < request.lines.length; i += REST) pages.push(request.lines.slice(i, i + REST));
  return (
    <div className="od-root od-tr" dir="rtl" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")`, ...(brand.vars ?? {}) }}>
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS + COMPACT }} />
      <section className="od-page od-cover">
        <div className="od-top">
          <div>
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="od-logo" src={brand.logoUrl} alt={brand.nameLatin} />
            ) : (
              <div className="od-wordmark">{brand.nameAr}</div>
            )}
          </div>
          <div className="od-company">
            <h2>{brand.nameAr}</h2>
            {brand.website ? (
              <div>
                <Ltr>{brand.website}</Ltr>
              </div>
            ) : null}
          </div>
        </div>

        <div className="od-hero" style={{ marginTop: "6mm" }}>
          <div className="od-hero-label">حجز مواصلات · Transport booking</div>
          <h1 style={{ fontSize: "22pt" }}>
            {request.kind} — {request.country}
          </h1>
          <div className="od-hero-meta">
            رقم الحجز <Ltr>{request.ref}</Ltr> | التاريخ <Ltr>{request.created_at.slice(0, 10)}</Ltr>
          </div>
        </div>

        <div className="od-panel" style={{ marginTop: "6mm" }}>
          <div className="od-panel-head">
            <span>العميل · Client</span>
            <span>{request.passengers} راكب · pax</span>
          </div>
          <table className="od-info">
            <tbody>
              <tr>
                <th>الاسم · Name</th>
                <td>{request.client_name}</td>
                <th>الجوال · Mobile</th>
                <td>{request.client_phone ? <Ltr>{request.client_phone}</Ltr> : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Lines lines={pages[0]} first={0} />
        {pages.length === 1 ? <Tail request={request} /> : null}
      </section>
      {pages.slice(1).map((page, i) => (
        <section key={i} className="od-page">
          <Lines lines={page} first={FIRST + i * REST} />
          {i + 2 === pages.length ? <Tail request={request} /> : null}
        </section>
      ))}
    </div>
  );
}

function Lines({ lines, first }: { lines: TransportRequestLine[]; first: number }) {
  return (
    <table className="od-table" style={{ marginTop: first === 0 ? "6mm" : 0 }}>
      <thead>
        <tr>
          <th style={{ width: "5%" }}>#</th>
          <th>الخدمة · Service</th>
          <th style={{ width: "17%" }}>الموعد · Date</th>
          <th style={{ width: "16%" }}>المركبة · Vehicle</th>
          <th style={{ width: "30%" }}>المسار · Route</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={l.ref} style={{ breakInside: "avoid" }}>
            <td>{first + i + 1}</td>
            <td>
              <strong>{l.service}</strong>
              <div style={{ fontSize: "8.6pt", color: "var(--od-muted)" }}>{l.scope}</div>
              <div style={{ fontSize: "8.6pt" }}>
                <Ltr>{l.ref}</Ltr>
                {l.flight_no ? (
                  <>
                    {" · "}
                    <Ltr>{l.flight_no}</Ltr>
                  </>
                ) : null}
              </div>
            </td>
            <td>
              <Ltr>
                {l.date} {l.time.slice(0, 5)}
              </Ltr>
            </td>
            <td>
              {l.vehicle} × {l.units}
            </td>
            <td>
              {l.pickup || l.dropoff ? (
                <>
                  {l.pickup ? <div>من: {l.pickup}</div> : null}
                  {l.dropoff ? <div>إلى: {l.dropoff}</div> : null}
                </>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tail({ request }: { request: TransportRequest }) {
  return (
    <>
      {request.notes ? <p className="od-note" style={{ marginTop: "4mm" }}>ملاحظات: {request.notes}</p> : null}

      <p className="od-notice" style={{ marginTop: "5mm" }}>
        المواعيد بالتوقيت المحلي للوجهة. الانتظار المجاني 60 دقيقة من وقت الوصول، والإلغاء أو التعديل خلال أقل من 12 ساعة من وقت الخدمة برسوم 100%.
        <br />
        <span dir="ltr">Local times. Free waiting: 60 minutes. Changes or cancellations within 12 hours of service are charged in full.</span>
      </p>
    </>
  );
}
