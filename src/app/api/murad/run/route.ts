import { type NextRequest, NextResponse } from "next/server";
import { runMurad } from "@/lib/murad/run";
import { recordCronRun } from "@/lib/data/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/murad/run — «مُراد»: a client waiting five minutes with no human
 * answer gets one from Murad (src/lib/murad/run.ts).
 *
 * Called by ONE crontab line on the live VPS, every minute:
 *   * * * * *  curl -fsS -X POST -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/murad/run
 *
 * The secret is the whole authentication (as /api/ops/daily): it writes to
 * clients' conversations. Overlapping calls are safe — a lease keeps a second
 * run out ({skipped: "busy"}), and each client turn is claimed once in murad_log.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // every run leaves its trace for /developer, answered anyone or not (cron-runs.ts)
  const summary = await recordCronRun("murad_run", runMurad);
  return NextResponse.json({ ok: true, ...summary });
}
