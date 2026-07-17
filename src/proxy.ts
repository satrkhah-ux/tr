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

const PUBLIC_PREFIXES = ["/sign-in", "/client-offer"];
const LOGIN_PATHS = new Set(["/", "/sign-in"]);

function isPublic(pathname: string): boolean {
  if (LOGIN_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function proxy(request: NextRequest) {
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
}

export const config = {
  // Run on all routes except Next internals and static assets. The PWA manifest
  // must stay public — the browser fetches it credential-less to install the app.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|pdf)$).*)"],
};
