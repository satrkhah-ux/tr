import { type NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/data/cron-runs";
import { runReservationsMail } from "@/lib/reservations-mail/reader";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/ops/mail — read the reservations mailbox (reservations-mail/reader.ts).
 *
 * Called by a crontab on the VPS, like /api/ops/daily:
 *   (every 15 minutes) curl -fsS -X POST -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/ops/mail
 *
 * The mailbox does not exist yet (the owner, 2026-10-26): until its env vars
 * are set the run answers {skipped: not_configured} — a state, not an error,
 * so the crontab's curl -f stays green.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const summary = await recordCronRun("reservations_mail", runReservationsMail);
  return NextResponse.json({ ok: true, ...summary });
}
