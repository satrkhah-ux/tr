import "server-only";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { transcribeTicket } from "@/lib/flights/ticket-ai";
import { MAX_TICKET_BYTES } from "@/lib/flights/ticket-parse";
import { getOcrProvider } from "./ocr";
import { extractPdfText } from "./pdf-text";
import { normalizeImage, pdfPageImages } from "./page-images";

/**
 * An uploaded paper (or pasted text) → its words, for a reader that parses them:
 * the flight card tool, the wizard's tickets and hotel confirmations. A PDF's
 * own text layer first; a photo or a scanned PDF through a configured OCR
 * service, else the vision model — only when OPENAI_API_KEY is set. The bytes
 * live in this request only: nothing is stored or logged here.
 */

/** How the words reached the parser — the screen says so. */
export type UploadHow = "text" | "pdf" | "ocr" | "vision";
export type UploadError = "empty" | "tooLarge" | "type" | "unreadable" | "needsReader";

type Kind = { kind: "pdf" } | { kind: "image"; mime: string };

/** By the bytes, not the name or the browser's word for it. */
function sniff(bytes: Buffer): Kind | null {
  const head = bytes.subarray(0, 12);
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return { kind: "pdf" };
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return { kind: "image", mime: "image/png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp" };
  return null;
}

/** A picture's words: a configured OCR service first, else the vision model. */
async function readPicture(bytes: Buffer, kind: Kind, what: string): Promise<{ text: string; how: UploadHow } | null> {
  const ocr = getOcrProvider();
  if (ocr.isConfigured()) {
    try {
      const result = await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime);
      if (result.text.trim()) return { text: result.text, how: "ocr" };
    } catch {
      /* fall through to the model */
    }
  }
  if (!isOpenAIConfigured()) return null;
  const images = kind.kind === "pdf" ? await pdfPageImages(bytes).catch(() => []) : [await normalizeImage(bytes)];
  if (images.length === 0) return null;
  return { text: await transcribeTicket(images, what), how: "vision" };
}

/** `file` wins over `text`; `what` names the paper for the vision model («hotel booking confirmation»). */
export async function uploadText(formData: FormData, what: string): Promise<{ ok: true; text: string; how: UploadHow } | { ok: false; error: UploadError }> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_TICKET_BYTES) return { ok: false, error: "tooLarge" };
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) return { ok: false, error: "type" };
    if (kind.kind === "pdf") {
      const layer = await extractPdfText(bytes).catch(() => null);
      if (layer && !layer.likelyScanned && layer.text.trim()) return { ok: true, text: layer.text, how: "pdf" };
    }
    const read = await readPicture(bytes, kind, what).catch(() => null);
    if (read?.text.trim()) return { ok: true, ...read };
    return { ok: false, error: read || isOpenAIConfigured() || getOcrProvider().isConfigured() ? "unreadable" : "needsReader" };
  }
  const pasted = String(formData.get("text") ?? "").trim();
  return pasted ? { ok: true, text: pasted.slice(0, 50_000), how: "text" } : { ok: false, error: "empty" };
}
