import "server-only";
import type { ReactNode } from "react";
import { OfferDocument, type OfferDocumentProps } from "@/components/offer-doc/OfferDocument";
import type { OfferDocAssets } from "@/components/offer-doc/assets";
import { inlineImage, loadOfferDocAssets } from "./assets";
import { fontFaceCss, loadTajawalBase64 } from "./fonts";

/**
 * Render the offer document to a complete, self-contained HTML page for headless
 * Chromium. The fonts AND the two images (logo, world map) are embedded as
 * base64 so `setContent` needs no network and no base URL, and the body is
 * EXACTLY the same <OfferDocument> the on-screen preview renders → the printed
 * PDF and the preview are the same layout.
 */
export async function renderOfferDocumentHtml(props: OfferDocumentProps): Promise<string> {
  // A partner's logo is a storage URL. Inline it HERE rather than at each call
  // site, so no print path can ship a document whose cover logo is a broken box.
  const remote = props.brand?.logoUrl ?? null;
  const brand = remote ? { ...props.brand!, logoUrl: (await inlineImage(remote)) ?? null } : props.brand;
  return renderDocHtml((assets) => <OfferDocument {...props} brand={brand} assets={assets} />);
}

/**
 * The generic renderer — the fonts, the assets and the print CSS reset that make
 * a Traveliun document a Traveliun document. Extracted so a voucher gets the
 * identical treatment without duplicating any of it: same embedded fonts, same
 * zero-margin sheet handling, same guarantee that preview equals print.
 */
export async function renderDocHtml(build: (assets: OfferDocAssets) => ReactNode): Promise<string> {
  // Dynamic import: react-dom/server is a Node-only concern for this print
  // pipeline, and a static import trips Next's RSC guard.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const [faces, assets] = await Promise.all([loadTajawalBase64(), loadOfferDocAssets()]);
  const body = renderToStaticMarkup(build(assets));
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
${fontFaceCss(faces)}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
/* the document paints its own A4 sheets — no page shadows or grey gutter in print */
.od-root{background:#fff !important;padding:0 !important;}
.od-page{margin:0 !important;box-shadow:none !important;}
</style>
</head>
<body>${body}</body>
</html>`;
}
