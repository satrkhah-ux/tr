import { FROM_EXT, isPageMessage, onLinkPage, type ExtMessage } from "../../src/lib/ext/protocol";

/**
 * Runs on the system's pages (manifest content_scripts) but answers on the
 * «ربط الإضافة» page only — checked at each message, since the app moves
 * between pages without loading them. It tells the page the extension is here,
 * and passes the token the page minted to the service worker; it never keeps
 * it, and never reads the stored one.
 */
const version = chrome.runtime.getManifest().version;

function post(message: ExtMessage) {
  window.postMessage(message, location.origin);
}

/** The service worker, or null once this script is cut off (the extension was reloaded since the tab opened). */
async function ask<T>(message: unknown): Promise<T | null> {
  try {
    if (!chrome.runtime?.id) return null;
    return ((await chrome.runtime.sendMessage(message)) as T) ?? null;
  } catch {
    return null;
  }
}

async function announce() {
  const status = await ask<{ linked?: boolean }>({ type: "status" });
  post({ source: FROM_EXT, type: "here", version, linked: Boolean(status?.linked) });
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin || !onLinkPage(location.pathname) || !isPageMessage(e.data)) return;
  if (e.data.type === "ping") {
    void announce();
    return;
  }
  void ask<{ ok?: boolean; name?: string }>({ type: "link", token: e.data.token }).then((r) =>
    post(r ? { source: FROM_EXT, type: "linked", ok: Boolean(r.ok), name: r.name } : { source: FROM_EXT, type: "linked", ok: false, reason: "reload" }),
  );
});

if (onLinkPage(location.pathname)) void announce();
