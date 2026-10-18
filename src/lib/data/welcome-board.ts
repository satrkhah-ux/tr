import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveDocBrand } from "@/lib/data/doc-brand";
import { getPartnerSession, isStaffSession } from "@/lib/partners/session";
import { fontFamilyOf, type DocFont } from "@/lib/offer-doc/font-families";
import type { WelcomeBoard } from "@/components/offer-doc/WelcomeBoardDocument";
import { leadName } from "@/lib/operations/travelers";

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
 * the ordinary case, not an edge one. Without one it is the lead traveller's as
 * in the passport (leadName — the ONE rule the issued board, the driver's
 * programme and its buttons use too), never the client's WhatsApp contact name
 * (the owner, 2026-10-18); nobody named yet prints the serial.
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
  /** Which family the renderer must embed for this company. */
  font: DocFont;
  /** The lead traveller's name as in the passport, offered as the default the operator can overwrite. */
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
      .select("id, serial, destination, partner_company_id")
      .eq("serial", serial)
      .maybeSingle();

    const row = data as { id: string; serial: string; destination: string | null; partner_company_id: string | null } | null;
    if (!row) return null;

    // the case's travellers, when the trip has one (operations.offer_id is unique)
    const { data: op } = await supabase.from("operations").select("id").eq("offer_id", row.id).maybeSingle();
    const opId = (op as { id: string } | null)?.id;
    const travelers = opId
      ? (((await supabase.from("operation_travelers").select("display_name").eq("operation_id", opId).order("sort", { ascending: true })).data ?? []) as { display_name: string }[])
      : [];
    const defaultName = leadName(travelers);

    const { brand } = await resolveDocBrand({ serial, partnerId: row.partner_company_id });

    return {
      defaultName,
      font: brand.font,
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
        fontFamily: fontFamilyOf(brand.font),
      },
    };
  } catch {
    return null;
  }
}
