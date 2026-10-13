import type { ReactNode } from "react";
import { AR, fmtDate } from "./labels";
import { TRAVELIUN_BRAND, type DocBrand } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import { KIND_AR, METHOD_AR, amountInArabicWords, type ReceiptDTO } from "@/lib/operations/payments";

/**
 * «سند قبض» — one sheet per payment, in the same identity as the vouchers
 * (OFFER_DOC_CSS, the brand, the map), so the client's receipt looks like it
 * came from the company that sold the trip. The amount is printed in figures
 * AND in words: that is what makes a receipt hard to alter after the fact.
 *
 * Server-safe (no hooks) for renderDocHtml.
 */

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

const money = (amount: number, currency: string) =>
  `${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;

export function ReceiptDocument({
  receipt,
  assets = DEFAULT_OFFER_DOC_ASSETS,
  brand = TRAVELIUN_BRAND,
}: {
  receipt: ReceiptDTO;
  assets?: OfferDocAssets;
  /** a partner's client is paying the partner — the receipt carries the partner's name. */
  brand?: DocBrand;
}) {
  // the house logo is the fallback for OUR brand only — a partner without a logo prints its name
  const logoUrl = brand.vars ? brand.logoUrl : (brand.logoUrl ?? assets.logoUrl);
  const forWhat = `${KIND_AR[receipt.kind]} — ${receipt.destination ? `برنامج ${receipt.destination}` : "البرنامج السياحي"}`;

  return (
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
          <div className="od-hero-label">سند قبض</div>
          <h1 style={{ fontSize: "26pt" }}>
            <Ltr>{money(receipt.amount, receipt.currency)}</Ltr>
          </h1>
          <div className="od-hero-meta">
            رقم السند <Ltr>{receipt.receipt_no}</Ltr> | التاريخ <Ltr>{fmtDate(receipt.paid_at)}</Ltr>
          </div>
        </div>

        <div className="od-panel">
          <div className="od-panel-head">
            <span>بيانات السند</span>
            <span>
              <Ltr>{receipt.receipt_no}</Ltr>
            </span>
          </div>
          <table className="od-info">
            <tbody>
              <tr>
                <th>استلمنا من</th>
                <td>{receipt.customer_name || "—"}</td>
              </tr>
              <tr>
                <th>مبلغاً وقدره</th>
                <td style={{ fontWeight: 800 }}>
                  <Ltr>{money(receipt.amount, receipt.currency)}</Ltr>
                </td>
              </tr>
              <tr>
                <th>المبلغ كتابةً</th>
                <td style={{ fontWeight: 800 }}>فقط {amountInArabicWords(receipt.amount, receipt.currency)} لا غير</td>
              </tr>
              <tr>
                <th>طريقة الدفع</th>
                <td>{receipt.method ? METHOD_AR[receipt.method] : "—"}</td>
              </tr>
              {receipt.reference ? (
                <tr>
                  <th>رقم المرجع</th>
                  <td>
                    <Ltr>{receipt.reference}</Ltr>
                  </td>
                </tr>
              ) : null}
              <tr>
                <th>وذلك عن</th>
                <td>{forWhat}</td>
              </tr>
              <tr>
                <th>{AR.serial}</th>
                <td>
                  <Ltr>{receipt.serial}</Ltr>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "16mm", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12mm", textAlign: "center" }}>
          <div>
            <div style={{ fontWeight: 800, color: "var(--od-green)" }}>المستلم</div>
            <div style={{ marginTop: "14mm", borderTop: "1px solid var(--od-line)" }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الختم</div>
            <div style={{ marginTop: "14mm", borderTop: "1px solid var(--od-line)" }} />
          </div>
        </div>

        <p className="od-note" style={{ marginTop: "12mm" }}>
          هذا السند صادر إلكترونياً من نظام {brand.nameAr}، ويُعتمد برقمه. احتفظ به حتى نهاية رحلتك.
        </p>
      </section>
    </div>
  );
}
