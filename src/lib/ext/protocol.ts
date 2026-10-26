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

/** The page the extension's linking script answers on. */
export const LINK_PATH = "/extension";

/** That page exactly — never «/extension-x» or «/extensions»; a query or a trailing slash is fine. */
export function onLinkPage(pathname: string): boolean {
  return pathname === LINK_PATH || pathname === `${LINK_PATH}/`;
}
