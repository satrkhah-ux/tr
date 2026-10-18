import type { ReactNode } from "react";
import type { DocBrand } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import type { OfferDocAssets } from "./assets";

/**
 * «المطار»'s transport voucher — one booking, in the PARTNER's identity (its
 * logo, name, colours and font): Almatar's traveller shows it to the driver,
 * and our name is not on it. Bilingual labels: the driver in Bangkok or Bali
 * reads English. Server-safe, printed by renderDocHtml like every voucher.
 */
export type TransportVoucher = {
  ref: string;
  issued_at: string;
  country: string;
  service: string;
  scope: string;
  vehicle: string;
  units: number;
  date: string;
  time: string;
  passengers: number;
  lead_name: string;
  lead_phone: string | null;
  flight_no: string | null;
  pickup: string | null;
  dropoff: string | null;
  notes: string | null;
  driver_info: string | null;
};

/** one booking on one sheet: the offer table's rows, tighter */
const COMPACT = ".od-tv .od-table th{padding:2.4mm 3mm;}.od-tv .od-table td{padding:2.2mm 3mm;}";

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

export function TransportVoucherDocument({ voucher, brand, assets }: { voucher: TransportVoucher; brand: DocBrand; assets: OfferDocAssets }) {
  const rows: [string, ReactNode][] = [
    ["الخدمة · Service", `${voucher.service} — ${voucher.scope}`],
    ["الدولة · Country", voucher.country],
    ["التاريخ · Date", <Ltr key="d">{voucher.date}</Ltr>],
    ["الوقت · Time (local)", <Ltr key="t">{voucher.time.slice(0, 5)}</Ltr>],
    ["المركبة · Vehicle", `${voucher.vehicle} × ${voucher.units}`],
    ["الركاب · Passengers", <Ltr key="p">{voucher.passengers}</Ltr>],
    ...(voucher.flight_no ? ([["رقم الرحلة · Flight", <Ltr key="f">{voucher.flight_no}</Ltr>]] as [string, ReactNode][]) : []),
    ...(voucher.pickup ? ([["الانطلاق · Pick-up", voucher.pickup]] as [string, ReactNode][]) : []),
    ...(voucher.dropoff ? ([["الوجهة · Drop-off", voucher.dropoff]] as [string, ReactNode][]) : []),
    ...(voucher.driver_info ? ([["السائق · Driver", voucher.driver_info]] as [string, ReactNode][]) : []),
    ...(voucher.notes ? ([["ملاحظات · Notes", voucher.notes]] as [string, ReactNode][]) : []),
  ];
  return (
    <div className="od-root od-tv" dir="rtl" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")`, ...(brand.vars ?? {}) }}>
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
          <div className="od-hero-label">فوتشر المواصلات · Transport Voucher</div>
          <h1 style={{ fontSize: "24pt" }}>{voucher.service}</h1>
          <div className="od-hero-meta">
            رقم الحجز <Ltr>{voucher.ref}</Ltr> | تاريخ الإصدار <Ltr>{voucher.issued_at.slice(0, 10)}</Ltr>
          </div>
        </div>

        <div className="od-panel" style={{ marginTop: "6mm" }}>
          <div className="od-panel-head">
            <span>المسافر · Guest</span>
            <span>
              <Ltr>{voucher.ref}</Ltr>
            </span>
          </div>
          <table className="od-info">
            <tbody>
              <tr>
                <th>الاسم · Name</th>
                <td>{voucher.lead_name}</td>
                <th>الجوال · Mobile</th>
                <td>{voucher.lead_phone ? <Ltr>{voucher.lead_phone}</Ltr> : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "5mm", fontSize: "11.5pt", fontWeight: 800, color: "#0f7a52" }}>✓ حجز مؤكد · Confirmed</div>
        <table className="od-table" style={{ marginTop: "3mm" }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th style={{ width: "34%" }}>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="od-notice" style={{ marginTop: "4mm" }}>
          الانتظار المجاني 60 دقيقة من وقت الوصول، بعدها تُحتسب رسوم إضافية حسب الوجهة. الإلغاء أو التعديل خلال أقل من 12 ساعة من وقت الخدمة برسوم 100%.
          <br />
          <span dir="ltr">Free waiting: 60 minutes from arrival. Changes or cancellations within 12 hours of service are charged in full.</span>
        </p>
      </section>
    </div>
  );
}
