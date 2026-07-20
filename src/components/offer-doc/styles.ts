/**
 * The offer document's complete stylesheet — the SINGLE source of layout for
 * both the on-screen preview and the printed PDF, so "what you see is what
 * prints". No Tailwind dependency: these rules are inlined identically into the
 * preview page and the headless-Chromium print HTML.
 *
 * Font-face is intentionally NOT here — each wrapper supplies its own @font-face
 * (a URL in the browser preview, a base64 data-URI in the PDF) pointing at the
 * SAME Tajawal file, so glyph metrics — and therefore pagination — are identical.
 *
 * ANTI-GAP / PAGE-INDEPENDENCE (the heart of this spec):
 *   - break-inside: avoid on every atomic block (.od-avoid, hotel card, flight
 *     row, service item, terms clause) → a block never splits across two pages.
 *   - break-after: avoid on every heading → no heading stranded at a page bottom.
 *   - orphans/widows: 2 → never one dangling line.
 *   - thead { display: table-header-group } → table headers repeat on each page.
 *   - the ONLY forced break is break-before: page on the Terms section.
 *   - one spacing scale (--sp-*), no fixed heights, no ad-hoc margins → empty
 *     sections are omitted in JSX, so nothing renders as an empty gap.
 *
 * RUNNING FURNITURE (every page carries the brand):
 *   position:fixed elements repeat on EVERY printed page in Chromium, so the
 *   header band, the footer bar and the watermark are painted per page rather
 *   than once in the flow. The page box reserves room for them via @page margins
 *   and .od-body's padding, so content never slides under the furniture.
 *   NOTE: this replaces Chromium's own headerTemplate/footerTemplate (which
 *   cannot render our font/logo reliably) — pdf.ts must print with
 *   displayHeaderFooter:false and margin:0.
 */
