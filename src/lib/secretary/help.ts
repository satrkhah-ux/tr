import "server-only";
import { isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
import { currentPermissions } from "@/lib/roles/current";
import type { Permission } from "@/lib/roles/roles";
import { ERROR_SYSTEM, HELP_SCHEMA, HELP_SYSTEM, helpContext, helpFallback, helpTopicsFor, matchHelp } from "./help-core";

/**
 * A how-to answer: the asker's own topics, the cheap model (openaiJson — the
 * default chat model, under the ai-usage budget and counters), and the topic as
 * written when no model is set or it fails. Never reads a client's data.
 */
export async function helpReply(question: string, kind: "help" | "error" = "help"): Promise<string> {
  const mine = new Set<Permission>(await currentPermissions());
  const allowed = helpTopicsFor((p) => mine.has(p));
  const matched = matchHelp(question, allowed);
  const fallback = kind === "error" ? "لا أعرف سبب هذا الخطأ بالتحديد. أعد المحاولة بعد تحديث الصفحة، وإن تكرر اضغط «أبلغ الإدارة»." : helpFallback(matched);
  if (!isOpenAIConfigured()) return fallback;
  try {
    const raw = await openaiJson({ name: kind === "error" ? "secretary_error" : "secretary_help", system: kind === "error" ? ERROR_SYSTEM : HELP_SYSTEM, user: helpContext(question, matched, allowed), schema: HELP_SCHEMA as unknown as Record<string, unknown>, timeoutMs: 20_000 });
    const reply = raw ? (JSON.parse(raw) as { reply?: string }).reply?.trim() : "";
    return reply ? reply.slice(0, 4000) : fallback;
  } catch {
    return fallback;
  }
}
