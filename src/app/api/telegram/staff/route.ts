import { after, type NextRequest, NextResponse } from "next/server";
import { handleStaffUpdate, type StaffUpdate } from "@/lib/telegram/staff-handler";
import { staffWebhookSecret } from "@/lib/telegram/staff-bot";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/telegram/staff — the webhook of «تنبيهاتي - ترافليون».
 *
 * The secret is required, never optional. setWebhook registers it
 * (staff-bot.ts), and an update without it is a forgery. Telegram gets its
 * answer at once and the work runs after it, because a slow reply makes
 * Telegram resend the update.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = staffWebhookSecret();
  if (!expected) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expected) return NextResponse.json({ ok: false }, { status: 403 });

  const update = (await req.json().catch(() => null)) as StaffUpdate | null;
  if (!update) return NextResponse.json({ ok: false }, { status: 400 });
  after(() => handleStaffUpdate(update).catch(() => undefined));
  return NextResponse.json({ ok: true });
}
