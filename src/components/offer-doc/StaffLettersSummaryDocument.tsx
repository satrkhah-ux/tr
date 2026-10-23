import type { ReactNode } from "react";
import { AR } from "./labels";
import { TRAVELIUN_BRAND } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import type { LetterNumbers } from "@/lib/telegram/staff-letter";

/**
 * «بيان الخطاب الرسمي» to the administration (the owner, 2026-10-23) — the
 * employee letter's identity, one row per sales employee: the numbers their
 * letter froze, whether it reached them, and when they signed it.
 * Server-safe (no hooks) for renderDocHtml.
 */

export type SummaryRow = { name: string; numbers: LetterNumbers; received: boolean; signed: string | null; warned: boolean };

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

const TH = { padding: "2.6mm 2mm", width: "auto", color: "#fff", fontWeight: 700, borderTop: "none", textAlign: "center", fontSize: "9.5pt" } as const;
const TD = { padding: "2.2mm 2mm", textAlign: "center", fontSize: "10pt" } as const;
const NUM = { ...TD, fontWeight: 800, color: "var(--od-green)" } as const;

const COLUMNS = ["الموظف", "المحادثات", "المفتوحة", "المغلقة", "أكّد", "الاستلام", "الاعتماد"];

export function StaffLettersSummaryDocument({
  number,
  date,
  rows,
  unlinked,
  assets = DEFAULT_OFFER_DOC_ASSETS,
}: {
  number: 1 | 2;
  /** dd/mm/yyyy, Riyadh */
  date: string;
  rows: SummaryRow[];
  /** sales employees with no Telegram linked: the letter cannot reach them */
  unlinked: string[];
  assets?: OfferDocAssets;
}) {
  const brand = TRAVELIUN_BRAND;
  const received = rows.filter((r) => r.received).length;
  const signed = rows.filter((r) => r.signed).length;

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
            بيان الخطاب الرسمي رقم <Ltr>{number}</Ltr> · التاريخ <Ltr>{date}</Ltr>
          </div>
          <h1 style={{ fontSize: "22pt", margin: 0 }}>استلام الخطاب واعتماده — قسم المبيعات</h1>
        </div>

        <div style={{ marginTop: "5mm", fontSize: "11.5pt", lineHeight: 1.8 }}>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>إلى إدارة {brand.nameAr} — المحترمين</div>
          <div>السلام عليكم ورحمة الله وبركاته،</div>
          <div>
            نرفق بيان الخطاب الرسمي رقم <Ltr>{number}</Ltr> لموظفي قسم المبيعات: أرقام كل موظف وقت إصدار خطابه، ومن استلمه، ومن اعتمده بتوقيعه الإلكتروني في
            البوت.
          </div>
        </div>

        <div style={{ marginTop: "3mm", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "3mm", textAlign: "center" }}>
          {[
            ["صدر لهم الخطاب", rows.length],
            ["استلموه", received],
            ["اعتمدوه", signed],
          ].map(([label, n]) => (
            <div key={label} className="od-panel" style={{ padding: "2.5mm" }}>
              <div style={{ fontSize: "18pt", fontWeight: 800, color: "var(--od-green)" }}>
                <Ltr>{n}</Ltr>
              </div>
              <div style={{ fontSize: "10pt", color: "var(--od-muted)" }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="od-panel" style={{ marginTop: "3mm" }}>
          <table className="od-info">
            <tbody>
              <tr style={{ background: "var(--od-green)" }}>
                {COLUMNS.map((h, i) => (
                  <th key={h} style={{ ...TH, textAlign: i ? "center" : "start" }}>
                    {h}
                  </th>
                ))}
              </tr>
              {rows.map((r) => (
                <tr key={r.name}>
                  <th style={{ ...TD, textAlign: "start", width: "auto", color: "var(--od-ink)", fontWeight: 700 }}>
                    {r.name}
                    {r.warned ? <span style={{ color: "#c0392b", fontSize: "8.5pt" }}> · إبلاغ بالسحب</span> : null}
                  </th>
                  {(["total", "open", "closed", "confirmed"] as const).map((k) => (
                    <td key={k} style={NUM}>
                      <Ltr>{r.numbers[k]}</Ltr>
                    </td>
                  ))}
                  <td style={{ ...TD, color: r.received ? "var(--od-green)" : "#c0392b", fontWeight: 700 }}>{r.received ? "✓ استلمه" : "لم يصله"}</td>
                  <td style={{ ...TD, fontSize: "9pt", color: r.signed ? "var(--od-green)" : "#b9770e", fontWeight: 700 }}>
                    {r.signed ? <Ltr>{r.signed}</Ltr> : "لم يعتمده بعد"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {unlinked.length ? (
          <div className="od-panel" style={{ marginTop: "3mm", padding: "2.5mm 5mm", fontSize: "10pt", lineHeight: 1.6 }}>
            لم يُصدر لهم الخطاب لعدم ربط حسابهم في تيليجرام: {unlinked.join("، ")}.
          </div>
        ) : null}

        <div style={{ marginTop: "5mm", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12mm", textAlign: "center" }}>
          <div>
            <div style={{ fontWeight: 800, color: "var(--od-green)" }}>مع خالص التحية والتقدير</div>
            <div style={{ marginTop: "2mm" }}>نظام {brand.nameAr} — بوت «تنبيهاتي»</div>
          </div>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الختم</div>
        </div>

        <div className="od-foot">
          <span>
            {date} · No. {number}
          </span>
          <span>{brand.nameLatin} · صادر إلكترونياً — يتحدّث مع كل اعتماد</span>
        </div>
      </section>
    </div>
  );
}
