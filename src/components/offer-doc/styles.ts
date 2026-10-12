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
  /* the rest of the palette: hairlines, washes and shadows. These used to be
     literals scattered through the rules below, which meant a partner's document
     kept OUR faint greens on every card border while its headings turned their
     colour — half-branded, which reads as a mistake. */
  --od-line-3:#edf2f0;--od-tint:#fbfdfc;--od-fill:rgba(246,250,248,.94);
  --od-shadow:rgba(20,54,48,.08);--od-shadow-2:rgba(16,70,60,.06);
  --od-notice-soft:rgba(217,164,65,.12);--od-notice-ink:#5f4b1d;
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
/* Company block on the READING side (right, in Arabic), logo opposite it. The
   logo is held away from the trimmed edge — a mark that touches the paper edge
   reads as a printing accident, and management asked for the gap. */
.od-top{display:grid;grid-template-columns:1.05fr 1fr;gap:10mm;align-items:center;}
.od-logo{width:58mm;max-height:30mm;object-fit:contain;object-position:center;display:block;margin-inline-start:auto;margin-inline-end:8mm;}
/* a partner with no logo file yet: their name, set like a mark */
.od-wordmark{width:58mm;min-height:30mm;display:flex;align-items:center;justify-content:center;
  color:var(--od-green);font-size:19pt;font-weight:800;line-height:1.25;
  margin-inline-start:auto;margin-inline-end:8mm;text-align:center;}
.od-company{border-inline-end:4px solid var(--od-green);padding:2mm 0 2mm 6mm;color:var(--od-green);line-height:1.85;font-size:10.7pt;}
.od-company h2{margin:0 0 1mm;font-size:16.5pt;font-weight:700;line-height:1.3;}
.od-hero{margin-top:19mm;text-align:center;color:var(--od-green);}
.od-hero .od-hero-label{color:var(--od-muted);font-size:13pt;margin-bottom:3mm;}
.od-hero h1{margin:0;font-size:31pt;font-weight:800;line-height:1.15;}
.od-hero .od-hero-meta{margin-top:4mm;color:var(--od-ink);font-size:14pt;font-weight:500;}
.od-metrics{margin-top:17mm;display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;}
.od-metric{background:var(--od-fill);border:1px solid var(--od-line-2);border-radius:5mm;padding:5mm 3mm;text-align:center;min-height:25mm;break-inside:avoid;}
.od-metric span{display:block;color:var(--od-muted);font-size:9.5pt;margin-bottom:2mm;}
.od-metric strong{display:block;color:var(--od-green);font-size:17pt;font-weight:800;}

