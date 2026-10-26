import { apiGet, apiPost, token, type Me } from "./api";
import { BASE } from "./config";
import { onLinkPage } from "../../src/lib/ext/protocol";

/**
 * The extension's background: it alone holds the device token and talks to the
 * system. The token stays out of reach of every script running inside a web
 * page (storage access: trusted contexts only).
 */
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
// the toolbar button opens the popup; the popup opens the side panel
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

type Incoming =
  | { type: "link"; token: string }
  | { type: "status" }
  | { type: "unlink" }
  | { type: "ctx"; ctx: unknown }
  | { type: "capture"; data: Record<string, unknown> };

/** the hotel sites the capture button runs on (manifest content_scripts) */
const HOTEL_SITES = /^(www\.)?(agoda|booking|almosafer)\.com$/;
function fromHotelSite(sender: chrome.runtime.MessageSender): number | null {
  try {
    return sender.tab?.id !== undefined && sender.frameId === 0 && HOTEL_SITES.test(new URL(sender.tab.url ?? sender.url ?? "").hostname) ? sender.tab.id : null;
  } catch {
    return null;
  }
}
const short = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** only our own «ربط الإضافة» page, exactly */
function fromLinkPage(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? "");
    return u.origin === BASE && onLinkPage(u.pathname);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg: Incoming, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.type === "link") {
    // the tab's address as it is now (the app moves between pages without loading them; sender.url keeps the
    // first one), and its top frame only
    if (sender.frameId !== 0 || !fromLinkPage(sender.tab?.url ?? sender.url) || typeof msg.token !== "string") {
      reply({ ok: false });
      return false;
    }
    void (async () => {
      const me = await apiGet<Me>("/api/ext/me", msg.token);
      if (!me.ok) return reply({ ok: false });
      const before = await token();
      await chrome.storage.local.set({ token: msg.token, name: me.name });
      // linked again on this device: the link it held before is revoked, never left live
      if (before && before !== msg.token) await apiPost("/api/ext/unlink", undefined, before);
      reply({ ok: true, name: me.name });
    })();
    return true;
  }
  // «قارن» opened this tab for a proposal's stay: kept for the tab (session storage — gone with the browser)
  if (msg?.type === "ctx") {
    const tabId = fromHotelSite(sender);
    const c = msg.ctx as { v?: unknown; d?: unknown; c?: unknown } | null;
    if (tabId !== null && c?.v === 1 && typeof c.d === "string" && /^[0-9a-f-]{36}$/i.test(c.d) && typeof c.c === "string" && c.c.length <= 60) {
      void chrome.storage.session.set({ [`ctx:${tabId}`]: { v: 1, d: c.d, c: c.c } });
    }
    return false;
  }
  // «أرسل السعر إلى الملف»: what the employee captured, to the side panel's form (nothing is sent from here)
  if (msg?.type === "capture") {
    const tabId = fromHotelSite(sender);
    if (tabId === null) return false;
    // first, while the press still counts as the user's: the panel beside the page (a popup window has none —
    // the panel open in the system's window shows the capture instead)
    const opening = chrome.sidePanel.open({ tabId }).then(
      () => true,
      () => false,
    );
    const d = msg.data ?? {};
    const nights = Number(d.nights);
    void (async () => {
      const ctx = (await chrome.storage.session.get(`ctx:${tabId}`))[`ctx:${tabId}`] ?? null;
      await chrome.storage.session.set({
        [`cap:${tabId}`]: {
          site: short(d.site, 30),
          hotel: short(d.hotel, 150),
          priceText: short(d.priceText, 200),
          fromSelection: d.fromSelection === true,
          checkIn: day(d.checkIn),
          checkOut: day(d.checkOut),
          nights: Number.isInteger(nights) && nights > 0 && nights < 100 ? nights : null,
          page: short(d.page, 300),
          ctx,
          at: Date.now(),
        },
      });
      reply({ opened: await opening });
    })();
    return true;
  }
  if (msg?.type === "status") {
    void token().then((t) => reply({ linked: Boolean(t) }));
    return true;
  }
  if (msg?.type === "unlink") {
    // revoked on the server first, then forgotten here
    void (async () => {
      await apiPost("/api/ext/unlink");
      await chrome.storage.local.remove(["token", "name"]);
      reply({ ok: true });
    })();
    return true;
  }
  return false;
});

// a closed tab's capture and context go with it
chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove([`ctx:${tabId}`, `cap:${tabId}`]));
