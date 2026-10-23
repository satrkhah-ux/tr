import type { ReactNode } from "react";
import { AR } from "./labels";
import { TRAVELIUN_BRAND } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import { letterTerms, letterTips, share, type LetterNumbers, type LetterTargets } from "@/lib/telegram/staff-letter";

/**
 * «خطاب رسمي» to one employee — the receipt's identity (OFFER_DOC_CSS, logo,
 * map), their Teletel numbers in one table, then the terms and the tips.
 * Server-safe (no hooks) for renderDocHtml.
 */

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

const LIST = { margin: 0, padding: "2.5mm 5mm 3mm", paddingInlineStart: "11mm", fontSize: "10.5pt", lineHeight: 1.6 } as const;
const CELL = { padding: "2.2mm 4mm" } as const;
const HEAD = { padding: "3mm 5mm" } as const;

export function StaffLetterDocument({
  name,
  numbers,
  targets,
  date,
  assets = DEFAULT_OFFER_DOC_ASSETS,
}: {
  name: string;
  numbers: LetterNumbers;
  targets: LetterTargets;
  /** dd/mm/yyyy, Riyadh */
  date: string;
  assets?: OfferDocAssets;
}) {
  const brand = TRAVELIUN_BRAND;
  const rows: [string, number, string][] = [
    ["إجمالي محادثاتك في تيلي تيل", numbers.total, "100%"],
    ["محادثات أكّد فيها العميل حجزه", numbers.confirmed, share(numbers.confirmed, numbers.total)],
    ["محادثات مفتوحة", numbers.open, share(numbers.open, numbers.total)],
    ["محادثات مغلقة", numbers.closed, share(numbers.closed, numbers.total)],
  ];

  return (
    <div className="od-root" dir="rtl" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")` }}>
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS }} />
      <section className="od-page od-cover">
        <div className="od-top">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="od-logo" src={assets.logoUrl} alt={brand.nameLatin} />
          </div>
          <div className="od-company" style={{ lineHeight: 1.6 }}>
            <h2>{brand.nameAr}</h2>
            <div>{brand.address}</div>
            <div>
              {AR.callLabel}: <Ltr>{brand.phone}</Ltr>
            </div>
            <div>
              {AR.webLabel}: <Ltr>{brand.website}</Ltr>
            </div>
          </div>
        </div>

        <div className="od-hero" style={{ marginTop: "4mm" }}>
          <div className="od-hero-label" style={{ marginBottom: "1mm" }}>
            خطاب رسمي · التاريخ <Ltr>{date}</Ltr>
          </div>
          <h1 style={{ fontSize: "22pt", margin: 0 }}>ملخص محادثاتك في تيلي تيل</h1>
        </div>

        <div style={{ marginTop: "5mm", fontSize: "11.5pt", lineHeight: 1.8 }}>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الزميل/ة: {name} — المحترم/ة</div>
          <div>السلام عليكم ورحمة الله وبركاته،</div>
          <div>نرفق لك ملخص محادثاتك في تيلي تيل حتى تاريخ اليوم، ونأمل الاطلاع عليه والالتزام بالشروط أدناه.</div>
        </div>

        <div className="od-panel" style={{ marginTop: "4mm" }}>
          <div className="od-panel-head" style={HEAD}>
            <span>أرقامك حتى اليوم</span>
            <span>النسبة من الإجمالي</span>
          </div>
          <table className="od-info">
            <tbody>
              {rows.map(([label, value, pct], i) => (
                <tr key={label}>
                  <th style={{ ...CELL, width: "auto" }}>{label}</th>
                  <td style={{ ...CELL, fontWeight: 800, fontSize: i === 0 ? "15pt" : "13pt", color: "var(--od-green)", textAlign: "center", width: "28mm" }}>
                    <Ltr>{value}</Ltr>
                  </td>
                  <td style={{ ...CELL, textAlign: "center", width: "34mm", color: "var(--od-muted)" }}>
                    <Ltr>{pct}</Ltr>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="od-panel" style={{ marginTop: "4mm" }}>
          <div className="od-panel-head" style={HEAD}>
            <span>شروط العمل على المحادثات</span>
          </div>
          <ol style={LIST}>
            {letterTerms(targets).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>

        <div className="od-panel" style={{ marginTop: "4mm" }}>
          <div className="od-panel-head" style={{ ...HEAD, background: "var(--od-gold)", color: "#3d2c05" }}>
            <span>نصائح لك من أرقامك</span>
          </div>
          <ul style={LIST}>
            {letterTips(numbers).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>

        <div style={{ marginTop: "5mm", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12mm", textAlign: "center" }}>
          <div>
            <div style={{ fontWeight: 800, color: "var(--od-green)" }}>مع خالص التحية والتقدير</div>
            <div style={{ marginTop: "2mm" }}>إدارة {brand.nameAr}</div>
          </div>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الختم</div>
        </div>

        <div className="od-foot">
          <span>{date}</span>
          <span>{brand.nameLatin} · صادر إلكترونياً — الأرقام من تيلي تيل والنظام وقت الإصدار</span>
        </div>
      </section>
    </div>
  );
}
