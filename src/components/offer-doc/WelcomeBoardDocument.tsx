import type { ReactNode } from "react";

/**
 * «لوحة الاستقبال» — the sign held up in the arrivals hall.
 *
 * One job, and it is a physical one: a name readable from across a crowded
 * hall, over a shoulder, at an angle. So it is deliberately NOT built from the
 * offer document's chrome — no header block, no serial line, no footer. Those
 * are things a reader holds in their hand; this is read from ten metres away,
 * and every element that is not the name is competing with it.
 *
 * The identity comes from whoever issues it. A partner company's board carries
 * their logo, their name and their colours, because the guest at the airport is
 * their guest — printing ours would be introducing the wrong company.
 */

export type WelcomeBoard = {
  /** The name on the sign. Often NOT the booking name — the client chooses. */
  name: string;
  /** Optional second line: a company the guest represents, a group name. */
  subtitle: string | null;
  companyNameAr: string;
  companyNameLatin: string;
  logoUrl: string | null;
  brandColor: string;
  accentColor: string;
  /** CSS font-family value — the company's own lettering. */
  fontFamily: string;
};

/**
 * Fit the name to the sheet.
 *
 * A long Arabic name at a fixed size either overflows the sheet or wraps into
 * something unreadable, and the operator holding the sign cannot fix it at the
 * airport. Measured against the 297mm sheet with Tajawal ExtraBold; the steps
 * are wide because guessing precisely from character count is not possible and
 * a name that is slightly too small still works, while one too large does not.
 */
function nameSize(name: string): string {
  const n = name.trim().length;
  if (n <= 12) return "104pt";
  if (n <= 18) return "84pt";
  if (n <= 26) return "66pt";
  if (n <= 36) return "52pt";
  if (n <= 50) return "42pt";
  return "34pt";
}

function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** True when the string has no Arabic letters — then it reads left-to-right. */
function isLatin(text: string): boolean {
  return !/[؀-ۿ]/.test(text);
}

export function WelcomeBoardDocument({ board }: { board: WelcomeBoard }) {
  const { name, subtitle, companyNameAr, companyNameLatin, logoUrl, brandColor, accentColor, fontFamily } = board;

  return (
    <>
      {/* The sheet turns here, not in the PDF layer: offerDocumentToPdf already
          passes preferCSSPageSize, so a landscape board needs no special case
          in the pipeline every other document shares. */}
      <style dangerouslySetInnerHTML={{ __html: "@page{size:A4 landscape;margin:0}html,body{margin:0;padding:0}" }} />
      <div
        style={{
        // A4 LANDSCAPE, full bleed. The PDF is generated with zero margins, so
        // these are the real edges of the paper.
        width: "297mm",
        height: "210mm",
        margin: 0,
        padding: "14mm 16mm",
        boxSizing: "border-box",
        background: "#ffffff",
        fontFamily,
        display: "flex",
        flexDirection: "column",
        // A band of the company's colour down the leading edge: identity that
        // survives being photographed, folded, or seen from the side.
        borderInlineStart: `10mm solid ${brandColor}`,
        position: "relative",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "8mm", minHeight: "26mm" }}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- print pipeline, no loader
          <img src={logoUrl} alt={companyNameLatin} style={{ maxHeight: "24mm", maxWidth: "70mm", objectFit: "contain" }} />
        ) : (
          <span
            style={{
              display: "flex",
              width: "22mm",
              height: "22mm",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "5mm",
              background: brandColor,
              color: "#fff",
              fontSize: "30pt",
              fontWeight: 800,
            }}
          >
            {companyNameAr.trim().charAt(0)}
          </span>
        )}
        <div style={{ textAlign: "start" }}>
          <div style={{ fontSize: "18pt", fontWeight: 800, color: brandColor, lineHeight: 1.2 }}>{companyNameAr}</div>
          {companyNameLatin ? (
            <div style={{ fontSize: "10pt", fontWeight: 500, color: accentColor, letterSpacing: "0.5pt" }}>
              <Ltr>{companyNameLatin}</Ltr>
            </div>
          ) : null}
        </div>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: "6mm",
        }}
      >
        <div
          style={{
            fontSize: "20pt",
            fontWeight: 500,
            color: accentColor,
            letterSpacing: "1pt",
          }}
        >
          أهلاً وسهلاً &nbsp;·&nbsp; <Ltr>WELCOME</Ltr>
        </div>

        <div
          style={{
            fontSize: nameSize(name),
            fontWeight: 800,
            color: brandColor,
            lineHeight: 1.15,
            // A sign is read at an angle: let a long name use the full width
            // rather than hyphenating into something no one can parse at speed.
            maxWidth: "100%",
            wordBreak: "break-word",
            // A Latin name must run left-to-right even on an RTL sheet.
            direction: isLatin(name) ? "ltr" : "rtl",
          }}
        >
          {name}
        </div>

        {subtitle ? (
          <div style={{ fontSize: "22pt", fontWeight: 500, color: "#4a5a56", direction: isLatin(subtitle) ? "ltr" : "rtl" }}>
            {subtitle}
          </div>
        ) : null}
      </main>

      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4mm",
          paddingTop: "6mm",
          borderTop: `0.6mm solid ${accentColor}33`,
          fontSize: "12pt",
          fontWeight: 700,
          color: accentColor,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "3mm",
            height: "3mm",
            borderRadius: "50%",
            background: brandColor,
          }}
        />
        {companyNameAr}
      </footer>
      </div>
    </>
  );
}
