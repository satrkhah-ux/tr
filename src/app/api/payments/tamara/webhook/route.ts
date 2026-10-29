import { after, type NextRequest, NextResponse } from "next/server";
import { getSecret } from "@/lib/secrets/get";
import { verifyNotificationToken } from "@/lib/providers/tamara";
import { applyTamaraEvent } from "@/lib/operations/payment-links-poll";

/**
 * Tamara's order notifications (the owner, 2026-10-29) — public (proxy allow-list); trusted only through the
 * `tamaraToken` JWT signed with TAMARA_NOTIFICATION_KEY. Answers at once; the work (authorise on «order_approved»,
 * record once, tell the seller) runs after the answer, the same path as the 10-minute poll, which stays the fallback.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("tamaraToken") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const key = (await getSecret("TAMARA_NOTIFICATION_KEY")) ?? "";
  if (!verifyNotificationToken(token, key)) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { order_id?: unknown; event_type?: unknown } | null;
  const orderId = typeof body?.order_id === "string" ? body.order_id : "";
  const event = typeof body?.event_type === "string" ? body.event_type : "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !event) return NextResponse.json({ ok: false }, { status: 400 });

  after(() => applyTamaraEvent(orderId, event).catch(() => null));
  return NextResponse.json({ ok: true });
}
