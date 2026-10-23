import type { ReactNode } from "react";
import { AR } from "./labels";
import { TRAVELIUN_BRAND } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import {
  COMMITTED_NOTE,
  comparisonLines,
  delta,
  letterTerms,
  letterTips,
  share,
  WITHDRAW_NOTICE,
  type LetterNumbers,
  type LetterTargets,
} from "@/lib/telegram/staff-letter";

/**
 * «خطاب رسمي» to one employee — the receipt's identity (OFFER_DOC_CSS, logo,
 * map). Letter 1: their Teletel numbers, the terms and the tips. Letter 2 (ten
 * days later): the two letters side by side, what changed, and either thanks or
 * the notice that their conversations will be withdrawn.
 * Server-safe (no hooks) for renderDocHtml.
 */

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

const LIST = {
  margin: 0,
  padding: "2.5mm 5mm 3mm",
  paddingInlineStart: "11mm",
  fontSize: "10.5pt",
  lineHeight: 1.6,
} as const;
const CELL = { padding: "2.2mm 4mm" } as const;
const HEAD = { padding: "3mm 5mm" } as const;
const HEAD_CELL = { padding: "3mm 4mm", width: "auto", color: "#fff", fontWeight: 700, borderTop: "none" } as const;
const NUM = {
  ...CELL,
  fontWeight: 800,
  color: "var(--od-green)",
  textAlign: "center",
  width: "28mm",
} as const;

export type PreviousLetter = {
  numbers: LetterNumbers;
  date: string;
  signed: string | null;
};

const LABELS: [keyof LetterNumbers, string][] = [
  ["total", "إجمالي محادثاتك في تيلي تيل"],
  ["confirmed", "محادثات أكّد فيها العميل حجزه"],
  ["open", "محادثات مفتوحة"],
  ["closed", "محادثات مغلقة"],
];

