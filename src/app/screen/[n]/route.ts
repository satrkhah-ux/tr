import { type NextRequest, NextResponse } from "next/server";
import { allowScreenRequest, screenState } from "@/lib/office-screens/server";
import { noScreenPage, screenPage } from "@/lib/office-screens/page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «الشاشات» — screen n of the office (pkg.traveliun.com/1 is rewritten here by
 * the proxy). Open, no login (the owner, 2026-10-19): it shows only ads, the
 * destinations asked for and their kind. ?state=1 is the JSON the page polls;
 * ?monitor=1 is the same page inside «الشاشات»'s monitor (it never asks for full
 * screen or a wake lock).
 *
 * The HTTP Refresh header is the third refresh layer: it reloads the page even
 * if the TV browser froze the script (the HTML engine keeps time when the JS
 * does not). Six hours, because a reload that lands in a deploy's few seconds
 * shows the browser's error page until someone presses refresh; the script
 * itself reloads on a new version and at 04:00.
 */
const ipOf = (req: NextRequest) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";

export async function GET(req: NextRequest, ctx: { params: Promise<{ n: string }> }): Promise<Response> {
  const { n: raw } = await ctx.params;
  const n = /^\d{1,2}$/.test(raw) ? Number(raw) : 0;
  const wantsState = req.nextUrl.searchParams.has("state");
  if (!allowScreenRequest(ipOf(req))) return new NextResponse(null, { status: 429, headers: { "Retry-After": "30" } });
  let state = null;
  try {
    state = n ? await screenState(n) : null;
  } catch {
    // a database blip: the page keeps what it shows; a first load gets a retry in a minute
    if (wantsState) return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(noScreenPage(n), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Refresh: "60" } });
  }
  if (wantsState) return NextResponse.json(state ?? { ok: false }, { status: state ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  if (!state) return new NextResponse(noScreenPage(n), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Refresh: "300" } });
  return new NextResponse(screenPage(n, state, req.nextUrl.searchParams.has("monitor")), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Refresh: "21600", "X-Robots-Tag": "noindex" },
  });
}