/* ── panel (client info, quick summary) ───────────────────────────────────── */
.od-panel{margin-top:9mm;border:1px solid var(--od-line);border-radius:5mm;overflow:hidden;background:rgba(255,255,255,.96);box-shadow:0 8px 20px var(--od-shadow);break-inside:avoid;}
.od-panel-head{background:var(--od-green);color:#fff;padding:4mm 5mm;font-size:13pt;font-weight:700;display:flex;justify-content:space-between;}
.od-info{font-size:10.5pt;}
.od-info th,.od-info td{border-top:1px solid var(--od-line-2);padding:4mm;vertical-align:middle;text-align:start;}
.od-info th{color:var(--od-muted);font-weight:500;width:18%;white-space:nowrap;}

/* ── section heading ──────────────────────────────────────────────────────── */
/* Heading centred at the top of the sheet with its note directly beneath it,
   as management asked: the note explains the section, so reading it beside the
   title — on the far side of the page — meant reading it last. */
.od-title{text-align:center;color:var(--od-green);margin:0 0 6mm;padding-bottom:3mm;
  border-bottom:1px solid var(--od-line);break-after:avoid;}
.od-title h2{margin:0;font-size:21pt;font-weight:800;line-height:1.15;}
.od-title small{display:block;margin:2mm auto 0;color:var(--od-muted);font-size:10pt;line-height:1.55;text-align:center;max-width:150mm;}
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
.od-stay{display:grid;grid-template-columns:34mm 1fr;gap:5mm;border:1px solid var(--od-line-2);border-radius:5mm;padding:4mm;margin-bottom:4mm;background:rgba(255,255,255,.96);box-shadow:0 5px 14px var(--od-shadow-2);min-height:37mm;break-inside:avoid;}
.od-datebox{border-radius:4mm;background:var(--od-soft);border:1px solid var(--od-line-2);padding:3mm;text-align:center;color:var(--od-green);font-size:9.2pt;}
.od-datebox strong{display:block;margin:.7mm 0 1.5mm;font-size:10.8pt;font-weight:800;}
.od-hotel h3{margin:0;color:var(--od-green);font-size:13.8pt;line-height:1.35;font-weight:800;}
.od-hotel-top{display:flex;align-items:baseline;flex-wrap:wrap;gap:1mm 3mm;}
.od-hotel-place{color:var(--od-muted)!important;font-size:9.8pt!important;margin:.6mm 0 2.6mm!important;}
.od-tags{display:flex;flex-wrap:wrap;gap:1.6mm;}
.od-tags span{border:1px solid var(--od-line-2);background:var(--od-tint);border-radius:99px;padding:.8mm 3mm;font-size:9.2pt;color:var(--od-ink);line-height:1.4;}
.od-hotel p{margin:0;line-height:1.55;font-size:10.2pt;color:var(--od-ink);}
.od-stars{color:var(--od-gold);direction:ltr;font-size:11.5pt;letter-spacing:.5px;}

/* ── flights: one boarding pass per leg ──────────────────────────────────── */
.od-fl{display:grid;grid-template-columns:1fr 40mm;border:1px solid var(--od-line-2);border-radius:4.5mm;background:#fff;margin-bottom:3.5mm;overflow:hidden;break-inside:avoid;box-shadow:0 6px 16px var(--od-shadow-2);}
.od-fl-head{display:flex;align-items:center;gap:3mm;padding:2.4mm 4.5mm;background:linear-gradient(135deg,var(--od-green),var(--od-green-2));color:#fff;font-size:10pt;}
.od-fl-head .od-carrier{font-weight:700;}
.od-fl-head .od-carrier-logo{background:#fff;border-radius:1.6mm;padding:.5mm 1mm;width:13mm;height:5.6mm;}
.od-fl-leg{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.45);color:#fff;border-radius:99px;padding:.3mm 3.2mm;font-weight:700;font-size:9pt;}
.od-fl-route{display:grid;grid-template-columns:1fr 38mm 1fr;align-items:center;gap:3mm;padding:3.6mm 5mm 3.8mm;}
.od-fl-stub{position:relative;display:grid;align-content:center;gap:2.4mm;padding:3mm 3.5mm;background:var(--od-soft);border-inline-start:1.6px dashed var(--od-line);text-align:center;}
.od-fl-stub::before,.od-fl-stub::after{content:"";position:absolute;inset-inline-start:-2.8mm;width:5mm;height:5mm;border-radius:50%;background:#fff;border:1px solid var(--od-line-2);}
.od-fl-stub::before{top:-2.7mm;}
.od-fl-stub::after{bottom:-2.7mm;}
.od-fl-stub span{display:block;font-size:8pt;color:var(--od-muted);}
.od-fl-stub strong{display:block;font-size:10pt;font-weight:800;color:var(--od-green);line-height:1.35;}
.od-fl-end{display:grid;gap:.3mm;}
.od-fl-end:last-child{text-align:end;}
.od-fl-end strong{font-size:18pt;font-weight:800;color:var(--od-green);line-height:1.05;}
.od-fl-end b{font-size:12.5pt;font-weight:800;color:var(--od-ink);}
.od-fl-end span{font-size:9.2pt;color:var(--od-ink);}
.od-fl-end small{font-size:8.3pt;color:var(--od-muted);line-height:1.3;}
.od-fl-plus{display:inline-block;margin-inline-start:1.5mm;background:#eaf1ff;color:#2b57c4;border-radius:99px;padding:0 1.6mm;font-size:8pt;font-weight:800;vertical-align:middle;}
.od-fl-line{position:relative;height:8mm;display:flex;align-items:center;justify-content:center;}
.od-fl-line::before{content:"";position:absolute;inset-inline:1.4mm;top:50%;border-top:1.6px dashed var(--od-green-2);opacity:.55;}
.od-fl-line::after{content:"";position:absolute;inset-inline:0;top:50%;height:2.6mm;margin-top:-1.3mm;background:radial-gradient(circle,var(--od-green) 45%,transparent 52%) 0 50%/2.6mm 2.6mm no-repeat,radial-gradient(circle,var(--od-green) 45%,transparent 52%) 100% 50%/2.6mm 2.6mm no-repeat;}
.od-fl-line span{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:8mm;height:8mm;border-radius:50%;background:var(--od-soft);border:1px solid var(--od-line-2);color:var(--od-green);font-size:12pt;transform:scaleX(-1);}
.od-notice{margin-top:2mm;border-right:3px solid var(--od-notice);background:var(--od-notice-soft);color:var(--od-notice-ink);padding:2mm 3mm;border-radius:2mm;font-size:9.5pt;}

/* ── data tables (flights, tours, tickets, visas) ─────────────────────────── */
.od-table{border:1px solid var(--od-line);border-radius:4mm;overflow:hidden;background:rgba(255,255,255,.96);font-size:9.8pt;}
.od-table th{background:var(--od-green);color:#fff;padding:4mm 3mm;font-size:10.8pt;font-weight:700;white-space:nowrap;text-align:start;}
.od-table td{border-top:1px solid var(--od-line-2);border-left:1px solid var(--od-line-2);padding:3.2mm;vertical-align:middle;line-height:1.45;}
.od-table td:last-child{border-left:0;}
.od-table tbody tr{break-inside:avoid;}
/* carrier cell: the mark, then the name. The logo is height-capped so a tall one
   cannot stretch the row and push the table onto another sheet. */
.od-carrier{display:flex;align-items:center;gap:2.5mm;}
.od-carrier-logo{width:14mm;height:6mm;object-fit:contain;object-position:center;flex:0 0 auto;}
.od-route{color:var(--od-green);font-weight:800;display:block;margin-bottom:1mm;}
.od-day-move{display:block;margin-top:1mm;font-weight:700;}
.od-day-move::before{content:"🚐 ";}
.od-sub{display:block;margin-top:1mm;color:var(--od-muted);font-size:8.8pt;}
.od-note{margin-top:6mm;border:1px solid var(--od-line);border-radius:4mm;background:var(--od-fill);padding:4mm 5mm;color:var(--od-muted);font-size:10.5pt;break-inside:avoid;}
.od-strip{margin-top:6mm;display:grid;grid-template-columns:1fr 38mm;border:1px solid var(--od-line);border-radius:4mm;overflow:hidden;background:#fff;font-size:11pt;break-inside:avoid;}
.od-strip div{padding:5mm;}
.od-strip .od-strip-label{background:var(--od-green);color:#fff;font-weight:700;text-align:center;}

/* ── services / price ─────────────────────────────────────────────────────── */
.od-two{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin-top:7mm;}
.od-listcard{border:1px solid var(--od-line-2);border-radius:5mm;overflow:hidden;background:rgba(255,255,255,.96);min-height:70mm;}
.od-listcard h3{margin:0;background:var(--od-green);color:#fff;padding:4.5mm;font-size:14pt;font-weight:700;text-align:center;}
.od-listcard ul{list-style:none;margin:0;padding:3mm 5mm 5mm;font-size:10.5pt;line-height:1.75;}
.od-listcard li{border-bottom:1px solid var(--od-line-3);padding:1.9mm 0;break-inside:avoid;}
.od-listcard li:last-child{border-bottom:0;}
.od-price{margin-top:9mm;border-radius:6mm;padding:7mm;background:linear-gradient(90deg,var(--od-green),var(--od-green-2));color:#fff;display:flex;align-items:center;justify-content:space-between;box-shadow:0 10px 22px rgba(19,85,73,.18);break-inside:avoid;}
.od-price span{font-size:13pt;font-weight:500;}
.od-price strong{font-size:23pt;font-weight:800;}

/* ── terms ────────────────────────────────────────────────────────────────── */
.od-terms{border:1px solid var(--od-line);border-radius:5mm;overflow:hidden;background:rgba(255,255,255,.97);}
.od-terms h2{margin:0;background:var(--od-green);color:#fff;text-align:center;padding:4mm;font-size:15pt;font-weight:700;break-after:avoid;}
.od-terms ol{margin:0;padding:3mm 9mm 3mm 4mm;font-size:9.35pt;line-height:1.58;}
.od-terms li{padding:2mm 0;border-bottom:1px solid var(--od-line-3);break-inside:avoid;}
.od-terms li:last-child{border-bottom:0;}

/* ── internal-only pricing (never in the client tree) ─────────────────────── */
.od-internal-note{margin-bottom:5mm;font-size:10.5pt;font-weight:700;color:#a86a10;background:#fff8e8;border:1px solid #f2e2b4;border-radius:3mm;padding:3mm 4mm;}
`;
