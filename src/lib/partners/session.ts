import "server-only";
import { ttlCache } from "@/lib/ttl-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { publicBrandLogoUrl } from "@/components/offer-doc/brand";
import type { PartnerBrand } from "./PartnerContext";
import type { PartnerTerms } from "./pricing";
import { cache } from "react";
import { effectiveTerms, quarterStart, type Tier, type TierState } from "./tiers";

/**
 * Who is signed in on the partner side.
 *
 * The database already refuses a partner everything that is not theirs (0034's
 * is_staff() and 0035's partner policies), so for most tables this is not the
 * security boundary — it is how the app knows which screens to draw. Drafts are
 * the exception: they hold our cost, so 0047 closed them to every session and
 * draft-store.ts scopes a partner to their own company by THIS answer.
 */

export type PartnerSession = {
  user_id: string;
  partner_id: string;
  partner_name: string;
  partner_name_latin: string | null;
  address: string | null;
  email: string;
  /** owner: the account and the team; sales: offers and confirmations only (0059). */
  role: "owner" | "sales";
  /** the terms in force — the approved percentage, or the ladder's step this quarter (0060). */
  terms: PartnerTerms;
  /** the approved percentage, the files confirmed this quarter and the next step. */
  tier: { base_pct: number; confirmed: number; next: TierState["next"] };
  brand_color: string;
  accent_color: string;
  logo_path: string | null;
};

function db(): SupabaseClient {
  // Service client on purpose: this resolves WHO the caller is, so it cannot
  // depend on policies that are themselves keyed to the answer.
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

/**
 * The partner behind the current session, or null for staff and strangers.
 *
 * Suspended accounts and unapproved companies resolve to null, which is the
 * same answer as "not a partner" — a suspended partner should find the portal
 * shut, not half-open.
 */
export async function getPartnerSession(): Promise<PartnerSession | null> {
  const user = await getServerUser();
  if (!user) return null;
  // across requests, 30 s per account — staff included («not a partner»): every
  // navigation asked, and each ask is a round trip to the database in Mumbai
  const known = partnerSessions.get(user.id);
  if (known) return known.session;
  const session = await loadPartnerSession();
  partnerSessions.set(user.id, { session });
  return session;
}

const partnerSessions = ttlCache<string, { session: PartnerSession | null }>(30_000);

async function loadPartnerSession(): Promise<PartnerSession | null> {
  try {
    const user = await getServerUser();
    if (!user) return null;

    const { data } = await db()
      .from("partner_users")
      .select(
        "email, status, role, booking_partners!inner(id, name, name_latin, address, status, portal, price_adjust_kind, price_adjust_pct, brand_color, accent_color, logo_path)",
      )
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const row = data as unknown as {
      email: string;
      status: string;
      role: string | null;
      booking_partners:
        | {
            id: string;
            name: string;
            name_latin: string | null;
            address: string | null;
            status: string;
            portal: string | null;
            price_adjust_kind: string;
            price_adjust_pct: number;
            brand_color: string;
            accent_color: string;
            logo_path: string | null;
          }
        | null;
    } | null;
    if (!row || row.status !== "active") return null;

    const company = Array.isArray(row.booking_partners) ? row.booking_partners[0] : row.booking_partners;
    if (!company || company.status !== "approved") return null;
    // a transport-only partner («المطار», 0099) has its own screen (lib/almatar), never the package portal
    if (company.portal === "transport") return null;

    return {
      user_id: user.id,
      partner_id: company.id,
      partner_name: company.name,
      partner_name_latin: company.name_latin,
      address: company.address,
      email: row.email,
      role: row.role === "sales" ? "sales" : "owner",
      ...(await (async () => {
        const kind = company.price_adjust_kind === "commission" ? "commission" : "markup";
        const base = Number(company.price_adjust_pct) || 0;
        const state = await tierState(company.id, kind, base);
        return { terms: state.terms, tier: { base_pct: base, confirmed: state.confirmed, next: state.next } };
      })()),
      brand_color: company.brand_color,
      accent_color: company.accent_color,
      logo_path: company.logo_path,
    };
  } catch {
    return null;
  }
}

/**
 * The same session, shaped for the UI: what the shell needs to wear their name
 * instead of ours. Called once per request in the root layout.
 */
export async function getPartnerBrand(): Promise<PartnerBrand | null> {
  const partner = await getPartnerSession();
  if (!partner) return null;
  return {
    name: partner.partner_name,
    nameLatin: partner.partner_name_latin,
    logoUrl: publicBrandLogoUrl(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "", partner.logo_path),
    brandColor: partner.brand_color,
    accentColor: partner.accent_color,
    address: partner.address,
  };
}

/** True for a staff member — i.e. the app's mirror of the database's is_staff(). */
export async function isStaffSession(): Promise<boolean> {
  try {
    const user = await getServerUser();
    if (!user) return false;
    const { data } = await db().from("employees").select("id, status").eq("auth_user_id", user.id).maybeSingle();
    const row = data as { id: string; status: string | null } | null;
    return Boolean(row && (row.status ?? "Active") === "Active");
  } catch {
    return false;
  }
}

/**
 * The ladder's step for a company this quarter — once per request (React
 * cache: the session is read by the layout, the page and every action). A
 * company with no ladder keeps its approved percentage; a failed read does too.
 */
const tierState = cache(async (partnerId: string, kind: PartnerTerms["kind"], pct: number): Promise<TierState> => {
  const base: PartnerTerms = { kind, pct };
  try {
    const supabase = db();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const [tiers, confirmed] = await Promise.all([
      supabase.from("partner_commission_tiers").select("partner_id, min_confirmed, pct").or(`partner_id.is.null,partner_id.eq.${partnerId}`),
      supabase
        .from("operations")
        .select("id, offers!inner(partner_company_id)", { count: "exact", head: true })
        .eq("offers.partner_company_id", partnerId)
        .neq("client_status", "cancelled")
        .gte("confirmed_at", quarterStart(today)),
    ]);
    return effectiveTerms(base, (tiers.data ?? []) as Tier[], partnerId, confirmed.count ?? 0);
  } catch {
    return { terms: base, confirmed: 0, next: null };
  }
});

/**
 * A company's terms in force, for a file someone ELSE issues on its behalf
 * (an employee choosing the company): the same ladder the partner's own session
 * sees, so both ways of issuing price it alike.
 */
export async function partnerTermsById(partnerId: string): Promise<PartnerTerms | null> {
  try {
    const { data } = await db().from("booking_partners").select("price_adjust_kind, price_adjust_pct").eq("id", partnerId).maybeSingle();
    const row = data as { price_adjust_kind: string; price_adjust_pct: number | string } | null;
    if (!row) return null;
    return (await tierState(partnerId, row.price_adjust_kind === "commission" ? "commission" : "markup", Number(row.price_adjust_pct) || 0)).terms;
  } catch {
    return null;
  }
}
