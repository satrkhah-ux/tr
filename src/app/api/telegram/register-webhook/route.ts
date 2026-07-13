/**
 * POST /api/telegram/register-webhook
 *
 * Admin-only endpoint: registers the bot webhook with Telegram.
 * Call once after deployment with the correct domain.
 *
 * Body: { secret: "ADMIN_API_SECRET", webhookUrl: "https://your-domain.com/api/telegram/webhook" }
 */

import { type NextRequest, NextResponse } from "next/server";
import { registerWebhook } from "@/lib/telegram/bot-handler";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { secret?: string; webhookUrl?: string };

  // Guard: check admin secret
  if (body.secret !== process.env.ADMIN_API_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!body.webhookUrl) {
    return NextResponse.json({ ok: false, error: "webhookUrl required" }, { status: 400 });
  }

  const success = await registerWebhook(body.webhookUrl);
  return NextResponse.json({ ok: success, webhookUrl: body.webhookUrl });
}
