import type { ReactNode } from "react";
import { AR } from "./labels";
import { TRAVELIUN_BRAND } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";

/**
 * «قرار إداري» — the letters' identity (OFFER_DOC_CSS, logo, map, the company block the offer prints): the serial, the
 * date, the kind, whom it is for, the text, who issued it, and the acknowledgement. One employee's copy carries their
 * own «استلمت»; the archive's copy adds a sheet with every recipient. Server-safe (no hooks) for renderDocHtml.
 */

const Ltr = ({ children }: { children: ReactNode }) => (
  <bdi dir="ltr">{children}</bdi>
);
const HEAD = { padding: "3mm 5mm" } as const;
const CELL = { padding: "2mm 4mm", width: "auto" } as const;

export type DecisionCopyRecipient = {
  name: string;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
};

export function AdminDecisionDocument({
  serial,
  kind,
  title,
  body,
  audience,
  date,
  issuer,
  copy,
  recipients,
  assets = DEFAULT_OFFER_DOC_ASSETS,
}: {
  /** null: a preview, numbered when it is issued */
  serial: string | null;
  kind: string;
  title: string;
  body: string;
  audience: string;
  /** dd/mm/yyyy, Riyadh */
  date: string;
  issuer: string;
  /** one employee's copy: their acknowledgement (dd/mm/yyyy hh:mm) */
  copy?: { name: string; acknowledgedAt: string | null };
  /** the archive's copy: every recipient, on a sheet of its own */
  recipients?: DecisionCopyRecipient[];
  assets?: OfferDocAssets;
}) {
  const brand = TRAVELIUN_BRAND;
  const warning = kind === "إنذار";
  const accent = warning ? "#8e1f14" : "var(--od-green)";
  const paragraphs = body
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const foot = (
    <div className="od-foot">
      <span>
        {date} · {serial ?? "PREVIEW"}
      </span>
      <span>{brand.nameLatin} · صادر إلكترونياً من نظام ترافليون ون</span>
    </div>
  );

  return (
    <div
      className="od-root"
      dir="rtl"
      style={{ ["--od-map" as string]: `url("${assets.mapUrl}")` }}
    >
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS }} />
      <section className="od-page od-cover">
        <div className="od-top">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="od-logo"
              src={assets.logoUrl}
              alt={brand.nameLatin}
            />
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
            قرار إداري رقم{" "}
            {serial ? <Ltr>{serial}</Ltr> : "— يُرقَّم عند الإصدار —"} · التاريخ{" "}
            <Ltr>{date}</Ltr>
          </div>
          <h1 style={{ fontSize: "21pt", margin: 0 }}>{title}</h1>
        </div>

        <div className="od-panel" style={{ marginTop: "4mm" }}>
          <table className="od-info">
            <tbody>
              <tr>
                <th style={{ ...CELL, width: "34mm" }}>نوع القرار</th>
                <td style={{ ...CELL, fontWeight: 800, color: accent }}>
                  {kind}
                </td>
              </tr>
              <tr>
                <th style={{ ...CELL, width: "34mm" }}>إلى</th>
                <td style={CELL}>
                  {copy ? `${copy.name} — ${audience}` : audience}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "5mm", fontSize: "11.5pt", lineHeight: 1.9 }}>
          <div>السلام عليكم ورحمة الله وبركاته،</div>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ margin: "2mm 0", textAlign: "justify" }}>
              {p}
            </p>
          ))}
        </div>

        <div
          style={{
            marginTop: "6mm",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12mm",
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, color: "var(--od-green)" }}>
              صادر عن
            </div>
            <div style={{ marginTop: "2mm" }}>{issuer}</div>
            <div style={{ marginTop: "1mm", color: "var(--od-muted)" }}>
              إدارة {brand.nameAr}
            </div>
          </div>
          <div style={{ fontWeight: 800, color: "var(--od-green)" }}>الختم</div>
        </div>

        <div
          className="od-panel"
          style={{
            marginTop: "6mm",
            padding: "3mm 5mm",
            fontSize: "10.5pt",
            lineHeight: 1.7,
            borderColor: accent,
            borderWidth: "2px",
          }}
        >
          <div style={{ fontWeight: 800, color: accent }}>إقرار بالاستلام</div>
          {copy ? (
            copy.acknowledgedAt ? (
              <div>
                ✅ استلم/ت <b>{copy.name}</b> هذا القرار وأقرّ/ت بالاطلاع عليه
                في <Ltr>{copy.acknowledgedAt}</Ltr> — محفوظ في النظام توقيعاً
                إلكترونياً.
              </div>
            ) : (
              <div>
                يُقرّ المستلم بالاطلاع على هذا القرار بالضغط على «✅ استلمت» في
                «تنبيهاتي» أو في النظام، ويُحفظ إقراره توقيعاً إلكترونياً.
              </div>
            )
          ) : recipients ? (
            <div>
              صدر إلى <Ltr>{recipients.length}</Ltr> — أقرّ بالاستلام{" "}
              <Ltr>{recipients.filter((r) => r.acknowledgedAt).length}</Ltr>.
              القائمة في الصفحة التالية.
            </div>
          ) : (
            <div>
              يُقرّ كل مستلم بالاطلاع على هذا القرار بالضغط على «✅ استلمت»،
              ويُحفظ إقراره توقيعاً إلكترونياً.
            </div>
          )}
        </div>
        {foot}
      </section>

      {recipients?.length ? (
        <section className="od-page">
          <div className="od-hero">
            <div className="od-hero-label">
              قرار إداري رقم {serial ? <Ltr>{serial}</Ltr> : "—"} · {kind}
            </div>
            <h1 style={{ fontSize: "16pt", margin: 0 }}>بيان الاستلام</h1>
          </div>
          <div className="od-panel" style={{ marginTop: "4mm" }}>
            <div className="od-panel-head" style={HEAD}>
              <span>الموظف</span>
              <span>الإقرار بالاستلام</span>
            </div>
            <table className="od-info">
              <tbody>
                {recipients.map((r, i) => (
                  <tr key={i}>
                    <th style={CELL}>{r.name}</th>
                    <td
                      style={{
                        ...CELL,
                        textAlign: "center",
                        width: "60mm",
                        color: r.acknowledgedAt
                          ? "var(--od-green)"
                          : "var(--od-muted)",
                      }}
                    >
                      {r.acknowledgedAt ? (
                        <>
                          ✅ <Ltr>{r.acknowledgedAt}</Ltr>
                        </>
                      ) : r.deliveredAt ? (
                        "⏳ وصله ولم يُقرّ"
                      ) : (
                        "في النظام فقط — لم يصله في تيليجرام"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {foot}
        </section>
      ) : null}
    </div>
  );
}
