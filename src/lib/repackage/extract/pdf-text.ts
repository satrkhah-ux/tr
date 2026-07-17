import "server-only";
import { getDocumentProxy } from "unpdf";

/**
 * PDF text-layer extraction via unpdf (pure-JS pdf.js — no native deps, runs in
 * a Netlify/Lambda function). Three jobs:
 *
 *  1. LINE REBUILD — the label-based parser is line-oriented, but pdf.js item
 *     streams carry no newlines. Lines are rebuilt from item coordinates
 *     (y-position + hasEOL), preserving content-stream order within a line
 *     (sorting by x would scramble logical-order RTL text).
 *  2. NFKC — normalizes Arabic presentation-form ligatures (ﻻ → لا) in
 *     otherwise-healthy text layers.
 *  3. RELIABILITY GATE — some generators (notably browser print-to-PDF) embed
 *     SHAPED presentation-form glyphs in visual order; that text layer is
 *     unreconstructable garbage for parsing. A high presentation-form ratio
 *     marks the layer unreliable → the caller routes to OCR (or, without OCR,
 *     every critical field lands in human review). Never parse garbage silently.
 */

export type PdfTextResult = {
  text: string;
  pages: number;
  /**
   * true when the text layer cannot be trusted: empty/near-empty (scanned or
   * image-only PDF) OR dominated by Arabic presentation forms (shaped visual
   * text). Callers treat both the same way: OCR if available, else review.
   */
  likelyScanned: boolean;
};

/** Minimum meaningful characters per page for a PDF to count as "text-based". */
const MIN_CHARS_PER_PAGE = 40;

/** Arabic presentation-form share above which the text layer is untrustworthy. */
const MAX_PRESENTATION_RATIO = 0.3;

type RawTextItem = { str?: unknown; transform?: unknown; hasEOL?: unknown };

/** Rebuild visual lines from one page's text items (y-clusters + hasEOL). */
function pageToLines(items: RawTextItem[]): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let lastY: number | null = null;

  const flush = () => {
    const line = current.join(" ").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = [];
  };

  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    const transform = Array.isArray(item.transform) ? (item.transform as number[]) : null;
    const y = transform && typeof transform[5] === "number" ? transform[5] : null;

    // A y jump beyond ~half a line height starts a new line.
    if (y != null && lastY != null && Math.abs(y - lastY) > 4) flush();
    if (y != null) lastY = y;

    if (str.trim()) current.push(str);
    if (item.hasEOL === true) flush();
  }
  flush();
  return lines;
}

export async function extractPdfText(pdf: Buffer): Promise<PdfTextResult> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pages = doc.numPages;

  const allLines: string[] = [];
  for (let p = 1; p <= pages; p += 1) {
    const page = await doc.getPage(p);
    const content = (await page.getTextContent()) as { items: unknown[] };
    allLines.push(...pageToLines(content.items as RawTextItem[]));
  }
  const raw = allLines.join("\n").trim();

  // Reliability: measure the presentation-form share BEFORE NFKC (NFKC folds
  // the forms back to logical letters, erasing the evidence).
  const logicalArabic = (raw.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const presentationForms = (raw.match(/[ﭐ-﷿ﹰ-﻿]/g) ?? []).length;
  const arabicTotal = logicalArabic + presentationForms;
  const garbled = arabicTotal > 0 && presentationForms / arabicTotal > MAX_PRESENTATION_RATIO;

  const text = raw.normalize("NFKC");
  const perPage = pages > 0 ? text.length / pages : text.length;

  return { text, pages, likelyScanned: perPage < MIN_CHARS_PER_PAGE || garbled };
}
