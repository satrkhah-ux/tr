import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveDocBrand } from "@/lib/data/partner-companies";
import { getPartnerSession, isStaffSession } from "@/lib/partners/session";
import type { WelcomeBoard } from "@/components/offer-doc/WelcomeBoardDocument";

/**
 * The airport sign for one issued offer.
 *
 * The identity is NOT a parameter. It is resolved from the offer's own company
 * through the same `resolveDocBrand` the client document uses, so a partner's
 * board carries their logo and colours for the same reason their offer does —
 * and neither can be spoofed by whoever calls the route.
 *
 * The NAME is a parameter, and deliberately so: a client asking for a specific
 * spelling, a title, or the name of the person actually meeting the driver is
 * the ordinary case, not an edge one. It never defaults to empty — an unnamed
 * sign is worse than none.
 */

export type BoardAccess = "staff" | "partner" | "denied";

/** Who may print this offer's board: us, or the company that owns it. */
export async function boardAccess(serial: string): Promise<BoardAccess> {
  if (await isStaffSession()) return "staff";
  const partner = await getPartnerSession();
  if (!partner) return "denied";
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await supabase
    .from("offers")
    .select("partner_company_id")
    .eq("serial", serial)
    .maybeSingle();
  const row = data as { partner_company_id: string | null } | null;
  return row && row.partner_company_id === partner.partner_id ? "partner" : "denied";
}

export type BoardSource = {
  board: WelcomeBoard;
  /** The booking name, offered as the default the operator can overwrite. */
  defaultName: string;
};

export async function getWelcomeBoard(
  serial: string,
  override?: { name?: string | null; subtitle?: string | null },
): Promise<BoardSource | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase
      .from("offers")
      .select("id, serial, destination, partner_company_id, customers(name)")
      .eq("serial", serial)
      .maybeSingle();

    const row = data as {
      id: string;
      serial: string;
      destination: string | null;
      partner_company_id: string | null;
      customers: { name: string | null } | { name: string | null }[] | null;
    } | null;
    if (!row) return null;

    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const defaultName = (customer?.name ?? "").trim();

    const { brand } = await resolveDocBrand({ serial, partnerId: row.partner_company_id });

    return {
      defaultName,
      board: {
        name: (override?.name ?? "").trim() || defaultName || row.serial,
        subtitle: (override?.subtitle ?? "").trim() || null,
        companyNameAr: brand.nameAr,
        companyNameLatin: brand.nameLatin,
        logoUrl: brand.logoUrl,
        // brandVars publishes the company's two hexes as --od-green (primary)
        // and --od-gold (accent). Our own brand has vars:null — it IS the
        // stylesheet's palette — so the fallbacks below are the house colours,
        // not placeholders.
        brandColor: brand.vars?.["--od-green"] ?? "#135549",
        accentColor: brand.vars?.["--od-gold"] ?? "#f0ad22",
      },
    };
  } catch {
    return null;
  }
}
