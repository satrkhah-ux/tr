import { FlightCardDocument } from "@/components/offer-doc/FlightCardDocument";
import { airlineLogoUrl } from "@/components/offer-doc/brand";
import { sanitizeTicket } from "@/lib/flights/ticket-parse";
import { inlineImage } from "@/lib/offer-doc/assets";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { documentToPng, offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * POST the confirmed card → its PDF (default) or PNG (?format=png).
 *
 * The body is the editor's form, so it is cut down by sanitizeTicket before it
 * touches the document, and carrier marks are looked up here by IATA — a logo
 * URL from the browser would make this server fetch whatever it was told to.
 * Rendered in memory and returned; nothing is stored or logged.
 */
export async function POST(request: Request) {
  if (!(await currentCan("repackage.write"))) return new Response("Forbidden", { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const ticket = sanitizeTicket(body);
  if (ticket.legs.length === 0) return new Response("No flights", { status: 400 });

  const iatas = [...new Set(ticket.legs.map((l) => l.airline_iata).filter(Boolean))];
  const logos: Record<string, string> = {};
  if (iatas.length) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("airlines").select("iata, logo_path").in("iata", iatas);
    await Promise.all(
      ((data ?? []) as { iata: string; logo_path: string | null }[]).map(async (row) => {
        const url = airlineLogoUrl(row.logo_path);
        // Chromium prints offline: the mark travels inside the HTML
        const inlined = url ? await inlineImage(url) : null;
        if (inlined) logos[row.iata.toUpperCase()] = inlined;
      }),
    );
  }

  const png = new URL(request.url).searchParams.get("format") === "png";
  const html = await renderDocHtml((assets) => <FlightCardDocument ticket={ticket} logos={logos} assets={assets} fit={png} />);
  const bytes = png ? await documentToPng(html) : await offerDocumentToPdf(html);
  const name = `flight-card-${ticket.pnr || "traveliun"}.${png ? "png" : "pdf"}`;

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": png ? "image/png" : "application/pdf",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
