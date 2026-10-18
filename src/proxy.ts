import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_STORAGE_KEY,
  getPublicSupabaseConfig,
  parseSessionCookie,
} from "@/lib/supabase/constants";
import { PARTNER_PREFIXES, partnerIdFromToken, underAny } from "@/lib/partners/route-guard";

/**
 * Auth gate (Next 16 `proxy` convention — successor to `middleware`), and the
 * one place the access token is kept alive.
 *
 * Unauthenticated visitors to protected routes are redirected to /sign-in;
 * authenticated visitors to the login screens are sent to /dashboard.
 *
 * REFRESH, and why it is here. A Supabase access token lives an hour. The
 * browser client refreshes it on a timer, which is fine while a tab is awake —
 * but an agent who leaves the generator open over lunch comes back to a token
 * that died twenty minutes ago, and the first thing they click is a server
 * action that reads the cookie, finds it expired and answers «انتهت الجلسة».
 * They had not gone anywhere.
 *
 * The proxy sees every one of those requests, including server actions, and it
 * is the only layer that can WRITE a cookie back (an RSC cannot). So when the
 * token is spent or nearly so, it is exchanged for a new one here and set on
 * both the forwarded request and the response — so the action running inside
 * THIS request already sees the fresh token, not the next one.
 */

/**
 * Refresh only once the token is ACTUALLY spent — not a minute before.
 *
 * The browser client refreshes on its own timer, roughly a minute ahead, and a
 * Supabase refresh token ROTATES: whoever redeems it first invalidates the
 * copy the other is holding, and the loser gets «Invalid Refresh Token:
 * Refresh Token Not Found». Refreshing early here meant the two raced on every
 * ordinary page load, and the race logged people out — the exact failure this
 * was added to prevent.
 *
 * So the browser normally wins and this never fires. It fires for the case the
 * browser cannot cover: a tab that was asleep when the hour ran out.
 */
const REFRESH_MARGIN_SECONDS = 0;

type RefreshedSession = { cookieValue: string } | null;

/**
 * Trade the refresh token for a new session.
 *
 * Returns the serialized cookie value to store, or null when the refresh token
 * is itself spent — which is a real logout, and the caller treats it as one.
 */
async function refreshSession(refreshToken: string): Promise<RefreshedSession> {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  try {
    const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const session = (await res.json()) as { access_token?: string; expires_in?: number; expires_at?: number };
    if (!session.access_token) return null;
    // supabase-js persists whatever it was handed, and reads `expires_at` back.
    // The endpoint usually sends it; compute it when it does not, or the very
    // next request thinks the brand-new token is already stale and refreshes
    // again, forever.
    const withExpiry = {
      ...session,
      expires_at:
        typeof session.expires_at === "number"
          ? session.expires_at
          : Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    };
    // plain JSON: response.cookies.set() URI-encodes it itself
    return { cookieValue: JSON.stringify(withExpiry) };
  } catch {
    return null;
  }
}

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
// `/api/eye` (and `/api/ops`, the operations morning) is the same case with a different caller: a crontab on the VPS,
// which carries no cookie either. It proves itself with ADMIN_API_SECRET in a
// header — leaving it behind this gate would turn the nightly briefing into a
// silent 307 that nobody notices until management asks why it stopped.
// `/b2b` is the public door for travel companies — the same kind of surface as
// `/client-offer`: no session, and no database grant either. The registration
// form posts to a server action that writes one `pending` row through the
// service role, and `/b2b` itself decides who is standing there (partner,
// employee, or stranger) and shows each of them something useful. Guarding it
// here would send a company that has an account to the STAFF sign-in screen,
// which is the wrong door with the wrong error.
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/client-offer",
  "/voucher",
  "/trip",
  // operations order 11: the supplier's and the driver's token pages
  "/supplier-link",
  "/driver-day",
  "/tg",
  "/api/telegram",
  "/api/eye",
  "/api/ops",
  // «العملاء»: the conversations sheet pull, the same crontab with the same secret
  "/api/leads/pull",
  // «مُراد»: the minute crontab, the same secret
  "/api/murad/run",
  "/b2b",
];
const LOGIN_PATHS = new Set(["/", "/sign-in"]);

