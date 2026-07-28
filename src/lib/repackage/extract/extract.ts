import "server-only";
import type { ConfidenceMap, ExtractedPackage } from "../repackage-types";
import { CONFIDENCE_FIELD_KEYS } from "../repackage-types";
import { extractPdfText } from "./pdf-text";
import { getOcrProvider } from "./ocr";
import { parseSupplierPackage } from "./parse";
import { aiExtractPackage, isAiExtractionConfigured, type AiImage } from "./ai-extract";
import { normalizeImage, pdfPageImages } from "./page-images";

/**
 * The extraction engine's public entry point.
 *
 * A supplier sends whatever they have: a text PDF, a PowerPoint brochure
 * exported to PDF, a WhatsApp screenshot, a pasted message, or a link. So the
 * engine accepts any of those and decides how to read it:
 *
 *   1. take whatever text exists (PDF text layer, or the pasted/fetched text)
 *   2. if the words live in artwork instead, pull the page pictures out
 *   3. hand the text and/or the pictures to the vision-capable model
 *   4. with no model key, fall back to the original regex parser — which only
 *      ever worked on a genuine Arabic text layer
 *
 * `how` reports which reader produced the fields, because the review screen has
 * to be honest about where the numbers came from.
 */

export type ExtractionSource =
  | { kind: "pdf"; bytes: Buffer }
  | { kind: "image"; bytes: Buffer }
  | { kind: "text"; text: string };

export type ExtractionHow = "ai-text" | "ai-vision" | "parser" | "none";

export type ExtractionResult = {
  extracted: ExtractedPackage;
  confidence: ConfidenceMap;
  pdf_kind: "text" | "scanned";
  ocr_used: boolean;
  /** true when nothing could read the document — review must catch everything. */
  ocr_unavailable: boolean;
  /** which reader produced the fields. */
  how: ExtractionHow;
  /** a short Arabic recap, when the model wrote one. */
  summary: string;
};

/** Below this, a PDF's text layer is decoration rather than content. */
const MIN_USEFUL_TEXT = 120;

export async function runExtraction(source: ExtractionSource | Buffer): Promise<ExtractionResult> {
  // A bare Buffer keeps the original call shape working — it always meant a PDF.
  const input: ExtractionSource = Buffer.isBuffer(source) ? { kind: "pdf", bytes: source } : source;

  let text = "";
  let images: AiImage[] = [];
  let pdfKind: "text" | "scanned" = "text";
  let ocrUsed = false;
  let ocrScale = 1;

  if (input.kind === "text") {
    text = input.text;
  } else if (input.kind === "image") {
    pdfKind = "scanned";
    images = [await normalizeImage(input.bytes)];
  } else {
    const layer = await extractPdfText(input.bytes);
    text = layer.text;
    if (layer.likelyScanned || text.trim().length < MIN_USEFUL_TEXT) {
      pdfKind = "scanned";
      // pictures first: they need no external service and are always available
      images = await pdfPageImages(input.bytes).catch(() => []);
      // a configured cloud OCR still helps the parser fallback
      const ocr = getOcrProvider();
      if (images.length === 0 && ocr.isConfigured()) {
        try {
          const result = await ocr.recognize(input.bytes);
          text = result.text || text;
          ocrUsed = true;
          ocrScale = clamp(result.confidence, 0.4, 1);
        } catch {
          /* fall through — the review gate holds everything */
        }
      }
    }
  }

  // ---- 1. the model, when configured and there is anything to read ----
  if (isAiExtractionConfigured() && (text.trim().length > 0 || images.length > 0)) {
    try {
      const ai = await aiExtractPackage({ text: text.trim() || undefined, images });
      return {
        extracted: ai.extracted,
        confidence: ai.confidence,
        pdf_kind: pdfKind,
        ocr_used: ocrUsed,
        ocr_unavailable: false,
        how: images.length > 0 ? "ai-vision" : "ai-text",
        summary: ai.summary,
      };
    } catch {
      /* fall through to the parser rather than failing the whole import */
    }
  }

  // ---- 2. the original regex parser (text only) ----
  const { extracted, confidence } = parseSupplierPackage(text);
  const unreadable = text.trim().length < MIN_USEFUL_TEXT;
  if (unreadable) {
    // nothing legible reached the parser → force every critical field into review
    for (const key of CONFIDENCE_FIELD_KEYS) confidence[key] = 0;
  } else if (ocrScale < 1) {
    for (const key of CONFIDENCE_FIELD_KEYS) {
      const v = confidence[key];
      if (typeof v === "number") confidence[key] = round2(v * ocrScale);
    }
  }

  return {
    extracted,
    confidence,
    pdf_kind: pdfKind,
    ocr_used: ocrUsed,
    ocr_unavailable: unreadable,
    how: unreadable ? "none" : "parser",
    summary: "",
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
