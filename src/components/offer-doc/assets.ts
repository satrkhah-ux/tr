/**
 * Image assets the offer document draws: the company logo and the world-map
 * page background.
 *
 * Pure module (no `server-only`) so both the client preview and the print
 * pipeline can import the type. On screen the defaults below are served from
 * /public; for the PDF, lib/offer-doc/assets.ts swaps in base64 data URIs
 * because Chromium prints with no base URL and no network.
 */
export type OfferDocAssets = {
  logoUrl: string;
  mapUrl: string;
};

export const DEFAULT_OFFER_DOC_ASSETS: OfferDocAssets = {
  logoUrl: "/traveliun/offer-logo.png",
  mapUrl: "/traveliun/world-map.png",
};
