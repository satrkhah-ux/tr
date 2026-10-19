import { managerSnapshot } from "@/lib/manager-screen/snapshot";
import { managerDeniedPage, managerPage } from "@/lib/manager-screen/page";
import { sessionGone } from "@/lib/supabase/server";
import { AUTH_STORAGE_KEY } from "@/lib/supabase/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «قناة المدير» — pkg.traveliun.com/m (and /manager): the manager's office TV
 * (the owner, 2026-10-19). Internal figures, so a dashboard.admin session only:
 * the proxy sends a visitor without one to the sign-in and back; a session
 * signed out elsewhere drops its cookie and loads again (the same as
 * SessionGone); anyone else gets a plain refusal. The HTTP Refresh header is the
 * last refresh layer, as on the office screens.
 */
const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...extra } });

export async function GET(): Promise<Response> {
  if (await sessionGone()) {
    return html(`<!doctype html><meta charset="utf-8"><script>document.cookie="${AUTH_STORAGE_KEY}=; path=/; max-age=0; SameSite=Lax";location.reload();</script>`);
  }
  const snapshot = await managerSnapshot();
  if (!snapshot) return html(managerDeniedPage(), 403);
  return html(managerPage({ ...snapshot, now: Date.now() }), 200, { Refresh: "21600" });
}
