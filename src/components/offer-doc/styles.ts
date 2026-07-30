/**
 * The offer document's complete stylesheet — the SINGLE source of layout for
 * both the on-screen preview and the printed PDF, so "what you see is what
 * prints". No Tailwind dependency: these rules are inlined identically into the
 * preview page and the headless-Chromium print HTML.
 *
 * Font-face is intentionally NOT here — each wrapper supplies its own @font-face
 * (URLs in the browser preview, base64 data-URIs in the PDF) pointing at the
 * SAME Tajawal files, so glyph metrics — and therefore pagination — are identical.
 *
 * PAGE MODEL (the heart of this spec):
 *   The document is a sequence of explicit A4 `.od-page` blocks, one per
 *   section, each ending in `break-after: page`. Sections never bleed into one
 *   another and every page carries the world-map identity, so the layout is
 *   predictable instead of being whatever the flow happens to produce.
 *
 *   `min-height` (not `height`) + no `overflow:hidden`: a page that receives
 *   more content than fits GROWS and Chromium continues it onto a following
 *   sheet — content is never silently clipped. The absolutely-positioned map
 *   covers the grown block too. Sections that can be arbitrarily long (stays,
 *   terms) are additionally chunked in the component.
 *
 *   Atomic blocks (`break-inside: avoid` on cards, rows, list items, clauses)
 *   plus orphans/widows:2 and a repeating `thead` keep any continuation clean.
 */
