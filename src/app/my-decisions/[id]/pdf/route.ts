import { NextResponse } from "next/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import {
  decisionHtml,
  getDecision,
  recipientsOf,
} from "@/lib/decisions/decisions";
import { mayRead } from "@/lib/decisions/core";
import { letterSheet } from "@/lib/telegram/staff-letters";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * A decision's PDF (or one of the sales letters: «letter-<id>»). The administration (employees.manage) reads any — a
 * draft too, as its preview — with the list of who acknowledged; an employee reads only a copy addressed to them, with
 * their own acknowledgement. Anything else is «not found».
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const me = await getCurrentEmployeeId();
  if (!me) return new NextResponse("Not found", { status: 404 });
  const viewer = { id: me, manager: await currentCan("employees.manage") };

  let html: string | null = null;
  let name = id;
  if (/^letter-\d+$/.test(id)) {
    const sheet = await letterSheet(Number(id.slice(7)));
    if (sheet && mayRead(viewer, [sheet.employeeId])) {
      html = sheet.html;
      name = `letter-${sheet.number}`;
    }
  } else {
    const d = await getDecision(id);
    const recipients = d ? await recipientsOf(id) : [];
    if (
      d &&
      (d.status === "issued"
        ? mayRead(
            viewer,
            recipients.map((r) => r.employee_id),
          )
        : viewer.manager)
    ) {
      const own = recipients.find((r) => r.employee_id === me);
      html = await decisionHtml(
        d,
        viewer.manager
          ? { recipients }
          : { copy: { name: own!.name, acknowledgedAt: own!.acknowledged_at } },
      );
      name = d.serial ?? "preview";
    }
  }
  if (!html) return new NextResponse("Not found", { status: 404 });

  const pdf = await offerDocumentToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="decision-${encodeURIComponent(name)}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
