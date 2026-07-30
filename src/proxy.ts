import { NextResponse, type NextRequest } from "next/server";
import { AUTH_STORAGE_KEY, parseSessionCookie } from "@/lib/supabase/constants";

/**
 * Auth gate (Next 16 `proxy` convention — successor to `middleware`).
 * Unauthenticated visitors to protected routes are redirected to /sign-in;
 * authenticated visitors to the login screens are sent to /dashboard.
 *
 * Presence of a valid session cookie is the signal — token *validation* (and
 * refresh) happens in the browser client and in server components via
 * `getServerUser()`. This avoids bouncing users whose short-lived access token
 * expired but who still hold a refresh token.
 */

// `/voucher` is public in the same sense `/client-offer` is: the traveller who
// holds the link is not a system user. It is NOT unguarded — the route handler
// validates a 24-byte token and a revoked_at through the service role, because
// RLS cannot see a URL. A session check here would simply lock the traveller out
// of the document they were handed.
// `/api/telegram` is a WEBHOOK target: Telegram posts to it with no cookie and
// follows no redirect, so guarding it would not protect anything — it would just
// send every update into a 307 and the bot would answer nothing. Each webhook
// route authenticates its own caller instead (shared secret + resolving the
// Telegram account to an employee).
const PUBLIC_PREFIXES = ["/sign-in", "/client-offer", "/voucher", "/trip", "/tg", "/api/telegram"];
const LOGIN_PATHS = new Set(["/", "/sign-in"]);

function isPublic(pathname: string): boolean {
  if (LOGIN_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function proxy(request: NextRequest) {
  // FAIL-SAFE: this runs on the hosting edge for every page view. If anything
  // in here ever throws, visitors would get the host's "edge function crashed"
  // page — so on error we fail OPEN and serve the request. That only skips the
  // redirect convenience: every page/action still verifies the session
  // server-side (getServerUser + role checks), so content stays protected.
  try {
    const { pathname } = request.nextUrl;
    const session = parseSessionCookie(request.cookies.get(AUTH_STORAGE_KEY)?.value);
    const isAuthed = session !== null;

    // Logged-in users shouldn't see the login screens. The main dashboard now
    // embeds the executive overview for roles that hold pricing.internal.
    if (isAuthed && LOGIN_PATHS.has(pathname)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Everything that isn't public requires a session.
    if (!isAuthed && !isPublic(pathname)) {
      const redirectUrl = new URL("/sign-in", request.url);
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Run on all routes except Next internals and static assets. The PWA manifest
  // must stay public — the browser fetches it credential-less to install the app.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|pdf)$).*)"],
};
