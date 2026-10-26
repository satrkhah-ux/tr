/**
 * The words /extension (the «ربط الإضافة» page) and the extension's script on
 * that page say to each other through window.postMessage — one file, imported
 * by both (extension/src/link.ts bundles it), so neither can drift.
 *
 * The page never needs the extension's id (Chrome's and Edge's differ, a
 * developer build has a third): the extension declares a content script on
 * this one page, and only on our own origin.
 */
export const FROM_PAGE = "tv-page";
export const FROM_EXT = "tv-ext";

export type PageMessage = { source: typeof FROM_PAGE; type: "ping" } | { source: typeof FROM_PAGE; type: "link"; token: string };

export type ExtMessage =
  | { source: typeof FROM_EXT; type: "here"; version: string; linked: boolean }
  // reason «reload»: the extension was reloaded or updated since this tab opened — its script here is cut off
  | { source: typeof FROM_EXT; type: "linked"; ok: boolean; name?: string; reason?: "reload" };

export function isExtMessage(data: unknown): data is ExtMessage {
  return typeof data === "object" && data !== null && (data as { source?: unknown }).source === FROM_EXT;
}

export function isPageMessage(data: unknown): data is PageMessage {
  const d = data as { source?: unknown; type?: unknown; token?: unknown } | null;
  return (
    typeof d === "object" &&
    d !== null &&
    d.source === FROM_PAGE &&
    (d.type === "ping" || (d.type === "link" && typeof d.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(d.token)))
  );
}

/**
 * «قارن» → the extension: which proposal stay a compare link was opened for, in
 * the link's fragment (#tvctx=…) — a fragment never reaches the site's server.
 * The extension keeps it for that tab, since a site drops it on the way from its
 * results to the hotel's page.
 */
export type CompareContext = { v: 1; d: string; c: string };

export function withTvctx(url: string, ctx: { draftId: string; cityKey: string }): string {
  const json = JSON.stringify({ v: 1, d: ctx.draftId, c: ctx.cityKey } satisfies CompareContext);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${url.split("#")[0]}#tvctx=${b64}`;
}

export function readTvctx(hash: string): CompareContext | null {
  const m = /(?:^#|&)tvctx=([A-Za-z0-9_-]{8,400})/.exec(hash);
  if (!m) return null;
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));
    const v = JSON.parse(json) as Partial<CompareContext>;
    return v?.v === 1 && typeof v.d === "string" && /^[0-9a-f-]{36}$/i.test(v.d) && typeof v.c === "string" && v.c.length > 0 && v.c.length <= 60 ? { v: 1, d: v.d, c: v.c } : null;
  } catch {
    return null;
  }
}

/** The page the extension's linking script answers on. */
export const LINK_PATH = "/extension";

/** That page exactly — never «/extension-x» or «/extensions»; a query or a trailing slash is fine. */
export function onLinkPage(pathname: string): boolean {
  return pathname === LINK_PATH || pathname === `${LINK_PATH}/`;
}
