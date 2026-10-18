import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TransportVoucherDocument, type TransportVoucher } from "@/components/offer-doc/TransportVoucherDocument";
import { partnerBrand, publicBrandLogoUrl, type PartnerBrandRow } from "@/components/offer-doc/brand";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { inlineImage } from "@/lib/offer-doc/assets";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { vehicleLabel } from "@/lib/almatar/rules";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * «المطار»'s transport voucher, in ITS identity. The token is the gate, as for
 * /voucher: 24 random bytes minted when we confirm, read here through the
 * service role (almatar_bookings is closed to every session), and dead the
 * moment the booking is no longer confirmed. Public under /b2b so the
 * traveller and the driver open it with no session.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return new NextResponse("Not found", { status: 404 });

  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await db
    .from("almatar_bookings")
    .select(
      "ref, status, units, vehicle, service_date, service_time, passengers, lead_name, lead_phone, flight_no, pickup, dropoff, notes, driver_info, confirmed_at, partner_id, almatar_services(name_ar, scope_ar, country_ar)",
    )
    .eq("voucher_token", token)
    .maybeSingle();
  const b = data as {
    ref: string;
    status: string;
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
    driver_info: string | null;
    confirmed_at: string | null;
    partner_id: string;
    almatar_services: { name_ar: string; scope_ar: string; country_ar: string } | null;
  } | null;
  if (!b || b.status !== "confirmed" || !b.almatar_services) return new NextResponse("Not found", { status: 404 });

  const { data: company } = await db
    .from("booking_partners")
    .select("name, name_latin, logo_path, brand_color, accent_color, address, phone, whatsapp, website, email, doc_font")
    .eq("id", b.partner_id)
    .maybeSingle();
  if (!company) return new NextResponse("Not found", { status: 404 });
  const row = company as PartnerBrandRow & { logo_path: string | null };
  const remote = publicBrandLogoUrl(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "", row.logo_path);
  // Chromium prints offline: the storage logo is inlined or it prints a broken box
  const brand = partnerBrand(row, remote ? ((await inlineImage(remote)) ?? null) : null);

  const voucher: TransportVoucher = {
    ref: b.ref,
    issued_at: b.confirmed_at ?? new Date().toISOString(),
    country: b.almatar_services.country_ar,
    service: b.almatar_services.name_ar,
    scope: b.almatar_services.scope_ar,
    vehicle: vehicleLabel(b.vehicle),
    units: b.units,
    date: b.service_date,
    time: b.service_time,
    passengers: b.passengers,
    lead_name: b.lead_name,
    lead_phone: b.lead_phone,
    flight_no: b.flight_no,
    pickup: b.pickup,
    dropoff: b.dropoff,
    notes: b.notes,
    driver_info: b.driver_info,
  };
  const html = await renderDocHtml((assets) => <TransportVoucherDocument voucher={voucher} brand={brand} assets={assets} />, brand.font);
  const pdf = await offerDocumentToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="transport-${b.ref}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
