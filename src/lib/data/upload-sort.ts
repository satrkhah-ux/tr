"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { gateOperation, gateRow } from "@/lib/operations/access";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { classifyPaper, readMoneyPaper, transcribeTicket, type MoneyPaper } from "@/lib/flights/ticket-ai";
import { MAX_TICKET_BYTES } from "@/lib/flights/ticket-parse";
import { getOcrProvider } from "@/lib/repackage/extract/ocr";
import { extractPdfText } from "@/lib/repackage/extract/pdf-text";
import { normalizeImage, pdfPageImages } from "@/lib/repackage/extract/page-images";
import { sniff } from "@/lib/repackage/extract/upload-text";
import { amountIn, matchSupplier, paperKind, type PaperKind } from "@/lib/operations/wizard/upload-all";

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
/** A PDF's «Con fi rmation»: the font's ligature comes out as a word of its own — joined back, or the reader's labels miss it. */
const joined = (text: string) => text.replace(/([A-Za-z]) (fi|fl|ffi|ffl|ff) ([a-z])/g, "$1$2$3");
const WHAT: Record<Exclude<PaperKind, "passport" | "unknown">, string> = {
  ticket: "flight ticket",
  hotel: "hotel booking confirmation",
  hotel_invoice: "hotel supplier invoice",
  ticket_invoice: "flight ticket invoice",
  payment: "payment receipt or bank transfer",
};

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

    if (kind.kind === "pdf") {
      const layer = await extractPdfText(bytes).catch(() => null);
      const sorted = layer?.text.trim() ? paperKind(layer.text) : "unknown";
      if (sorted === "passport") {
        const [page] = await pdfPageImages(bytes).catch(() => []);
        return { ok: true, paper: { kind: "passport", text: "", image: page ? dataUrl(page) : null } };
      }
      // words that sort it are the words to read it by: the codes, numbers and dates a reader wants are Latin,
      // and our own papers (Arabic shaped, two short pages) count as «scanned» yet render blank as pictures —
      // AD-5-3269's ticket and vouchers came back unread (the evaluator, 2026-10-23)
      if (layer && layer.text.trim() && (sorted !== "unknown" || !layer.likelyScanned)) return { ok: true, paper: { kind: sorted, text: joined(layer.text).slice(0, 50_000), image: null } };
    }

    // a picture, or a scan: one look for its kind, then its words for a ticket or a hotel
    const ocr = getOcrProvider();
    if (!isOpenAIConfigured()) {
      if (!ocr.isConfigured()) return { ok: false, error: "wz.up.err.needsReader" };
      const read = await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime);
      const sorted = paperKind(read.text);
      return { ok: true, paper: { kind: sorted, text: sorted === "passport" ? "" : read.text, image: null } };
    }
    const images = kind.kind === "pdf" ? await pdfPageImages(bytes) : [await normalizeImage(bytes)];
    if (images.length === 0) return { ok: false, error: "wz.up.err.unreadable" };
    const sorted = await classifyPaper(images);
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

export type MoneyRead = MoneyPaper & {
  /** an invoice: what the booking costs on file, and who supplies it — beside what the paper says */
  cost: { amount: number | null; currency: string | null } | null;
  onFile: { id: string; name: string } | null;
  /** the issuer among our suppliers (matchSupplier); null with an issuer — offered as a new one */
  supplier: { id: string; name: string } | null;
};

/**
 * A money paper's figures (the owner, 2026-10-23): the model's reading where it
 * is on, the total and currency by amountIn where it is not or left them out.
 * An invoice is cost: pricing.internal, and it comes back with the booking's
 * cost and supplier on file and the issuer among our suppliers. A client's
 * slip is the case's own.
 */
export async function readMoney(
  operationId: string,
  input: { kind: "hotel_invoice" | "ticket_invoice" | "payment"; text: string; booking_id?: string },
): Promise<{ ok: true; read: MoneyRead } | { ok: false; error: TranslationKey }> {
  const invoice = input.kind !== "payment";
  const denied =
    (await gateOperation(operationId)) ??
    (invoice ? ((await currentCan("pricing.internal")) ? (input.booking_id ? await gateRow("operation_bookings", input.booking_id) : null) : "err.forbidden") : null);
  if (denied) return { ok: false, error: denied };
  try {
    const regex = amountIn(input.text);
    let paper: MoneyPaper = { issuer: "", hotel: "", amount: null, currency: "", date: "", reference: "", method: "", paid: false, sender: "" };
    if (isOpenAIConfigured()) paper = await readMoneyPaper(input.text).catch(() => paper);
    paper = { ...paper, amount: paper.amount ?? regex.amount, currency: paper.currency || regex.currency || "" };
    if (!invoice) return { ok: true, read: { ...paper, cost: null, onFile: null, supplier: null } };

    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    const [{ data: suppliers }, { data: booking }] = await Promise.all([
      db.from("company_suppliers").select("id, arabic_name, english_name").neq("status", "Disabled"),
      input.booking_id
        ? db.from("operation_bookings").select("operation_id, quoted_net, net_charged, currency, assignee_supplier_id").eq("id", input.booking_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const list = (suppliers ?? []) as { id: string; arabic_name: string; english_name: string | null }[];
    const row = booking as { operation_id: string; quoted_net: number | null; net_charged: number | null; currency: string | null; assignee_supplier_id: string | null } | null;
    if (row && row.operation_id !== operationId) return { ok: false, error: "ops.err.notFound" };
    const own = row?.assignee_supplier_id ? list.find((s) => s.id === row.assignee_supplier_id) : null;
    const hit = paper.issuer ? matchSupplier(paper.issuer, list) : null;
    return {
      ok: true,
      read: {
        ...paper,
        cost: row ? { amount: row.net_charged ?? row.quoted_net, currency: row.currency } : null,
        onFile: own ? { id: own.id, name: own.arabic_name } : null,
        supplier: hit ? { id: hit.id, name: hit.arabic_name } : null,
      },
    };
  } catch {
    return { ok: false, error: "wz.up.err.unreadable" };
  }
}
