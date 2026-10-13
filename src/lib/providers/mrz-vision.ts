import "server-only";

/**
 * Passport photo → the two MRZ lines, by OpenAI vision.
 *
 * The model is asked to TRANSCRIBE, not to understand: the lines go to the pure
 * parser (src/lib/operations/mrz.ts), whose check digits catch a misread
 * character, and the employee reviews every field before anything is saved.
 * Gated on the same key as the other assistants (isOpenAIConfigured) — without
 * it the button is not drawn.
 *
 * SERVER-ONLY: the key never reaches the browser; read at runtime like openai.ts.
 */

const DEFAULT_MODEL = "gpt-4o-mini";

export type MrzVisionResult = { ok: true; text: string } | { ok: false; error: "not_configured" | "request_failed" | "bad_response" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["line1", "line2"],
  properties: { line1: { type: "string" }, line2: { type: "string" } },
} as const;

const PROMPT = [
  "This is a photo of a passport's data page.",
  "Transcribe the two machine-readable zone (MRZ) lines at the bottom EXACTLY, character for character.",
  "Each line has 44 characters from A-Z, 0-9 and '<'. Keep every '<'. Do not correct, translate or guess.",
  "If the MRZ is not visible or not readable, return two empty strings.",
].join("\n");

export async function readMrzFromImage(image: { mime: string; base64: string }): Promise<MrzVisionResult> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: process.env["OPENAI_MODEL"] || DEFAULT_MODEL,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: "high" } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: { name: "passport_mrz", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok) return { ok: false, error: "request_failed" };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { line1?: unknown; line2?: unknown };
    if (typeof parsed.line1 !== "string" || typeof parsed.line2 !== "string") return { ok: false, error: "bad_response" };
    return { ok: true, text: `${parsed.line1}\n${parsed.line2}` };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}
