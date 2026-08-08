import { NextResponse } from "next/server";
import { WelcomeBoardDocument } from "@/components/offer-doc/WelcomeBoardDocument";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { boardAccess, getWelcomeBoard } from "@/lib/data/welcome-board";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * GET /welcome-board/[serial]/pdf?name=…&subtitle=…
 *
 * The sign, printed on demand.
 *
 * SESSION-GATED, unlike /client-offer — the sheet's entire content is a
 * traveller's name and the day they land, which is precisely what should not
 * hang on a guessable URL. Staff may print any; a partner may print only their
 * own company's, checked against the offer's partner_company_id rather than
 * against anything the caller sends.
 *
 * The name arrives as a parameter because it is the operator's decision at the
 * moment of printing: clients ask for a specific spelling, a title, or the name
 * of whoever is actually meeting the driver.
 */
export async function GET(req: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;

  const access = await boardAccess(serial);
  if (access === "denied") return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const source = await getWelcomeBoard(serial, {
    name: url.searchParams.get("name"),
    subtitle: url.searchParams.get("subtitle"),
  });
  if (!source) return new NextResponse("Not found", { status: 404 });

  const html = await renderDocHtml(() => <WelcomeBoardDocument board={source.board} />);
  const pdf = await offerDocumentToPdf(html);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // inline: the operator looks at it before deciding to print
      "content-disposition": `inline; filename="welcome-${serial}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
