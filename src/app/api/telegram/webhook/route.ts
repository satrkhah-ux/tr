/**
 * POST /api/telegram/webhook
 *
 * Receives all Telegram updates (messages + callback queries).
 * Secret-token header is validated to reject spoofed requests.
 */

import { type NextRequest, NextResponse } from "next/server";
import { handleUpdate } from "@/lib/telegram/bot-handler";
import type { TelegramUpdate } from "@/lib/telegram/types";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Validate webhook secret (prevents forged requests) ──
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && secretHeader !== expectedSecret) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Process asynchronously — respond 200 immediately so Telegram doesn't retry
  handleUpdate(update).catch((err) =>
    console.error("[PalmX Bot] handleUpdate error:", err)
  );

  return NextResponse.json({ ok: true });
}

// ── GET: Register / info endpoint (for setup verification) ──
export async function GET(): Promise<NextResponse> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" },
      { status: 503 }
    );
  }
  return NextResponse.json({
    ok:       true,
    bot:      "@plamxbot",
    platform: "PalmX",
    chain:    "Solana",
    version:  "4.0.0",
  });
}
