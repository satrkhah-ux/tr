/**
 * «المفاتيح والتوكنات» (the owner, 2026-10-29) — the pure rules: which names
 * may be set from «المطوّر», how a name is shown (its last four characters,
 * never more), and which «الربط الخارجي» check tests it.
 *
 * The allowed names come from «الربط الخارجي» itself (integrations.secret_ref)
 * plus the providers being wired now. Never settable here: what the system
 * needs to start or to read this very vault (the database keys, the vault key,
 * the admin secret) and anything public by design (NEXT_PUBLIC_*).
 */

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

/** the providers being wired now — listed even before «الربط الخارجي» names them */
export const BASE_SECRET_NAMES = [
  "MYFATOORAH_API_KEY",
  "MYFATOORAH_BASE_URL",
  "TAMARA_API_TOKEN",
  "TAMARA_BASE_URL",
  "RESERVATIONS_IMAP_HOST",
  "RESERVATIONS_IMAP_USER",
  "RESERVATIONS_IMAP_PASSWORD",
] as const;

/** the system's own keys — set on the server only, never from a page */
const NEVER = [/^SUPABASE_/, /^NEXT_PUBLIC_/, /^SETTINGS_ENCRYPTION_KEY$/, /^ADMIN_API_SECRET$/, /^DATABASE_URL$/, /^NODE_/, /^PORT$/];

export const isForbiddenName = (name: string) => NEVER.some((re) => re.test(name));

/** «MYFATOORAH_API_KEY / MYFATOORAH_BASE_URL» or «.env: TELETEL_API_TOKEN» → the env names inside */
export function namesInRef(ref: string | null | undefined): string[] {
  return [...new Set((ref ?? "").match(/\b[A-Z][A-Z0-9_]{2,63}\b/g) ?? [])].filter((n) => n.includes("_") && !isForbiddenName(n));
}

export type IntegrationRef = { secret_ref: string | null; check_key: string | null };

/** the names the page lists, each with the check that tests it (from the integration that names it) */
export function allowedSecrets(integrations: IntegrationRef[]): { name: string; checkId: string | null }[] {
  const check = new Map<string, string | null>();
  for (const n of BASE_SECRET_NAMES) check.set(n, n.startsWith("RESERVATIONS_IMAP_") ? "mail_reservations" : null);
  for (const i of integrations) {
    for (const n of namesInRef(i.secret_ref)) if (!check.get(n)) check.set(n, i.check_key ?? check.get(n) ?? null);
  }
  return [...check.entries()].map(([name, checkId]) => ({ name, checkId })).sort((a, b) => a.name.localeCompare(b.name));
}

/** the only part of a value the page ever shows */
export const lastFour = (value: string) => (value.length <= 4 ? "••••" : value.slice(-4));

/** a pasted key: trimmed, one line, not empty, not huge — the value is never logged */
export function cleanSecretValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 4000 || /[\r\n]/.test(v)) return null;
  return v;
}

/** at most `limit` writes per employee in `windowMs` (a mistyped loop, a stolen session) */
export function rateLimited(stamps: number[], nowMs: number, limit = 20, windowMs = 10 * 60_000): { blocked: boolean; next: number[] } {
  const recent = stamps.filter((t) => nowMs - t < windowMs);
  if (recent.length >= limit) return { blocked: true, next: recent };
  return { blocked: false, next: [...recent, nowMs] };
}
