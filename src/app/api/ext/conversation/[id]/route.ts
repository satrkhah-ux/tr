import { extCaller, extJson } from "@/lib/ext/auth";
import { conversationPanel, sameTeletelAccount } from "@/lib/ext/conversation";

export const runtime = "nodejs";

/**
 * GET /api/ext/conversation/<id>?acc=<teletel account> — the side panel beside a
 * Teletel conversation (lib/ext/conversation.ts). For whoever works clients,
 * follow-ups or visas; each part by its own page's rule.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await extCaller(request, "panel");
  if (caller instanceof Response) return caller;
  const ok = ["clients.view", "offers.write", "followups.work", "followups.manage", "visas.work", "visas.manage"] as const;
  if (!ok.some((p) => caller.can(p))) return extJson({ ok: false, error: "forbidden" }, 403);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return extJson({ ok: false, error: "bad_id" }, 400);
  if (!sameTeletelAccount(new URL(request.url).searchParams.get("acc"))) return extJson({ ok: false, error: "other_account" }, 404);
  try {
    return extJson(await conversationPanel(caller, id));
  } catch {
    return extJson({ ok: false, error: "unavailable" }, 503);
  }
}
