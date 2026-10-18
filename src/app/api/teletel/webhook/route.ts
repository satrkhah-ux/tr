import { after, type NextRequest, NextResponse } from "next/server";
import { schedule, webhookToken } from "@/lib/murad/reception-run";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/teletel/webhook?token=… — Teletel (Chatwoot) «message_created»:
 * each incoming WhatsApp message reaches «المستقبل الآلي» the moment it arrives
 * (src/lib/murad/reception-run.ts), instead of the minute job's next round.
 *
 * Chatwoot sends no signature and no custom header, so the URL carries the
 * secret: a hash of ADMIN_API_SECRET, never the secret itself (it is stored in
 * Teletel's settings). The answer is immediate; the work runs after it, so a
 * slow Teletel never makes Chatwoot retry — and a retry is claimed once anyway.
 */
type Payload = {
  event?: string;
  id?: number;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  created_at?: string | number;
  sender?: { name?: string | null; phone_number?: string | null; type?: string | null } | null;
  conversation?: { id?: number; meta?: { sender?: { name?: string | null; phone_number?: string | null } | null } | null } | null;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = webhookToken();
  if (!token || req.nextUrl.searchParams.get("token") !== token) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Payload | null;
  const incoming = body?.message_type === "incoming" || body?.message_type === 0;
  if (!body || body.event !== "message_created" || !incoming || body.private) return NextResponse.json({ ok: true, ignored: true });
  const at = typeof body.created_at === "number" ? body.created_at : Math.floor(Date.parse(String(body.created_at ?? "")) / 1000) || Math.floor(Date.now() / 1000);
  const sender = body.conversation?.meta?.sender ?? body.sender;
  const message = {
    conversationId: Number(body.conversation?.id) || 0,
    messageId: Number(body.id) || 0,
    at,
    phone: sender?.phone_number ?? body.sender?.phone_number ?? "",
    contactName: sender?.name ?? body.sender?.name ?? "",
    content: String(body.content ?? ""),
  };
  // «تأخير بشري»: marked read now, answered after a person's pause (reception-run.ts schedule)
  after(async () => {
    await schedule(message).catch(() => undefined);
  });
  return NextResponse.json({ ok: true });
}
