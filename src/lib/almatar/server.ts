import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { publicBrandLogoUrl } from "@/components/offer-doc/brand";

/**
 * «المطار» — reads for its two screens. Every almatar_* table is closed to
 * every session (0100), so these go through the service role AFTER the caller
 * is resolved: Almatar's own login, or staff with the section's permission
 * (checked by the page and again by each action).
 */

export function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

export type AlmatarSession = {
  user_id: string;
  partner_id: string;
  name: string;
  name_latin: string | null;
  logo_url: string | null;
  brand_color: string;
  accent_color: string;
};

/** The transport partner behind this session, or null (staff, a package partner, a stranger, a suspended login). */
export async function getAlmatarSession(): Promise<AlmatarSession | null> {
  const user = await getServerUser();
  if (!user) return null;
  try {
    const { data } = await db()
      .from("partner_users")
      .select("status, booking_partners!inner(id, name, name_latin, logo_path, brand_color, accent_color, status, portal)")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const row = data as {
      status: string;
      booking_partners: { id: string; name: string; name_latin: string | null; logo_path: string | null; brand_color: string; accent_color: string; status: string; portal: string };
    } | null;
    const p = row?.booking_partners;
    if (!row || row.status !== "active" || !p || p.status !== "approved" || p.portal !== "transport") return null;
    return {
      user_id: user.id,
      partner_id: p.id,
      name: p.name,
      name_latin: p.name_latin,
      logo_url: publicBrandLogoUrl(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "", p.logo_path),
      brand_color: p.brand_color,
      accent_color: p.accent_color,
    };
  } catch {
    return null;
  }
}

export type AlmatarService = {
  id: string;
  country_code: string;
  country_ar: string;
  name_ar: string;
  scope_ar: string;
  kind: string;
  tz: string;
  price_small: number;
  price_medium: number;
  price_van10: number;
  valid_through: string;
  /** staff only — never sent to Almatar */
  review_note?: string | null;
};

/** What Almatar sees of its own bookings: no margin, no profit. */
export type AlmatarBooking = {
  id: string;
  ref: string;
  /** the request this line came in with (0101); null for a single booking taken before */
  request_ref: string | null;
  request_kind: string | null;
  service_id: string;
  vehicle: string;
  units: number;
  service_date: string;
  service_time: string;
  service_at: string;
  passengers: number;
  lead_name: string;
  lead_phone: string | null;
  flight_no: string | null;
  pickup: string | null;
  dropoff: string | null;
  notes: string | null;
  unit_price: number;
  total_sar: number;
  status: string;
  status_note: string | null;
  cancel_fee_pct: number | null;
  cancel_fee_sar: number | null;
  driver_info: string | null;
  voucher_token: string | null;
  created_at: string;
};

export type AlmatarStaffBooking = AlmatarBooking & { margin_pct: number; profit_sar: number; confirmed_at: string | null };

const SERVICE_COLS = "id, country_code, country_ar, name_ar, scope_ar, kind, tz, price_small, price_medium, price_van10, valid_through";
const BOOKING_COLS =
  "id, ref, request_ref, request_kind, service_id, vehicle, units, service_date, service_time, service_at, passengers, lead_name, lead_phone, flight_no, pickup, dropoff, notes, unit_price, total_sar, status, status_note, cancel_fee_pct, cancel_fee_sar, driver_info, voucher_token, created_at";

export async function listServices(withReview: boolean): Promise<AlmatarService[]> {
  const { data } = await db()
    .from("almatar_services")
    .select(withReview ? `${SERVICE_COLS}, review_note` : SERVICE_COLS)
    .eq("active", true)
    .order("sort");
  return (data ?? []) as unknown as AlmatarService[];
}

export async function listPartnerBookings(partnerId: string): Promise<AlmatarBooking[]> {
  const { data } = await db().from("almatar_bookings").select(BOOKING_COLS).eq("partner_id", partnerId).order("created_at", { ascending: false }).limit(300);
  return (data ?? []) as unknown as AlmatarBooking[];
}

export async function listAllBookings(): Promise<AlmatarStaffBooking[]> {
  const { data } = await db()
    .from("almatar_bookings")
    .select(`${BOOKING_COLS}, margin_pct, profit_sar, confirmed_at`)
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []) as unknown as AlmatarStaffBooking[];
}

export async function getMarginPct(): Promise<number> {
  const { data } = await db().from("almatar_settings").select("margin_pct").maybeSingle();
  return Number((data as { margin_pct: number } | null)?.margin_pct ?? 15);
}

/** The transport partner company (one today: Almatar, slug almatar). */
export async function getAlmatarCompany(): Promise<{ id: string; name: string } | null> {
  const { data } = await db().from("booking_partners").select("id, name").eq("slug", "almatar").eq("portal", "transport").maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

export async function listAlmatarLogins(partnerId: string): Promise<{ email: string; status: string; created_at: string }[]> {
  const { data } = await db().from("partner_users").select("email, status, created_at").eq("partner_id", partnerId).order("created_at");
  return (data ?? []) as { email: string; status: string; created_at: string }[];
}

export type AlmatarMessage = { id: string; sender: "partner" | "staff"; body: string; request_ref: string | null; read_at: string | null; created_at: string };

/**
 * «مخاطبة المورد» (0102) — the thread with one partner, oldest first. `reader`
 * marks the OTHER side's messages read: opening the thread is reading it.
 */
export async function listMessages(partnerId: string, reader: "partner" | "staff"): Promise<AlmatarMessage[]> {
  const { data } = await db()
    .from("almatar_messages")
    .select("id, sender, body, request_ref, read_at, created_at")
    .eq("partner_id", partnerId)
    .order("created_at")
    .limit(500);
  const rows = (data ?? []) as AlmatarMessage[];
  const other = reader === "partner" ? "staff" : "partner";
  if (rows.some((m) => m.sender === other && !m.read_at)) {
    await db().from("almatar_messages").update({ read_at: new Date().toISOString() }).eq("partner_id", partnerId).eq("sender", other).is("read_at", null);
  }
  return rows;
}
