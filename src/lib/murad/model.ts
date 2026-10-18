import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
import { holding, MURAD_OUTPUT_SCHEMA, MURAD_SYSTEM_PROMPT, parseMuradOutput, renderContext, type MuradContext, type MuradResult } from "./core";

/**
 * Who writes Murad's answer: Claude when ANTHROPIC_API_KEY is set, else OpenAI
 * through the key the itinerary drafting already uses, else nobody (the job
 * then does nothing and /developer says so). Read at RUNTIME (bracket access),
 * so setting a key on the server needs a restart, not a rebuild.
 */
export const CLAUDE_MODEL = "claude-sonnet-5-5";
/** one try, short: the minute job must finish inside its 60 s, and the next run is a minute away */
const MODEL_TIMEOUT_MS = 25_000;

export type MuradProvider = { provider: "claude" | "openai"; model: string };

export function muradProvider(): MuradProvider | null {
  if (process.env["ANTHROPIC_API_KEY"]) return { provider: "claude", model: CLAUDE_MODEL };
  if (isOpenAIConfigured()) return { provider: "openai", model: process.env["OPENAI_MODEL"] || DEFAULT_MODEL };
  return null;
}

async function claudeJson(system: string, user: string): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"], timeout: MODEL_TIMEOUT_MS, maxRetries: 0 });
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    // a classifier decline is retried server-side on the model Anthropic picks for it
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
    // a short WhatsApp answer: low effort is the chat setting
    output_config: { effort: "low", format: { type: "json_schema", schema: MURAD_OUTPUT_SCHEMA } },
  });
  if (res.stop_reason === "refusal") throw new Error("refusal");
  const text = res.content.find((b) => b.type === "text");
  return text?.type === "text" ? text.text : null;
}

/**
 * One answer for one client turn. Never throws: a provider error, a refusal or
 * an answer that fails validation all come back as the holding reply with
 * needsStaff — and `error` says which, for the log.
 */
export async function muradReply(context: MuradContext): Promise<MuradResult & { error?: string }> {
  const p = muradProvider();
  if (!p) return { ...holding("no_provider"), error: "no_provider" };
  try {
    const user = renderContext(context);
    const raw =
      p.provider === "claude"
        ? await claudeJson(MURAD_SYSTEM_PROMPT, user)
        : await openaiJson({ name: "murad_reply", system: MURAD_SYSTEM_PROMPT, user, schema: MURAD_OUTPUT_SCHEMA as unknown as Record<string, unknown>, timeoutMs: MODEL_TIMEOUT_MS });
    const { result, ok } = parseMuradOutput(raw);
    return ok ? result : { ...result, error: "invalid_output" };
  } catch (error) {
    return { ...holding("model_error"), error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}
