import { type NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/data/cron-runs";
import { runPaymentLinks } from "@/lib/operations/payment-links-poll";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/ops/payments — ask MyFatoorah / Tamara about every pending payment
 * link; a paid one is recorded once (operations/payment-links-poll.ts).
 *
 * Called by a crontab on the VPS, like /api/ops/daily:
 *   (every 10 minutes) curl -fsS -X POST -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/ops/payments
 *
 * The secret is the whole authentication: it records money, so an
 * unauthenticated caller gets nothing.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const summary = await recordCronRun("payment_links", runPaymentLinks);
  return NextResponse.json({ ok: true, ...summary });
}
