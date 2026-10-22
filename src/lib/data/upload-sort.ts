"use server";

import type { TranslationKey } from "@/lib/i18n";
import { gateOperation } from "@/lib/operations/access";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { classifyPaper, transcribeTicket } from "@/lib/flights/ticket-ai";
import { MAX_TICKET_BYTES } from "@/lib/flights/ticket-parse";
import { getOcrProvider } from "@/lib/repackage/extract/ocr";
import { extractPdfText } from "@/lib/repackage/extract/pdf-text";
import { normalizeImage, pdfPageImages } from "@/lib/repackage/extract/page-images";
import { sniff } from "@/lib/repackage/extract/upload-text";
import { paperKind, type PaperKind } from "@/lib/operations/wizard/upload-all";

/**
 * «ارفع كل الملفات» — one file → which paper it is, and its words for the
 * step's own reader (readBookingTicket / readHotelConfirmation take `text`, so
 * a photo is transcribed once). A PDF's text layer is sorted by its words; a
 * photo or a scan by one kind-only look (classifyPaper) — a passport is never
 * transcribed here: the MRZ reader reads it, audited, and gets a PDF's first
 * page as a picture. Nothing is stored or logged.
 */

export type SortedPaper = {
  kind: PaperKind;
  /** a ticket's or a hotel confirmation's words — never a passport's */
  text: string;
  /** a passport sent as a PDF: its first page, as a picture for the MRZ reader */
  image: string | null;
};

const dataUrl = (img: { mime: string; base64: string }) => `data:${img.mime};base64,${img.base64}`;
const WHAT: Record<"ticket" | "hotel", string> = { ticket: "flight ticket", hotel: "hotel booking confirmation" };

export async function sortPaper(operationId: string, formData: FormData): Promise<{ ok: true; paper: SortedPaper } | { ok: false; error: TranslationKey }> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "wz.up.err.empty" };
  if (file.size > MAX_TICKET_BYTES) return { ok: false, error: "wz.up.err.tooLarge" };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) return { ok: false, error: "wz.up.err.type" };

    // a PDF's own words sort it even when they are too few or too shaped to read from — then it is read as a picture
    let known: PaperKind | null = null;
    if (kind.kind === "pdf") {
      const layer = await extractPdfText(bytes).catch(() => null);
      const sorted = layer?.text.trim() ? paperKind(layer.text) : "unknown";
      if (sorted === "passport") {
        const [page] = await pdfPageImages(bytes).catch(() => []);
        return { ok: true, paper: { kind: "passport", text: "", image: page ? dataUrl(page) : null } };
      }
      if (layer && !layer.likelyScanned && layer.text.trim()) return { ok: true, paper: { kind: sorted, text: layer.text.slice(0, 50_000), image: null } };
      if (sorted !== "unknown") known = sorted;
    }

    // a picture, or a scan: one look for its kind, then its words for a ticket or a hotel
    const ocr = getOcrProvider();
    if (!isOpenAIConfigured()) {
      if (!ocr.isConfigured()) return { ok: false, error: "wz.up.err.needsReader" };
      const read = await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime);
      const sorted = known ?? paperKind(read.text);
      return { ok: true, paper: { kind: sorted, text: sorted === "passport" ? "" : read.text, image: null } };
    }
    const images = kind.kind === "pdf" ? await pdfPageImages(bytes) : [await normalizeImage(bytes)];
    if (images.length === 0) return { ok: false, error: "wz.up.err.unreadable" };
    const sorted = known ?? (await classifyPaper(images));
    if (sorted === "passport") return { ok: true, paper: { kind: sorted, text: "", image: kind.kind === "pdf" ? dataUrl(images[0]) : null } };
    if (sorted === "unknown") return { ok: true, paper: { kind: sorted, text: "", image: null } };
    let text = "";
    if (ocr.isConfigured()) text = (await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime).catch(() => ({ text: "" }))).text;
    if (!text.trim()) text = await transcribeTicket(images, WHAT[sorted]);
    return { ok: true, paper: { kind: sorted, text: text.slice(0, 50_000), image: null } };
  } catch {
    return { ok: false, error: "wz.up.err.unreadable" };
  }
}
