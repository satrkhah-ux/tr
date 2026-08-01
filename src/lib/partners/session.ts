import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import type { PartnerTerms } from "./pricing";

/**
 * Who is signed in on the partner side.
 *
 * The database already refuses a partner everything that is not theirs (0034's
 * is_staff() and 0035's partner policies), so this is not the security boundary
 * — it is how the app knows which screens to draw and whose company to stamp on
 * a draft. Both layers agree on the same rule, and the one that cannot be
 * bypassed is the one in the database.
 */

export type PartnerSession = {
  user_id: string;
  partner_id: string;
  partner_name: string;
  email: string;
  terms: PartnerTerms;
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
  try {
    const user = await getServerUser();
    if (!user) return null;

    const { data } = await db()
      .from("partner_users")
      .select(
        "email, status, booking_partners!inner(id, name, status, price_adjust_kind, price_adjust_pct, brand_color, accent_color, logo_path)",
      )
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const row = data as unknown as {
      email: string;
      status: string;
      booking_partners:
        | {
            id: string;
            name: string;
            status: string;
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

    return {
      user_id: user.id,
      partner_id: company.id,
      partner_name: company.name,
      email: row.email,
      terms: {
        kind: company.price_adjust_kind === "commission" ? "commission" : "markup",
        pct: Number(company.price_adjust_pct) || 0,
      },
      brand_color: company.brand_color,
      accent_color: company.accent_color,
      logo_path: company.logo_path,
    };
  } catch {
    return null;
  }
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
