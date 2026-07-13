/**
 * Shared Supabase configuration. Keys are read from the environment only.
 * The auth session is persisted under a cookie (not localStorage) so the
 * Next.js middleware and server components can read it — this replaces the
 * role normally played by @supabase/ssr, which we intentionally do not add.
 */

/** Cookie/storage key that holds the serialized Supabase session. */
export const AUTH_STORAGE_KEY = "traveliun-auth";

/** Session cookie lifetime (7 days). Access tokens still auto-refresh. */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).",
    );
  }

  return { url, anonKey };
}

/** Extracts `access_token` / `expires_at` from a serialized session cookie value. */
export function parseSessionCookie(
  raw: string | undefined,
): { accessToken: string; refreshToken: string | null; expiresAt: number | null } | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const session = JSON.parse(decoded) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };
    if (!session.access_token) return null;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? null,
      expiresAt: typeof session.expires_at === "number" ? session.expires_at : null,
    };
  } catch {
    return null;
  }
}
