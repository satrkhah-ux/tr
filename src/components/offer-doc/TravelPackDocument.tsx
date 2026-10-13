import type { ReactNode } from "react";
import { AR, fmtDate } from "./labels";
import { TRAVELIUN_BRAND, type DocBrand } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import { VoucherDocument } from "./VoucherDocument";
import { ReceiptDocument } from "./ReceiptDocument";
import { DOCUMENT_LABEL } from "@/lib/operations/voucher-dto";
import type { ServiceKind } from "@/lib/operations/drivers";
import type { TravelPack } from "@/lib/data/travel-pack";

/**
 * «حقيبة السفر» — the client's one PDF (operations order 11, suggestion 9).
 *
 * A cover of our own (the trip, today's driver, who to call, what is inside),
 * then the issued documents and receipts rendered by their OWN components —
 * the pack is those same sheets back to back, so it can never disagree with
 * the single files. Each part starts on a fresh sheet.
 *
 * Server-safe (no hooks) for renderDocHtml.
 */

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

const SERVICE_LABEL: Record<ServiceKind, string> = {
  reception: "استقبال من المطار",
  farewell: "توصيل إلى المطار",
  transfer: "انتقال",
  tour: "جولة",
};

/** every part after the cover opens a new sheet, whatever length the one before ran to */
const PACK_CSS = `.tp-part{break-before:page;}`;