export const OFFER_DOC_CSS = `
.od-root{
  --od-green:#135549;--od-green-2:#1f7667;--od-ink:#263633;--od-muted:#6b7c78;
  --od-line:#c8dad6;--od-line-2:#d7e4e0;--od-soft:#eef6f3;--od-gold:#f0ad22;--od-notice:#d9a441;
  --od-pad:13mm;
  font-family:Tajawal,'Segoe UI',Arial,sans-serif;color:var(--od-ink);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.od-root *{box-sizing:border-box;}
.od-root p,.od-root h1,.od-root h2,.od-root h3{margin-top:0;}
.od-root table{width:100%;border-collapse:collapse;}
.od-root bdi{unicode-bidi:isolate;}
.od-tnum{font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}
.od-root p,.od-root li{orphans:2;widows:2;}
.od-root thead{display:table-header-group;}

/* ── the page ─────────────────────────────────────────────────────────────── */
@page{size:A4;margin:0;}
.od-page{
  position:relative;width:210mm;min-height:297mm;padding:var(--od-pad);
  background:#fff;break-after:page;
}
.od-page:last-child{break-after:auto;}
/* world map — full-bleed identity on every page, lighter on the cover so the
   hero text stays crisp */
.od-page::before{
  content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
  background:var(--od-map,none) center center / cover no-repeat;opacity:.72;
}
.od-page.od-cover::before{opacity:.42;}
.od-page > *{position:relative;z-index:1;}
/* closing rule above the per-page footer */
.od-page::after{
  content:"";position:absolute;inset-inline:var(--od-pad);bottom:8mm;z-index:2;
  border-bottom:1.5px solid var(--od-green);
}
.od-foot{
  position:absolute;inset-inline:var(--od-pad);bottom:10mm;z-index:3;direction:ltr;
  display:flex;justify-content:space-between;color:var(--od-muted);font-size:8.5pt;
}

/* on screen the pages stack as separate sheets; print ignores all of this */
@media screen{
  .od-root{background:#f5f7f4;padding:10px 0;}
  .od-page{margin:0 auto 12px;box-shadow:0 6px 22px rgba(20,54,48,.14);}
}

/* ── cover ────────────────────────────────────────────────────────────────── */
.od-top{display:grid;grid-template-columns:1fr 1.05fr;gap:12mm;align-items:start;}
.od-logo{width:62mm;max-height:32mm;object-fit:contain;object-position:right center;display:block;}
/* a partner with no logo file yet: their name, set like a mark */
.od-wordmark{width:62mm;min-height:32mm;display:flex;align-items:center;color:var(--od-green);
  font-size:19pt;font-weight:800;line-height:1.25;}
.od-company{border-right:4px solid var(--od-green);padding:2mm 5mm 2mm 0;color:var(--od-green);line-height:1.85;font-size:10.7pt;}
.od-company h2{margin:0 0 1mm;font-size:16.5pt;font-weight:700;line-height:1.3;}
.od-hero{margin-top:19mm;text-align:center;color:var(--od-green);}
.od-hero .od-hero-label{color:var(--od-muted);font-size:13pt;margin-bottom:3mm;}
.od-hero h1{margin:0;font-size:31pt;font-weight:800;line-height:1.15;}
.od-hero .od-hero-meta{margin-top:4mm;color:#34423f;font-size:14pt;font-weight:500;}
.od-metrics{margin-top:17mm;display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;}
.od-metric{background:rgba(246,250,248,.94);border:1px solid #d8e4e1;border-radius:5mm;padding:5mm 3mm;text-align:center;min-height:25mm;break-inside:avoid;}
.od-metric span{display:block;color:var(--od-muted);font-size:9.5pt;margin-bottom:2mm;}
.od-metric strong{display:block;color:var(--od-green);font-size:17pt;font-weight:800;}

/* ── panel (client info, quick summary) ───────────────────────────────────── */
.od-panel{margin-top:9mm;border:1px solid #adc4bf;border-radius:5mm;overflow:hidden;background:rgba(255,255,255,.96);box-shadow:0 8px 20px rgba(20,54,48,.08);break-inside:avoid;}
.od-panel-head{background:var(--od-green);color:#fff;padding:4mm 5mm;font-size:13pt;font-weight:700;display:flex;justify-content:space-between;}
.od-info{font-size:10.5pt;}
.od-info th,.od-info td{border-top:1px solid var(--od-line-2);padding:4mm;vertical-align:middle;text-align:start;}
.od-info th{color:#687a75;font-weight:500;width:18%;white-space:nowrap;}

/* ── section heading ──────────────────────────────────────────────────────── */
.od-title{display:flex;align-items:flex-start;justify-content:space-between;gap:8mm;color:var(--od-green);margin-bottom:6mm;break-after:avoid;}
.od-title h2{margin:0;font-size:21pt;font-weight:800;line-height:1.1;}
.od-title small{color:var(--od-muted);font-size:10pt;line-height:1.5;text-align:left;max-width:68mm;}
/* a block heading inside a page that carries more than one table */
.od-subhead{display:flex;align-items:center;gap:2.5mm;color:var(--od-green);font-size:13pt;font-weight:700;margin:7mm 0 3mm;break-after:avoid;}
.od-subhead:first-of-type{margin-top:0;}
.od-subhead::before{content:"";width:1.3mm;height:5mm;border-radius:1mm;background:var(--od-green);flex:0 0 auto;}
/* a full section that starts partway down a shared sheet */
.od-subhead-major{font-size:16pt;font-weight:800;margin:9mm 0 4mm;}
.od-subhead-major::before{height:7mm;width:1.6mm;}
/* one section's run of blocks on a sheet */
.od-run + .od-run{margin-top:0;}

/* ── stays ────────────────────────────────────────────────────────────────── */
.od-stay{display:grid;grid-template-columns:34mm 1fr 43mm;gap:5mm;border:1px solid #d1dfdc;border-radius:5mm;padding:4mm;margin-bottom:4mm;background:rgba(255,255,255,.96);box-shadow:0 5px 14px rgba(16,70,60,.06);min-height:37mm;break-inside:avoid;}
.od-datebox{border-radius:4mm;background:var(--od-soft);border:1px solid #d4e4df;padding:3mm;text-align:center;color:var(--od-green);font-size:9.2pt;}
.od-datebox strong{display:block;margin:.7mm 0 1.5mm;font-size:10.8pt;font-weight:800;}
.od-hotel h3{margin:0 0 2mm;color:var(--od-green);font-size:13.3pt;line-height:1.35;font-weight:800;}
.od-hotel p{margin:0;line-height:1.55;font-size:10.2pt;color:#34423f;}
.od-stars{color:var(--od-gold);margin-top:1mm;direction:ltr;font-size:12pt;}
.od-rooms{display:grid;gap:2mm;align-content:start;}
.od-room{border:1px solid #dce7e4;border-radius:3mm;padding:2.4mm;background:#fbfdfc;font-size:8.6pt;line-height:1.45;}
.od-room strong{color:var(--od-green);display:block;margin-bottom:1mm;font-weight:700;}
.od-counts{display:flex;justify-content:space-between;gap:1.5mm;color:#53615e;white-space:nowrap;}
.od-notice{margin-top:2mm;border-right:3px solid var(--od-notice);background:rgba(217,164,65,.12);color:#5f4b1d;padding:2mm 3mm;border-radius:2mm;font-size:9.5pt;}

/* ── data tables (flights, tours, tickets, visas) ─────────────────────────── */
.od-table{border:1px solid var(--od-line);border-radius:4mm;overflow:hidden;background:rgba(255,255,255,.96);font-size:9.8pt;}
.od-table th{background:var(--od-green);color:#fff;padding:4mm 3mm;font-size:10.8pt;font-weight:700;white-space:nowrap;text-align:start;}
.od-table td{border-top:1px solid var(--od-line-2);border-left:1px solid var(--od-line-2);padding:3.2mm;vertical-align:middle;line-height:1.45;}
.od-table td:last-child{border-left:0;}
.od-table tbody tr{break-inside:avoid;}
.od-route{color:var(--od-green);font-weight:800;display:block;margin-bottom:1mm;}
.od-sub{display:block;margin-top:1mm;color:var(--od-muted);font-size:8.8pt;}
.od-note{margin-top:6mm;border:1px solid var(--od-line);border-radius:4mm;background:rgba(246,250,248,.94);padding:4mm 5mm;color:#53615e;font-size:10.5pt;break-inside:avoid;}
.od-strip{margin-top:6mm;display:grid;grid-template-columns:1fr 38mm;border:1px solid var(--od-line);border-radius:4mm;overflow:hidden;background:#fff;font-size:11pt;break-inside:avoid;}
.od-strip div{padding:5mm;}
.od-strip .od-strip-label{background:var(--od-green);color:#fff;font-weight:700;text-align:center;}

/* ── services / price ─────────────────────────────────────────────────────── */
.od-two{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin-top:7mm;}
.od-listcard{border:1px solid #d1dfdc;border-radius:5mm;overflow:hidden;background:rgba(255,255,255,.96);min-height:70mm;}
.od-listcard h3{margin:0;background:var(--od-green);color:#fff;padding:4.5mm;font-size:14pt;font-weight:700;text-align:center;}
.od-listcard ul{list-style:none;margin:0;padding:3mm 5mm 5mm;font-size:10.5pt;line-height:1.75;}
.od-listcard li{border-bottom:1px solid #edf2f0;padding:1.9mm 0;break-inside:avoid;}
.od-listcard li:last-child{border-bottom:0;}
.od-price{margin-top:9mm;border-radius:6mm;padding:7mm;background:linear-gradient(90deg,var(--od-green),var(--od-green-2));color:#fff;display:flex;align-items:center;justify-content:space-between;box-shadow:0 10px 22px rgba(19,85,73,.18);break-inside:avoid;}
.od-price span{font-size:13pt;font-weight:500;}
.od-price strong{font-size:23pt;font-weight:800;}

/* ── terms ────────────────────────────────────────────────────────────────── */
.od-terms{border:1px solid var(--od-line);border-radius:5mm;overflow:hidden;background:rgba(255,255,255,.97);}
.od-terms h2{margin:0;background:var(--od-green);color:#fff;text-align:center;padding:4mm;font-size:15pt;font-weight:700;break-after:avoid;}
.od-terms ol{margin:0;padding:3mm 9mm 3mm 4mm;font-size:9.35pt;line-height:1.58;}
.od-terms li{padding:2mm 0;border-bottom:1px solid #edf2f0;break-inside:avoid;}
.od-terms li:last-child{border-bottom:0;}

/* ── internal-only pricing (never in the client tree) ─────────────────────── */
.od-internal-note{margin-bottom:5mm;font-size:10.5pt;font-weight:700;color:#a86a10;background:#fff8e8;border:1px solid #f2e2b4;border-radius:3mm;padding:3mm 4mm;}
`;
