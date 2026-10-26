import { BASE } from "./config";

/**
 * The extension's one door to the system: /api/ext/* with this device's token.
 * Only the service worker and the extension's own pages call it — never a script
 * inside Teletel or a hotel site. No cookie goes with it (credentials: "omit"):
 * the staff session in the tab is left alone.
 */
export type Me = { ok: true; name: string; scopes: string[]; can: { offers: boolean; clients: boolean; operations: boolean } };
export type Fail = { ok: false; error: string };

export async function token(): Promise<string | null> {
  const { token } = await chrome.storage.local.get("token");
  return typeof token === "string" ? token : null;
}

async function call<T extends { ok: true }>(method: "GET" | "POST", path: string, withToken?: string, body?: unknown): Promise<T | Fail> {
  const t = withToken ?? (await token());
  if (!t) return { ok: false, error: "unlinked" };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
    });
    const out = (await res.json().catch(() => null)) as T | Fail | null;
    // revoked or expired on /extension — only the server saying so, never a server that could not answer
    if (res.status === 401 && out && !out.ok && out.error === "unlinked" && !withToken) await chrome.storage.local.remove(["token", "name"]);
    return out ?? { ok: false, error: `http_${res.status}` };
  } catch {
    return { ok: false, error: "offline" };
  }
}

export const apiGet = <T extends { ok: true }>(path: string, withToken?: string) => call<T>("GET", path, withToken);
export const apiPost = <T extends { ok: true }>(path: string, body?: unknown, withToken?: string) => call<T>("POST", path, withToken, body ?? {});
