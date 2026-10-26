import { type NextRequest, NextResponse } from "next/server";
import { runOpsDaily } from "@/lib/operations/daily";
import { trackFlights } from "@/lib/data/flight-tracking";
import { recordCronRun } from "@/lib/data/cron-runs";
import { sweepTboBookings } from "@/lib/operations/tbo-sweep";

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
  // every run leaves its trace for /developer, moved anything or not (cron-runs.ts)
  const summary = await recordCronRun("ops_daily", async () => {
    const result = await runOpsDaily(today);
    // the morning's first look at today's arrivals (operations order 11)
    const flights = await trackFlights();
    // TBO has no webhooks (the V2.1 spec, 2026-10-26): the morning asks it about
    // every live case's bookings — a cancellation becomes an issue and a notice
    const tbo = await sweepTboBookings(today).catch(() => null);
    return { day: today, ...result, flights, tbo };
  });
  return NextResponse.json({ ok: true, ...summary });
}
