import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { clientService, flightLegs, type ClientService, type Leg } from "@/lib/operations/drivers";
import { toClientInfo, type ClientInfo } from "@/lib/operations/case-list";

/**
 * Everything the traveller's trip page shows beyond the documents — the
 * flights, the stays, the day-by-day programme, the drives, what is left to pay.
 *
 * Same gate as getClientHub: the token, read with the SERVICE role (the
 * traveller has no session). And the same promise: nothing here is a cost, a
 * supplier, an internal note or a passport. Booking detail is free-form, so it
 * is read through ALLOWLISTS — a key ops (or a later feature) adds to a booking
 * stays off this page until someone decides it belongs on it.
 */

export type TripFlight = { title: string; confirmed: boolean; pnr: string | null; cabin: string; legs: (Leg & { label: string })[] };
export type TripHotel = { name: string; city: string; check_in: string | null; check_out: string | null; nights: string; rooms: string[]; confirmed: boolean; confirmation: string | null };
export type TripDay = { day_number: number; date: string | null; city: string; title: string; activities: string[]; note: string };

export type ClientTrip = {
  today: string;
  travellers: number;
  flights: TripFlight[];
  hotels: TripHotel[];
  days: TripDay[];
  services: ClientService[];
  /** null for a partner's file — their client pays them, and our ledger is not theirs to see. */
  money: { total: number; paid: number; remaining: number; currency: string } | null;
  info: ClientInfo;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** The rooms of a stay, as the voucher words them — and nothing else from its detail. */
const ROOM_KEY = /^(الغرفة|نوع الغرفة|الإقامة|عدد الغرف)/;

export async function getClientTrip(token: string): Promise<ClientTrip | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const opRes = await supabase
      .from("operations")
      .select("id, offer_id, client_token_revoked_at, offers(total, currency, adults, children, infants, partner_company_id)")
      .eq("client_token", token)
      .maybeSingle();
    type OfferRow = { total: number | null; currency: string | null; adults: number | null; children: number | null; infants: number | null; partner_company_id: string | null };
    const op = opRes.data as unknown as { id: string; offer_id: string; client_token_revoked_at: string | null; offers: OfferRow | OfferRow[] | null } | null;
    if (!op || op.client_token_revoked_at) return null;
    const offer = one(op.offers);

    const [bookingsRes, daysRes, paymentsRes, infoRes] = await Promise.all([
      supabase
        .from("operation_bookings")
        .select("kind, title, city_name, start_date, end_date, detail, status, confirmation_number")
        .eq("operation_id", op.id)
        .neq("status", "cancelled")
        .order("start_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("offer_days")
        .select("day_number, day_date, city_name, title, activities, transport_note")
        .eq("offer_id", op.offer_id)
        .order("day_number", { ascending: true }),
      supabase.from("operation_payments").select("amount, kind").eq("operation_id", op.id),
      // 0064's column, on its own: a missing column must not take the whole page down
      supabase.from("operations").select("client_info").eq("id", op.id).maybeSingle(),
    ]);

    // the company's day — the driver card turns on at the Riyadh midnight of the service date
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const bookings = (bookingsRes.data ?? []) as {
      kind: string;
      title: string;
      city_name: string;
      start_date: string | null;
      end_date: string | null;
      detail: Record<string, string> | null;
      status: string;
      confirmation_number: string | null;
    }[];

    const flights = bookings
      .filter((b) => b.kind === "flight")
      .map((b) => ({
        title: b.title,
        confirmed: b.status === "confirmed",
        pnr: b.status === "confirmed" ? b.confirmation_number : null,
        cabin: b.detail?.["الدرجة"] ?? "",
        legs: flightLegs(b.detail ?? {}).map(({ key, leg }) => ({ ...leg, label: key === "رقم الرحلة" ? "" : key })),
      }));

    const hotels = bookings
      .filter((b) => b.kind === "hotel")
      .map((b) => {
        const d = b.detail ?? {};
        return {
          name: b.title,
          city: b.city_name || d["المدينة"] || "",
          check_in: b.start_date,
          check_out: b.end_date,
          nights: d["عدد الليالي"] ?? "",
          rooms: Object.entries(d)
            .filter(([k]) => ROOM_KEY.test(k))
            .map(([k, v]) => `${k}: ${v}`),
          confirmed: b.status === "confirmed",
          confirmation: b.status === "confirmed" ? b.confirmation_number : null,
        };
      });

    const services = bookings
      .map((b) => clientService(b, today))
      .filter((s): s is ClientService => s !== null)
      .sort((a, b) => `${a.date ?? "9999"} ${a.time || "99:99"}`.localeCompare(`${b.date ?? "9999"} ${b.time || "99:99"}`));

    const days = ((daysRes.data ?? []) as {
      day_number: number;
      day_date: string | null;
      city_name: string | null;
      title: string | null;
      activities: string[] | null;
      transport_note: string | null;
    }[]).map((d) => ({
      day_number: d.day_number,
      date: d.day_date,
      city: d.city_name ?? "",
      title: d.title ?? "",
      activities: d.activities ?? [],
      note: d.transport_note ?? "",
    }));

    const paid = ((paymentsRes.data ?? []) as { amount: number; kind: string }[]).reduce(
      (s, p) => s + (p.kind === "refund" ? -Number(p.amount) : Number(p.amount)),
      0,
    );
    const total = offer?.total != null ? Number(offer.total) : null;

    return {
      today,
      travellers: (offer?.adults ?? 0) + (offer?.children ?? 0) + (offer?.infants ?? 0),
      flights,
      hotels,
      days,
      services,
      money:
        total != null && !offer?.partner_company_id
          ? { total, paid, remaining: Math.max(0, total - paid), currency: offer?.currency ?? "SAR" }
          : null,
      info: toClientInfo((infoRes.data as { client_info?: unknown } | null)?.client_info),
    };
  } catch {
    return null;
  }
}
