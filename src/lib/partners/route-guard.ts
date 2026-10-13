/**
 * Which screens a PARTNER company's account belongs on — read by the proxy on
 * every request, so pure and dependency-free (no database, no Node APIs).
 */

/**
 * Where a partner may go: its portal, its own files and their documents, the
 * ready offers it resells, its welcome boards (plus the public pages). Every
 * other path — our dashboard, kanban, operations, customers, settings — sends it
 * to /b2b. Keep in step with partnerNavGroups in TraveliunShell.
 */
export const PARTNER_PREFIXES = ["/b2b", "/package-generator", "/offer", "/ready-offers", "/welcome-board"];

export function underAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The partner company this session belongs to, read from the access token's
 * user_metadata — set when the account is issued (partners/registration.ts).
 *
 * A REDIRECT, not a permission: user_metadata is editable by its own user, so
 * this only decides which screen a partner lands on. What a partner can READ is
 * decided by RLS (current_partner_id() over partner_users) and each server
 * action's own check — a partner who strips the field sees the same empty staff
 * pages it saw before this redirect existed.
 */
export function partnerIdFromToken(accessToken: string): string | null {
  try {
    const part = accessToken.split(".")[1] ?? "";
    const bytes = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    // atob gives Latin-1 bytes; the partner's Arabic name in the same payload needs a real UTF-8 decode
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)))) as {
      user_metadata?: { partner_id?: unknown };
    };
    const id = payload.user_metadata?.partner_id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}
