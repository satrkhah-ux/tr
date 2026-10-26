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

type Incoming = { type: "link"; token: string } | { type: "status" } | { type: "unlink" };

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