export const OFFER_DOC_CSS = `
.od-root{
  --od-green:#185045;--od-ink:#0f3d38;--od-muted:#557d78;--od-line:#dce7e2;--od-soft:#f4f8f6;--od-gold:#a86a10;
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:14px;--sp-5:16px;--sp-6:18px;
  font-family:Tajawal,'Segoe UI',Arial,sans-serif;color:var(--od-ink);background:#fff;
  font-size:12px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.od-root *{box-sizing:border-box;}
.od-root p{margin:0;}
.od-tnum{font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}
.od-root bdi{unicode-bidi:isolate;}

/* ── page geometry: reserve the running header/footer bands ───────────────── */
.od-root{--od-head-h:74px;--od-foot-h:34px;--od-page-x:16px;}
@page{size:A4;margin:0;}
.od-body{padding:calc(var(--od-head-h) + var(--sp-4)) var(--od-page-x) calc(var(--od-foot-h) + var(--sp-4));}
.od-section{margin-top:var(--sp-5);}
.od-section:first-child{margin-top:0;}

/* ── running furniture (repeats on every printed page) ────────────────────── */
.od-fixed-head,.od-fixed-foot{position:fixed;inset-inline:0;z-index:2;}
.od-fixed-head{top:0;height:var(--od-head-h);}
.od-fixed-foot{bottom:0;height:var(--od-foot-h);}
/* subtle page background so no page is ever a bare white sheet */
.od-page-bg{position:fixed;inset:0;z-index:0;background:
  radial-gradient(680px 320px at 108% -8%, rgba(24,80,69,.055), transparent 70%),
  radial-gradient(520px 260px at -10% 104%, rgba(24,80,69,.045), transparent 70%),
  #fff;}
.od-watermark{position:fixed;inset:0;z-index:0;display:flex;align-items:center;justify-content:center;opacity:.045;}
.od-watermark img{width:300px;height:300px;filter:invert(24%) sepia(18%) saturate(1200%) hue-rotate(118deg) brightness(92%);}
.od-body{position:relative;z-index:1;}
.od-h{display:flex;align-items:center;gap:var(--sp-2);font-size:14px;font-weight:800;color:var(--od-green);margin:0 0 var(--sp-3);break-after:avoid;}
.od-h::before{content:"";width:5px;height:16px;border-radius:3px;background:var(--od-green);display:inline-block;flex:0 0 auto;}
.od-avoid{break-inside:avoid;}
.od-root p,.od-root li{orphans:2;widows:2;}
.od-root thead{display:table-header-group;}

/* header band — now the RUNNING header (same visual language as before) */
.od-band{display:flex;justify-content:space-between;align-items:center;height:100%;
  background:linear-gradient(105deg,#0f3d38 0%,var(--od-green) 58%,#1c6252 100%);
  color:#fff;padding:0 var(--od-page-x);box-shadow:0 1px 0 rgba(0,0,0,.08);}
.od-band-id{display:flex;align-items:center;gap:11px;}
.od-band-mark{width:34px;height:34px;flex:0 0 auto;}
.od-band-brand{font-size:19px;font-weight:800;letter-spacing:.2px;line-height:1.15;}
.od-band-sub{font-size:10px;color:#bfe0d6;margin-top:2px;letter-spacing:.3px;}
.od-band-meta{text-align:left;font-size:10px;line-height:1.75;color:#d8ece3;}
.od-band-meta b{color:#fff;font-weight:700;}
/* gold hairline separating the band from the page */
.od-band::after{content:"";position:absolute;inset-inline:0;bottom:0;height:2px;
  background:linear-gradient(90deg,#d9a441,#f0cd7e,#d9a441);}

/* running footer */
.od-foot{display:flex;align-items:center;justify-content:space-between;height:100%;
  padding:0 var(--od-page-x);border-top:1px solid var(--od-line);background:#fff;
  font-size:9.5px;font-weight:600;color:var(--od-muted);}
.od-foot b{color:var(--od-green);font-weight:800;}
/* NOTE: counter(page)/counter(pages) do NOT resolve inside position:fixed in
   Chromium's print engine (they render 0/0). The page number is therefore drawn
   by Chromium's own footerTemplate, which sits in the reserved bottom margin —
   see pdf.ts. This slot only holds the static brand/contact line. */

.od-personal{border:1px solid var(--od-line);border-radius:12px;overflow:hidden;}
.od-dest{background:#eef6f2;padding:var(--sp-4) var(--sp-5);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--od-line);}
.od-dest .k{font-size:11px;font-weight:700;color:var(--od-muted);}
.od-dest .v{font-size:22px;font-weight:800;color:var(--od-green);}
.od-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-3) var(--sp-5);padding:var(--sp-4) var(--sp-5);}
.od-field .k{font-size:10.5px;font-weight:700;color:var(--od-muted);}
.od-field .v{font-size:12.5px;font-weight:700;margin-top:2px;}

.od-chips{display:flex;flex-wrap:wrap;gap:var(--sp-2);}
.od-chip{display:inline-flex;align-items:center;gap:6px;background:var(--od-soft);border:1px solid var(--od-line);border-radius:999px;padding:6px 13px;font-size:11.5px;font-weight:700;break-inside:avoid;}
.od-chip b{color:var(--od-green);}
.od-chip .n{color:var(--od-muted);font-weight:700;}

.od-table{width:100%;border-collapse:collapse;border:1px solid var(--od-line);border-radius:10px;overflow:hidden;}
.od-table th{background:var(--od-green);color:#fff;font-size:10.5px;font-weight:700;padding:8px 10px;text-align:start;white-space:nowrap;}
.od-table td{font-size:11.5px;padding:8px 10px;border-top:1px solid var(--od-line);vertical-align:middle;}
.od-table tbody tr{break-inside:avoid;}
.od-table tbody tr:nth-child(even) td{background:#f8fbf9;}

.od-hotel{break-inside:avoid;border:1px solid var(--od-line);border-radius:12px;padding:var(--sp-3) var(--sp-4);margin-top:var(--sp-2);}
.od-hotel:first-of-type{margin-top:0;}
.od-hotel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sp-3);}
.od-hotel-city{font-size:13px;font-weight:800;color:var(--od-green);}
.od-hotel-name{font-size:12.5px;font-weight:700;margin-top:1px;}
.od-stars{color:#e0a400;font-size:12px;letter-spacing:2px;white-space:nowrap;}
.od-hotel-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:var(--sp-2) var(--sp-3);margin-top:var(--sp-3);}
.od-hotel-cell .k{font-size:9px;font-weight:700;color:var(--od-muted);}
.od-hotel-cell .v{font-size:11px;font-weight:700;margin-top:1px;}
.od-hotel-note{margin-top:var(--sp-2);font-size:10.5px;font-weight:600;color:#2a5f52;line-height:1.5;}
.od-hotel-note b{color:var(--od-green);font-weight:800;}
.od-hotel-img{width:100%;height:150px;object-fit:cover;border-radius:9px;margin-bottom:var(--sp-3);background:#e7f0ec;display:block;}
.od-facil{margin-top:var(--sp-2);font-size:10.5px;font-weight:700;color:#2a5f52;}
.od-facil b{color:var(--od-green);}
.od-facil-chip{display:inline-block;margin:2px 0 0 4px;padding:2px 8px;border-radius:999px;background:#eef6f2;color:#2a5f52;font-weight:700;}
.od-climate{margin-top:var(--sp-3);background:#eef6f2;border-radius:9px;padding:6px 10px;font-size:10.5px;font-weight:600;color:#2a5f52;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;}
.od-climate b{color:var(--od-green);}
.od-climate .t{white-space:nowrap;}

.od-cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-5);}
.od-sub{font-size:12px;font-weight:800;margin:0 0 var(--sp-2);}
.od-sub.yes{color:#0f7a52;}
.od-sub.no{color:#c22850;}
.od-list{list-style:none;margin:0;padding:0;}
.od-list li{break-inside:avoid;display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:11.5px;border-bottom:1px dashed #eaf0ed;}
.od-list li:last-child{border-bottom:0;}
.od-mark.yes{color:#0f7a52;font-weight:800;}
.od-mark.no{color:#c22850;font-weight:800;}

.od-price{break-inside:avoid;background:var(--od-green);color:#fff;border-radius:12px;padding:var(--sp-4) var(--sp-5);display:flex;justify-content:space-between;align-items:center;}
.od-price .label{font-size:13px;font-weight:800;}
.od-price .value{font-size:24px;font-weight:800;}
.od-price .per{font-size:11px;color:#bfe0d6;margin-top:4px;}
.od-pay{margin-top:var(--sp-3);font-size:11px;color:var(--od-muted);line-height:1.9;}

.od-internal-note{margin-bottom:var(--sp-3);font-size:10.5px;font-weight:700;color:var(--od-gold);background:#fff8e8;border:1px solid #f2e2b4;border-radius:8px;padding:7px 11px;}

/* Forced new page for the terms.
   CAVEAT: .od-body's top padding only clears the running header on the FIRST
   page — after a forced break Chromium starts the new page at the page box top,
   so content would slide under the fixed band. The section therefore carries its
   own header-height spacer (::before) that pushes it into the safe area. */
.od-terms{break-before:page;margin-top:0;}
.od-terms::before{content:"";display:block;height:calc(var(--od-head-h) + var(--sp-3));}
.od-clause{break-inside:avoid;display:flex;gap:8px;padding:5px 0;font-size:11px;color:var(--od-muted);line-height:1.8;}
.od-clause .n{font-weight:800;color:var(--od-green);flex:0 0 auto;}
`;
