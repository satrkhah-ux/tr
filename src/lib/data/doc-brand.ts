import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { TRAVELIUN_BRAND, partnerBrand, publicBrandLogoUrl, type DocBrand, type PartnerBrandRow } from "@/components/offer-doc/brand";

/**
 * Whose identity a document prints — for server code only (pages, PDF routes,
 * other server modules). Not a server action: it reads through the service role,
 * so nothing a browser can call may export it.
 */

export type ResolvedBrand = { brand: DocBrand; showPrices: boolean; partnerId: string | null };

const BRAND_COLUMNS = "id, name, name_latin, logo_path, brand_color, accent_color, address, phone, whatsapp, website, email, doc_font";

/**
 * The brand a document should print, resolved server-side.
 *
 * `partnerId` wins when given (the export screen's picker); otherwise the
 * offer's own stored partner is used, so a file re-downloaded next week comes out
 * branded the way it was sent. Anything unresolvable falls back to OUR identity —
 * never to a half-filled partner block.
 */
export async function resolveDocBrand(input: {
  serial: string;
  partnerId?: string | null;
  showPrices?: boolean;
}): Promise<ResolvedBrand> {
  const fallback: ResolvedBrand = { brand: TRAVELIUN_BRAND, showPrices: input.showPrices ?? true, partnerId: null };
  try {
    // SERVICE client, deliberately: the public client link and its PDF have no
    // session, and booking_partners is readable by `authenticated` only — with
    // the user client those two surfaces would silently print OUR branding on a
    // partner's file. Nothing sensitive leaves: what comes back is exactly the
    // name, logo and colours the document is meant to display.
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;

    // One read: whose file it is, and whether it prints a price. Both live on the
    // offer, so the export screen, the PDF and the client link cannot disagree.
    const offerRes = await supabase
      .from("offers")
      .select("partner_company_id, show_prices")
      .eq("serial", input.serial)
      .maybeSingle();
    const offer = offerRes.data as { partner_company_id: string | null; show_prices: boolean } | null;
    const storedPrices = offer?.show_prices ?? true;

    const id = input.partnerId ?? offer?.partner_company_id ?? null;
    if (!id) return { ...fallback, showPrices: input.showPrices ?? storedPrices };

    const { data } = await supabase.from("booking_partners").select(BRAND_COLUMNS).eq("id", id).maybeSingle();
    const row = data as (PartnerBrandRow & { id: string; logo_path: string | null }) | null;
    if (!row) return fallback;

    return {
      brand: partnerBrand(row, publicBrandLogoUrl(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "", row.logo_path)),
      // An explicit choice from the export screen wins; otherwise whatever that
      // screen last saved on this offer.
      showPrices: input.showPrices ?? storedPrices,
      partnerId: row.id,
    };
  } catch {
    return fallback;
  }
}