export function TravelPackDocument({
  pack,
  assets = DEFAULT_OFFER_DOC_ASSETS,
  brand = TRAVELIUN_BRAND,
}: {
  pack: TravelPack;
  assets?: OfferDocAssets;
  /** a partner's client gets the partner's pack — logo, name, colours. */
  brand?: DocBrand;
}) {
  const { hub, trip, guide, documents, receipts } = pack;
  // the house logo is the fallback for OUR brand only — a partner without a logo prints its name
  const logoUrl = brand.vars ? brand.logoUrl : (brand.logoUrl ?? assets.logoUrl);
  // the driver appears on the service day only (clientService) — the pack keeps that promise
  const drivers = trip.services.filter((s) => s.driver);
  const emergency = trip.info.emergency_phone || brand.phone;
  const agentName = trip.info.agent_name || guide?.local_agent_name || "";
  const agentPhone = trip.info.agent_phone || guide?.local_agent_phone || "";
  const contents = [
    ...documents.map((d) =>
      d.kind === "hotel_voucher" && d.bookings.length > 0 ? `${DOCUMENT_LABEL[d.kind]}: ${d.bookings.map((b) => b.title).join("، ")}` : DOCUMENT_LABEL[d.kind],
    ),
    ...receipts.map((r) => `سند قبض ${r.receipt_no}`),
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PACK_CSS }} />
      <div className="od-root" dir="rtl" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")`, ...(brand.vars ?? {}) }}>
        <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS }} />
        <section className="od-page od-cover">
          <div className="od-top">
            <div>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="od-logo" src={logoUrl} alt={brand.nameLatin} />
              ) : (
                <div className="od-wordmark">{brand.nameAr}</div>
              )}
            </div>
            <div className="od-company">
              <h2>{brand.nameAr}</h2>
              {brand.address ? <div>{brand.address}</div> : null}
              {brand.phone ? (
                <div>
                  {AR.callLabel}: <Ltr>{brand.phone}</Ltr>
                </div>
              ) : null}
              {brand.website ? (
                <div>
                  {AR.webLabel}: <Ltr>{brand.website}</Ltr>
                </div>
              ) : null}
            </div>
          </div>

          <div className="od-hero" style={{ marginTop: "12mm" }}>
            <div className="od-hero-label">حقيبة السفر</div>
            <h1 style={{ fontSize: "26pt" }}>{hub.destination || brand.nameAr}</h1>
            <div className="od-hero-meta">
              {hub.customer_name ? `${hub.customer_name} | ` : ""}
              {AR.serial} <Ltr>{hub.serial}</Ltr>
              {hub.travel_start ? (
                <>
                  {" | "}
                  <Ltr>{`${fmtDate(hub.travel_start)} → ${fmtDate(hub.travel_end)}`}</Ltr>
                </>
              ) : null}
            </div>
          </div>

          {drivers.map((s, i) => (
            <div key={i} className="od-panel">
              <div className="od-panel-head">
                <span>سائقك اليوم — {SERVICE_LABEL[s.kind]}</span>
                <Ltr>{s.time || "—"}</Ltr>
              </div>
              <table className="od-info">
                <tbody>
                  <Row label="السائق">{s.driver?.name || "—"}</Row>
                  {s.driver?.phone ? (
                    <Row label="جوال السائق">
                      <Ltr>{s.driver.phone}</Ltr>
                    </Row>
                  ) : null}
                  {s.car || s.driver?.plate ? (
                    <Row label="السيارة">
                      {s.car}
                      {s.driver?.plate ? (
                        <>
                          {" · اللوحة "}
                          <Ltr>{s.driver.plate}</Ltr>
                        </>
                      ) : null}
                    </Row>
                  ) : null}
                  {s.meet ? <Row label="نقطة الالتقاء">{s.meet}</Row> : null}
                  {s.flight ? (
                    <Row label="الرحلة">
                      <Ltr>{s.flight}</Ltr>
                    </Row>
                  ) : null}
                </tbody>
              </table>
            </div>
          ))}

          <div className="od-panel">
            <div className="od-panel-head">
              <span>للتواصل والطوارئ</span>
              {guide ? <span>{guide.country}</span> : null}
            </div>
            <table className="od-info">
              <tbody>
                {emergency ? (
                  <Row label="رقم الطوارئ">
                    <Ltr>{emergency}</Ltr>
                  </Row>
                ) : null}
                {brand.whatsapp && brand.whatsapp !== emergency ? (
                  <Row label="واتساب">
                    <Ltr>{brand.whatsapp}</Ltr>
                  </Row>
                ) : null}
                {agentName || agentPhone ? (
                  <Row label="الوكيل المحلي">
                    {agentName}
                    {agentPhone ? (
                      <>
                        {" "}
                        <Ltr>{agentPhone}</Ltr>
                      </>
                    ) : null}
                  </Row>
                ) : null}
                {guide?.ambulance ? (
                  <Row label="الإسعاف">
                    <Ltr>{guide.ambulance}</Ltr>
                  </Row>
                ) : null}
                {guide?.police ? (
                  <Row label="الشرطة">
                    <Ltr>{guide.police}</Ltr>
                  </Row>
                ) : null}
                {guide?.embassy_phone ? (
                  <Row label="السفارة">
                    <Ltr>{guide.embassy_phone}</Ltr>
                  </Row>
                ) : null}
                {guide?.hospital ? <Row label="مستشفى">{guide.hospital}</Row> : null}
              </tbody>
            </table>
            {guide?.notes ? <p style={{ margin: 0, padding: "0 4mm 4mm", whiteSpace: "pre-line", fontSize: "10pt" }}>{guide.notes}</p> : null}
          </div>

          {contents.length > 0 ? (
            <div className="od-panel">
              <div className="od-panel-head">
                <span>محتويات الحقيبة</span>
              </div>
              <ol style={{ margin: 0, padding: "3mm 9mm 4mm 4mm", fontSize: "10.5pt", lineHeight: 1.9 }}>
                {contents.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="od-note">لم تصدر مستندات الرحلة بعد — ستُضاف إلى هذا الملف فور إصدارها.</p>
          )}
        </section>
      </div>

      {documents.map((d, i) => (
        <div key={`doc-${i}`} className="tp-part">
          <VoucherDocument voucher={d} assets={assets} brand={brand} />
        </div>
      ))}
      {receipts.map((r) => (
        <div key={r.receipt_no} className="tp-part">
          <ReceiptDocument receipt={r} assets={assets} brand={brand} />
        </div>
      ))}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{children}</td>
    </tr>
  );
}