function isPublic(pathname: string): boolean {
  if (LOGIN_PATHS.has(pathname)) return true;
  return underAny(pathname, PUBLIC_PREFIXES);
}

export async function proxy(request: NextRequest) {
  // FAIL-SAFE: this runs on the hosting edge for every page view. If anything
  // in here ever throws, visitors would get the host's "edge function crashed"
  // page — so on error we fail OPEN and serve the request. That only skips the
  // redirect convenience: every page/action still verifies the session
  // server-side (getServerUser + role checks), so content stays protected.
  try {
    const { pathname } = request.nextUrl;
    const session = parseSessionCookie(request.cookies.get(AUTH_STORAGE_KEY)?.value);

    // Spent, or close enough that this request could outlive it.
    const now = Math.floor(Date.now() / 1000);
    const expiring =
      session !== null &&
      session.refreshToken !== null &&
      session.expiresAt !== null &&
      session.expiresAt - now <= REFRESH_MARGIN_SECONDS;

    let refreshedCookie: string | null = null;
    const isAuthed = session !== null;

    if (expiring && session?.refreshToken) {
      const next = await refreshSession(session.refreshToken);
      if (next) {
        refreshedCookie = next.cookieValue;
        // The forwarded request carries the new token, so a server action in
        // THIS request reads the fresh one rather than the corpse.
        request.cookies.set(AUTH_STORAGE_KEY, next.cookieValue);
      }
      // A failure is NOT treated as a logout, deliberately. The usual cause is
      // the browser having just rotated the same token a moment earlier — its
      // newer cookie is already on its way, and signing the person out here
      // would turn a harmless race into the thing we were trying to stop.
      // Every page and action still verifies the session for itself.
    }

    /** Carry a refreshed cookie onto whatever answer we give. */
    const withCookie = (response: NextResponse): NextResponse => {
      if (refreshedCookie) {
        response.cookies.set({
          name: AUTH_STORAGE_KEY,
          value: refreshedCookie,
          path: "/",
          maxAge: AUTH_COOKIE_MAX_AGE,
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
        });
      }
      return response;
    };

    const partner = session ? partnerIdFromToken(session.accessToken) !== null : false;

    // Logged-in users shouldn't see the login screens. The main dashboard now
    // embeds the executive overview for roles that hold pricing.internal; a
    // partner's home is its portal.
    if (isAuthed && LOGIN_PATHS.has(pathname)) {
      return withCookie(NextResponse.redirect(new URL(partner ? "/b2b" : "/dashboard", request.url)));
    }

    // A partner on one of OUR pages goes to its portal — a typed URL, an old
    // bookmark, or the sign-in's default /dashboard alike. (See route-guard.ts:
    // a redirect, not the permission — RLS is.)
    if (partner && !isPublic(pathname) && !underAny(pathname, PARTNER_PREFIXES)) {
      return withCookie(NextResponse.redirect(new URL("/b2b", request.url)));
    }

    // Everything that isn't public requires a session.
    if (!isAuthed && !isPublic(pathname)) {
      const redirectUrl = new URL("/sign-in", request.url);
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    return withCookie(NextResponse.next({ request }));
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Run on all routes except Next internals and static assets. The PWA manifest
  // must stay public — the browser fetches it credential-less to install the app.
  // Fonts belong in this list for the same reason images do: a @font-face URL is
  // fetched by the browser with no session, so without the exclusion every
  // /fonts/*.ttf on the PUBLIC client-offer page answered with a redirect to
  // sign-in and the Arabic text quietly fell back to a system face. The printed
  // PDF was never affected — it embeds the files as base64 — which is exactly
  // why this went unnoticed: the paper was right and the screen was not.
  //
  // `sw.js` is excluded so that it 404s, and that 404 is the point. This app
  // registers no service worker, but localhost:3000 is shared with every other
  // project on the machine, and one of them left a worker registered on that
  // origin — which then served ITS cached chunks to this app and broke the page
  // with "module factory is not available". A worker can only be evicted by its
  // own script 404ing on the browser's update check; while this path answered
  // with a 307 to /sign-in the browser saw a MIME-type error instead and kept
  // the stale registration alive.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|pdf|ttf|otf|woff|woff2)$).*)",
  ],
};
