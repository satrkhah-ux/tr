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

.od-body{padding:0 var(--sp-5) var(--sp-5);}
.od-section{margin-top:var(--sp-5);}
.od-section:first-child{margin-top:var(--sp-4);}
.od-h{display:flex;align-items:center;gap:var(--sp-2);font-size:14px;font-weight:800;color:var(--od-green);margin:0 0 var(--sp-3);break-after:avoid;}
.od-h::before{content:"";width:5px;height:16px;border-radius:3px;background:var(--od-green);display:inline-block;flex:0 0 auto;}
.od-avoid{break-inside:avoid;}
.od-root p,.od-root li{orphans:2;widows:2;}
.od-root thead{display:table-header-group;}

.od-band{display:flex;justify-content:space-between;align-items:center;background:var(--od-green);color:#fff;padding:var(--sp-4) var(--sp-5);}
.od-band-brand{font-size:22px;font-weight:800;letter-spacing:.2px;}
.od-band-sub{font-size:11px;color:#bfe0d6;margin-top:3px;}
.od-band-meta{text-align:left;font-size:11px;line-height:1.95;}
.od-band-meta b{color:#eaf7f0;font-weight:700;}

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

.od-terms{break-before:page;}
.od-clause{break-inside:avoid;display:flex;gap:8px;padding:5px 0;font-size:11px;color:var(--od-muted);line-height:1.8;}
.od-clause .n{font-weight:800;color:var(--od-green);flex:0 0 auto;}
`;
