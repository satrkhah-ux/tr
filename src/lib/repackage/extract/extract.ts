import "server-only";
import type { ConfidenceMap, ExtractedPackage } from "../repackage-types";
import { CONFIDENCE_FIELD_KEYS } from "../repackage-types";
import { extractPdfText } from "./pdf-text";
import { getOcrProvider } from "./ocr";
import { parseSupplierPackage } from "./parse";

/**
 * The extraction engine's public entry point. Detects whether the supplier PDF
 * is text-based or scanned, pulls its text (unpdf text layer, or cloud OCR for
 * scans), parses it into a typed ExtractedPackage with per-field confidence, and
 * reports how it was read so the review stage can be honest with the user.
 */
export type ExtractionResult = {
  extracted: ExtractedPackage;
  confidence: ConfidenceMap;
  pdf_kind: "text" | "scanned";
  ocr_used: boolean;
  /** true when the PDF was scanned but no OCR provider was configured. */
  ocr_unavailable: boolean;
};

export async function runExtraction(pdf: Buffer): Promise<ExtractionResult> {
  const textLayer = await extractPdfText(pdf);

  let text = textLayer.text;
  let pdfKind: "text" | "scanned" = "text";
  let ocrUsed = false;
  let ocrUnavailable = false;
  let ocrScale = 1;

  if (textLayer.likelyScanned) {
    pdfKind = "scanned";
    const ocr = getOcrProvider();
    if (ocr.isConfigured()) {
      try {
        const result = await ocr.recognize(pdf);
        text = result.text || textLayer.text;
        ocrUsed = true;
        // OCR text is noisier — dampen field confidence by the OCR's own score.
        ocrScale = clamp(result.confidence, 0.4, 1);
      } catch {
        ocrUnavailable = true;
      }
    } else {
      ocrUnavailable = true;
    }
  }

  const { extracted, confidence } = parseSupplierPackage(text);

  // A scanned PDF we could not OCR yields almost no reliable text → force every
  // critical field into the review gate (never silently accept blank output).
  if (ocrUnavailable) {
    for (const key of CONFIDENCE_FIELD_KEYS) confidence[key] = 0;
  } else if (ocrScale < 1) {
    for (const key of CONFIDENCE_FIELD_KEYS) {
      const v = confidence[key];
      if (typeof v === "number") confidence[key] = round2(v * ocrScale);
    }
  }

  return { extracted, confidence, pdf_kind: pdfKind, ocr_used: ocrUsed, ocr_unavailable: ocrUnavailable };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
