"use server";

import type { TranslationKey } from "@/lib/i18n";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { airlineLogoUrl } from "@/components/offer-doc/brand";
import { extractPdfText } from "@/lib/repackage/extract/pdf-text";
import { getOcrProvider } from "@/lib/repackage/extract/ocr";
import { isAiExtractionConfigured } from "@/lib/repackage/extract/ai-extract";
import { normalizeImage, pdfPageImages } from "@/lib/repackage/extract/page-images";
import { MAX_TICKET_BYTES, mergeTicket, parseTicketText, ticketGaps, type ParsedTicket } from "@/lib/flights/ticket-parse";
import { readTicketText, transcribeTicket } from "@/lib/flights/ticket-ai";

/**
 * «تصميم بطاقة الطيران» — read a ticket, hand the legs back for the employee to
 * confirm. NOTHING IS STORED: the upload lives in this request's memory, is read
 * and dropped. Nothing is logged either — a ticket carries passenger names and a
 * booking reference. Gated like the rest of /repackage (repackage.write).
 */

export type FlightCardLookups = {
  airports: { code: string; name: string }[];
  airlines: { iata: string; name: string; logo_url: string | null }[];
};

/** Our airport and carrier names, for the editor to name what a ticket prints as codes. */
export async function getFlightCardLookups(): Promise<FlightCardLookups> {
  const empty: FlightCardLookups = { airports: [], airlines: [] };
  if (!(await currentCan("repackage.write"))) return empty;
  try {
    const supabase = await createSupabaseServerClient();
    const [airports, airlines] = await Promise.all([
      supabase.from("airports").select("code, arabic_name").not("code", "is", null),
      supabase.from("airlines").select("iata, arabic_name, logo_path").neq("status", "Disabled"),
    ]);
    return {
      airports: ((airports.data ?? []) as { code: string; arabic_name: string }[]).map((a) => ({ code: a.code.toUpperCase(), name: a.arabic_name })),
      airlines: ((airlines.data ?? []) as { iata: string; arabic_name: string; logo_path: string | null }[]).map((a) => ({
        iata: a.iata.toUpperCase(),
        name: a.arabic_name,
        logo_url: airlineLogoUrl(a.logo_path),
      })),
    };
  } catch {
    return empty;
  }
}

/** How the words reached the parser — the screen says so, as /repackage does. */
export type TicketReadHow = "text" | "pdf" | "ocr" | "vision";

export type ReadTicketResult =
  | { ok: true; ticket: ParsedTicket; how: TicketReadHow; ai: boolean }
  | { ok: false; error: TranslationKey };

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
async function readPicture(bytes: Buffer, kind: Kind): Promise<{ text: string; how: TicketReadHow } | null> {
  const ocr = getOcrProvider();
  if (ocr.isConfigured()) {
    try {
      const result = await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime);
      if (result.text.trim()) return { text: result.text, how: "ocr" };
    } catch {
      /* fall through to the model */
    }
  }
  if (!isAiExtractionConfigured()) return null;
  const images = kind.kind === "pdf" ? await pdfPageImages(bytes).catch(() => []) : [await normalizeImage(bytes)];
  if (images.length === 0) return null;
  return { text: await transcribeTicket(images), how: "vision" };
}

export async function readFlightTicket(formData: FormData): Promise<ReadTicketResult> {
  try {
    if (!(await currentCan("repackage.write"))) return { ok: false, error: "err.forbidden" };

    const pasted = String(formData.get("text") ?? "").trim();
    const file = formData.get("file");
    let text = "";
    let how: TicketReadHow = "text";

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_TICKET_BYTES) return { ok: false, error: "fc.err.tooLarge" };
      const bytes = Buffer.from(await file.arrayBuffer());
      const kind = sniff(bytes);
      if (!kind) return { ok: false, error: "fc.err.type" };
      if (kind.kind === "pdf") {
        const layer = await extractPdfText(bytes).catch(() => null);
        if (layer && !layer.likelyScanned) {
          text = layer.text;
          how = "pdf";
        }
      }
      if (!text.trim()) {
        const read = await readPicture(bytes, kind).catch(() => null);
        if (!read) return { ok: false, error: isAiExtractionConfigured() || getOcrProvider().isConfigured() ? "fc.err.unreadable" : "fc.err.needsReader" };
        ({ text, how } = read);
      }
    } else if (pasted.length > 0) {
      text = pasted.slice(0, 50_000);
    } else {
      return { ok: false, error: "fc.err.empty" };
    }
    if (!text.trim()) return { ok: false, error: "fc.err.unreadable" };

    let ticket = parseTicketText(text);
    let ai = false;
    // the model only fills what the parser left empty — and only sees the ticket
    if (isAiExtractionConfigured() && ticketGaps(ticket).length > 0) {
      try {
        ticket = mergeTicket(ticket, await readTicketText(text));
        ai = true;
      } catch {
        /* the parser's reading stands; the employee fills the rest */
      }
    }
    if (ticket.legs.length === 0 && !ticket.pnr && ticket.passengers.length === 0) return { ok: false, error: "fc.err.nothing" };
    return { ok: true, ticket, how, ai };
  } catch {
    return { ok: false, error: "fc.err.unreadable" };
  }
}
