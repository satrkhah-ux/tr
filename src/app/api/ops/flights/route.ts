import { type NextRequest, NextResponse } from "next/server";
import { trackFlights } from "@/lib/data/flight-tracking";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ops/flights — the travel-day flight watch (operations order 11):
 * receptions follow their flight's real landing. Also run by /api/ops/daily.
 *
 * Called by a crontab on the VPS every 30 minutes; outside a landing's window
 * it asks the provider nothing (flight-tracking.ts):
 *   0,30 * * * *  curl -fsS -X POST \
 *     -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/ops/flights
 *
 * The secret is the whole authentication, as for /api/ops/daily.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await trackFlights()) });
}
