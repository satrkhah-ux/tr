import { type NextRequest, NextResponse } from "next/server";
import { runOpsDaily } from "@/lib/operations/daily";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/ops/daily — the operations morning (operations order 6): trips that
 * ended become «سافر», a week later they close, and the alerts go out once.
 *
 * Called by a crontab on the VPS:
 *   0 7 * * *  TZ=Asia/Riyadh curl -fsS -X POST \
 *     -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/ops/daily
 *
 * The secret is the whole authentication (as /api/eye/daily): it moves cases and
 * sends names, so an unauthenticated caller gets nothing.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const result = await runOpsDaily(today);
  return NextResponse.json({ ok: true, day: today, ...result });
}