export function StaffLetterDocument({
  name,
  number,
  numbers,
  targets,
  date,
  previous,
  warned = false,
  assets = DEFAULT_OFFER_DOC_ASSETS,
}: {
  name: string;
  number: 1 | 2;
  numbers: LetterNumbers;
  targets: LetterTargets;
  /** dd/mm/yyyy, Riyadh */
  date: string;
  /** letter 2 only: what letter 1 said, and when it was signed */
  previous?: PreviousLetter;
  /** letter 2: they did not close their finished conversations */
  warned?: boolean;
  assets?: OfferDocAssets;
}) {
  const brand = TRAVELIUN_BRAND;

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
            خطاب رسمي رقم <Ltr>{number}</Ltr> · التاريخ <Ltr>{date}</Ltr>
          </div>
          <h1 style={{ fontSize: "22pt", margin: 0 }}>{previous ? "مقارنة أدائك بعد 10 أيام" : "ملخص محادثاتك في تيلي تيل"}</h1>
        </div>

        <div style={{ marginTop: "5mm", fontSize: "11.5pt", lineHeight: 1.8 }}>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الزميل/ة: {name} — المحترم/ة</div>
          <div>السلام عليكم ورحمة الله وبركاته،</div>
          {previous ? (
            <div>
              نرفق لك مقارنة أرقامك بين الخطاب رقم 1 (<Ltr>{previous.date}</Ltr>) واليوم.{" "}
              {previous.signed ? (
                <>
                  اعتمدت الخطاب رقم 1 في <Ltr>{previous.signed}</Ltr>،
                </>
              ) : (
                "لم تعتمد الخطاب رقم 1،"
              )}{" "}
              وشروطه سارية.
            </div>
          ) : (
            <div>نرفق لك ملخص محادثاتك في تيلي تيل حتى تاريخ اليوم، ونأمل الاطلاع عليه والالتزام بالشروط أدناه.</div>
          )}
        </div>

        <div className="od-panel" style={{ marginTop: "3mm" }}>
          {previous ? null : (
            <div className="od-panel-head" style={HEAD}>
              <span>أرقامك حتى اليوم</span>
              <span>النسبة من الإجمالي</span>
            </div>
          )}
          <table className="od-info">
            <tbody>
              {previous ? (
                // letter 2: the column titles are the panel's head
                <tr style={{ background: "var(--od-green)" }}>
                  {["أرقامك بين الخطابين", "الخطاب رقم 1", "اليوم", "التغيير"].map((h, i) => (
                    <th key={h} style={{ ...HEAD_CELL, textAlign: i ? "center" : "start", fontSize: i ? "10.5pt" : "13pt" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              ) : null}
              {LABELS.map(([key, label], i) => (
                <tr key={key}>
                  <th style={{ ...CELL, width: "auto" }}>{label}</th>
                  {previous ? (
                    <>
                      <td
                        style={{
                          ...NUM,
                          color: "var(--od-muted)",
                          fontWeight: 600,
                        }}
                      >
                        <Ltr>{previous.numbers[key]}</Ltr>
                      </td>
                      <td style={{ ...NUM, fontSize: "13pt" }}>
                        <Ltr>{numbers[key]}</Ltr>
                      </td>
                      <td
                        style={{
                          ...CELL,
                          textAlign: "center",
                          width: "24mm",
                          color: "var(--od-muted)",
                        }}
                      >
                        <Ltr>{delta(previous.numbers[key], numbers[key])}</Ltr>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ ...NUM, fontSize: i === 0 ? "15pt" : "13pt" }}>
                        <Ltr>{numbers[key]}</Ltr>
                      </td>
                      <td
                        style={{
                          ...CELL,
                          textAlign: "center",
                          width: "34mm",
                          color: "var(--od-muted)",
                        }}
                      >
                        <Ltr>{key === "total" ? "100%" : share(numbers[key], numbers.total)}</Ltr>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {previous ? (
          <>
            <div className="od-panel" style={{ marginTop: "3mm" }}>
              <div className="od-panel-head" style={HEAD}>
                <span>النتيجة</span>
              </div>
              <ul style={LIST}>
                {comparisonLines(previous.numbers, numbers).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div
              className="od-panel"
              style={{
                marginTop: "3mm",
                padding: "3mm 5mm",
                fontSize: "11pt",
                lineHeight: 1.7,
                fontWeight: 800,
                borderColor: warned ? "#c0392b" : "var(--od-green)",
                borderWidth: "2px",
                color: warned ? "#8e1f14" : "var(--od-green)",
              }}
            >
              {warned ? `⚠️ إبلاغ رسمي: ${WITHDRAW_NOTICE}` : `✅ ${COMMITTED_NOTE}`}
            </div>
          </>
        ) : (
          <div className="od-panel" style={{ marginTop: "3mm" }}>
            <div className="od-panel-head" style={HEAD}>
              <span>شروط العمل على المحادثات</span>
            </div>
            <ol style={LIST}>
              {letterTerms(targets).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
        )}

        <div className="od-panel" style={{ marginTop: "3mm" }}>
          <div className="od-panel-head" style={{ ...HEAD, background: "var(--od-gold)", color: "#3d2c05" }}>
            <span>نصائح لك من أرقامك</span>
          </div>
          <ul style={LIST}>
            {letterTips(numbers)
              .slice(0, previous ? 2 : 3)
              .map((t) => (
                <li key={t}>{t}</li>
              ))}
          </ul>
        </div>

        <div
          style={{
            marginTop: "5mm",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12mm",
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, color: "var(--od-green)" }}>مع خالص التحية والتقدير</div>
            <div style={{ marginTop: "2mm" }}>إدارة {brand.nameAr}</div>
          </div>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الختم</div>
        </div>

        <div className="od-foot">
          <span>
            {date} · No. {number}
          </span>
          <span>{brand.nameLatin} · صادر إلكترونياً — الأرقام من تيلي تيل والنظام وقت الإصدار</span>
        </div>
      </section>
    </div>
  );
}
