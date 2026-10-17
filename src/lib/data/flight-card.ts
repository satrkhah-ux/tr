"use server";

import type { TranslationKey } from "@/lib/i18n";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { airlineLogoUrl } from "@/components/offer-doc/brand";
import { isAiExtractionConfigured } from "@/lib/repackage/extract/ai-extract";
import { uploadText, type UploadHow } from "@/lib/repackage/extract/upload-text";
import { mergeTicket, parseTicketText, ticketGaps, type ParsedTicket } from "@/lib/flights/ticket-parse";
import { readTicketText } from "@/lib/flights/ticket-ai";

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
export type TicketReadHow = UploadHow;

export type ReadTicketResult =
  | { ok: true; ticket: ParsedTicket; how: TicketReadHow; ai: boolean }
  | { ok: false; error: TranslationKey };

export async function readFlightTicket(formData: FormData): Promise<ReadTicketResult> {
  try {
    if (!(await currentCan("repackage.write"))) return { ok: false, error: "err.forbidden" };

    const read = await uploadText(formData, "flight ticket");
    if (!read.ok) return { ok: false, error: `fc.err.${read.error}` };
    const { text, how } = read;

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
