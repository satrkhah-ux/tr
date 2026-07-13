/**
 * POST/GET /api/telegram/bot-control
 *
 * Admin Kill-Switch: pause or resume the bot.
 * Protected by ADMIN_API_SECRET.
 */

import { type NextRequest, NextResponse } from "next/server";
import { setBotPaused, isBotPaused } from "@/lib/telegram/bot-handler";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { secret?: string; paused?: boolean };

  if (body.secret !== process.env.ADMIN_API_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  setBotPaused(!!body.paused);
  return NextResponse.json({ ok: true, botPaused: isBotPaused() });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.ADMIN_API_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, botPaused: isBotPaused() });
}
