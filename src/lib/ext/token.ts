import { createHash, randomBytes } from "node:crypto";

/**
 * «ربط الإضافة»: the token one device of the staff browser extension carries.
 * 32 random bytes, base64url — shown to the extension once; the database keeps
 * only its sha256 (extension_links.token_hash), so a leaked table is no key.
 */
export const LINK_DAYS = 30;
/** a device more than this per employee: the oldest has to be revoked first */
export const MAX_LINKS = 5;

/** What a link may do — always narrowed by the employee's own permissions on each request. */
export const EXT_SCOPES = ["panel", "notify", "prices"] as const;
export type ExtScope = (typeof EXT_SCOPES)[number];

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** «Authorization: Bearer …» → the token, or null for anything that cannot be one. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

export type LinkRow = { expires_at: string; revoked_at: string | null };

/** Usable now: not revoked, not expired. */
export function linkUsable(link: LinkRow, now = Date.now()): boolean {
  return !link.revoked_at && Date.parse(link.expires_at) > now;
}

/** «كروم — ويندوز» from the browser's own words, for the devices list. */
export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? "إيدج" : /OPR\//.test(userAgent) ? "أوبرا" : /Chrome\//.test(userAgent) ? "كروم" : "متصفح";
  const os = /Windows/.test(userAgent) ? "ويندوز" : /Mac OS X/.test(userAgent) ? "ماك" : /Android/.test(userAgent) ? "أندرويد" : /Linux/.test(userAgent) ? "لينكس" : "";
  return os ? `${browser} — ${os}` : browser;
}
