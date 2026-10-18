import { NextResponse } from "next/server";
import { TransportRequestDocument, type TransportRequest } from "@/components/offer-doc/TransportRequestDocument";
import { partnerBrand, publicBrandLogoUrl, type PartnerBrandRow } from "@/components/offer-doc/brand";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { inlineImage } from "@/lib/offer-doc/assets";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { currentCan } from "@/lib/roles/current";
import { db, getAlmatarSession } from "@/lib/almatar/server";
import { REQUEST_KINDS, REQUEST_REF, vehicleLabel } from "@/lib/almatar/rules";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * «طباعة الحجز» — one Almatar request as a PDF in Almatar's identity (0101).
 * Under /b2b, which the proxy leaves public, so the gate is HERE: Almatar's own
 * session (its own requests only), or our staff who manage them.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!REQUEST_REF.test(ref)) return new NextResponse("Not found", { status: 404 });

  const session = await getAlmatarSession();
  const staff = !session && ((await currentCan("operations.write")) || (await currentCan("settings.manage")));
  if (!session && !staff) return new NextResponse("Not found", { status: 404 });

  let query = db()
    .from("almatar_bookings")
    .select(
      "ref, request_kind, created_at, partner_id, units, vehicle, service_date, service_time, passengers, lead_name, lead_phone, flight_no, pickup, dropoff, notes, almatar_services(name_ar, scope_ar, country_ar)",
    )
    .eq("request_ref", ref)
    // transport is booked to run: what was cancelled or refused is not printed
    .in("status", ["pending", "confirmed"])
    .order("service_at");
  if (session) query = query.eq("partner_id", session.partner_id);
  const { data } = await query;
  const rows = (data ?? []) as unknown as {
    ref: string;
    request_kind: string | null;
    created_at: string;
    partner_id: string;
    units: number;
    vehicle: string;
    service_date: string;
    service_time: string;
    passengers: number;
    lead_name: string;
    lead_phone: string | null;
    flight_no: string | null;
    pickup: string | null;
    dropoff: string | null;
    notes: string | null;
    almatar_services: { name_ar: string; scope_ar: string; country_ar: string } | null;
  }[];
  if (rows.length === 0) return new NextResponse("Not found", { status: 404 });

  const { data: company } = await db()
    .from("booking_partners")
    .select("name, name_latin, logo_path, brand_color, accent_color, address, phone, whatsapp, website, email, doc_font")
    .eq("id", rows[0].partner_id)
    .maybeSingle();
  if (!company) return new NextResponse("Not found", { status: 404 });
  const row = company as PartnerBrandRow & { logo_path: string | null };
  const remote = publicBrandLogoUrl(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "", row.logo_path);
  const brand = partnerBrand(row, remote ? ((await inlineImage(remote)) ?? null) : null);

  const first = rows[0];
  const request: TransportRequest = {
    ref,
    kind: REQUEST_KINDS.find((k) => k.id === first.request_kind)?.label ?? "حجز",
    created_at: first.created_at,
    country: first.almatar_services?.country_ar ?? "",
    client_name: first.lead_name,
    client_phone: first.lead_phone,
    passengers: first.passengers,
    notes: first.notes,
    lines: rows.map((r) => ({
      ref: r.ref,
      service: r.almatar_services?.name_ar ?? "",
      scope: r.almatar_services?.scope_ar ?? "",
      date: r.service_date,
      time: r.service_time,
      vehicle: vehicleLabel(r.vehicle),
      units: r.units,
      flight_no: r.flight_no,
      pickup: r.pickup,
      dropoff: r.dropoff,
    })),
  };
  const html = await renderDocHtml((assets) => <TransportRequestDocument request={request} brand={brand} assets={assets} />, brand.font);
  const pdf = await offerDocumentToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="request-${ref}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
