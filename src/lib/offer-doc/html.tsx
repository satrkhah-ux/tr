import "server-only";
import { OfferDocument, type OfferDocumentProps } from "@/components/offer-doc/OfferDocument";
import { fontFaceCss, loadTajawalBase64 } from "./fonts";

/**
 * Render the offer document to a complete, self-contained HTML page for headless
 * Chromium. The font is embedded (base64) so setContent needs no network, and the
 * body is EXACTLY the same <OfferDocument> the on-screen preview renders → the
 * printed PDF and the preview are the same layout.
 */
export async function renderOfferDocumentHtml(props: OfferDocumentProps): Promise<string> {
  // Dynamic import: react-dom/server is a Node-only concern for this print
  // pipeline, and a static import trips Next's RSC guard.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const fonts = await loadTajawalBase64();
  const body = renderToStaticMarkup(<OfferDocument {...props} />);
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
${fontFaceCss(fonts)}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
</style>
</head>
<body>${body}</body>
</html>`;
}
