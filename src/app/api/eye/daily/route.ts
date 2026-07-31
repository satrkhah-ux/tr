import { type NextRequest, NextResponse } from "next/server";
import { deliverBriefing, prepareBriefing } from "@/lib/eye/deliver";
import { eyeListeners } from "@/lib/telegram/eye-bot";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/eye/daily — the evening briefing.
 *
 * Called by a crontab on the VPS:
 *   0 20 * * *  TZ=Asia/Riyadh curl -fsS -X POST \
 *     -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/eye/daily
 *
 * The secret is the whole authentication: this endpoint sends a report naming
 * people and their delays, so an unauthenticated caller must get nothing at all
 * — not even the fact that a report exists.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const listeners = await eyeListeners();
  const briefing = await prepareBriefing();

  // No listener yet (nobody has linked Telegram, or nobody holds dashboard.admin)
  // — still build and store the day, so the notes acquire their age and the
  // archive has no hole once someone does link.
  const delivered = await deliverBriefing(listeners, briefing);

  return NextResponse.json({
    ok: true,
    day: briefing.report.day,
    listeners: listeners.length,
    delivered,
    notes: briefing.report.notes.length,
    spoken: Boolean(briefing.audio),
  });
}

/**
 * GET — the same report, computed and returned, but NOT sent and NOT spoken.
 *
 * This is the rehearsal: read today's real numbers and the Saudi script before
 * anyone hears them, without spending a TTS call or writing a note's age. Same
 * builder as the real thing, so what you read here is what management gets.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const { buildEyeReport } = await import("@/lib/eye/report");
  const { speechScript, textSummary } = await import("@/lib/eye/script");
  const report = await buildEyeReport();

  return NextResponse.json({
    ok: true,
    dry: true,
    listeners: (await eyeListeners()).map((l) => l.name),
    report,
    script: speechScript(report),
    summary: textSummary(report),
  });
}
