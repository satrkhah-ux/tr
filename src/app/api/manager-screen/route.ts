import { NextResponse } from "next/server";
import { managerSnapshot, type ManagerScreenFeed } from "@/lib/manager-screen/snapshot";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/manager-screen — «قناة المدير»'s feed (the owner, 2026-10-19): the
 * office TV polls it. The snapshot is computed at most once a minute
 * (lib/manager-screen/snapshot.ts); `now` is the server's clock, for the
 * screen to set its own by. Internal figures: dashboard.admin only — 403 for
 * anyone else; the proxy already turns away a request without a session.
 */
export async function GET(): Promise<NextResponse> {
  const snapshot = await managerSnapshot();
  if (!snapshot) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  const feed: ManagerScreenFeed = { ...snapshot, now: Date.now(), build: String(process.env.NEXT_DEPLOYMENT_ID || "") };
  return NextResponse.json(feed, { headers: NO_STORE });
}
