"use server";

import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId, getCurrentRole } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { can } from "@/lib/roles/roles";
import { listTravelers } from "@/lib/data/operation-travelers";
import type { VoucherBooking, VoucherDTO, VoucherKind } from "@/lib/operations/voucher-dto";

/**
 * Bookings and the documents issued from them.
 *
 * Everything here works MANUALLY today: the agent types the confirmation number
 * read off a supplier email or portal. The supplier-API path writes the same
 * columns through the same action, so connecting TBO later changes no schema and
 * no screen — which matters, because those credentials do not exist yet and the
 * ops team needs this working now.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };

async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return can(await getCurrentRole(), "operations.write") ? null : "ops.err.forbidden";
}

export type BookingKind = "hotel" | "flight" | "visa" | "transport" | "service";
export type BookingStatus = "pending" | "prebooked" | "in_flight" | "confirmed" | "failed" | "cancelled";

export type OperationBooking = {
  id: string;
  operation_id: string;
  kind: BookingKind;
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string>;
  supplier_name: string;
  source: "manual" | "api";
  status: BookingStatus;
  /**
   * Acknowledged by the supplier is NOT the same as ticketed. An airline holding
   * a seat and an issued ticket are different facts, and a voucher printed for
   * the first has to say so — otherwise a family is turned away at the counter
   * holding a document that looked confirmed.
   */
  is_paid: boolean;
  origin: "manual" | "offer";
  confirmation_number: string | null;
  quoted_net: number | null;
  net_charged: number | null;
  currency: string;
  cancellation_policy: string | null;
  cancellation_deadline: string | null;
  note: string | null;
};

export async function listBookings(operationId: string): Promise<OperationBooking[]> {
  if (await requireOps()) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select(
        "id, operation_id, kind, title, city_name, start_date, end_date, detail, supplier_name, source, status, is_paid, origin, confirmation_number, quoted_net, net_charged, currency, cancellation_policy, cancellation_deadline, note",
      )
      .eq("operation_id", operationId)
      .order("start_date", { ascending: true, nullsFirst: false });
    return (data ?? []) as OperationBooking[];
  } catch {
    return [];
  }
}

export async function addBooking(input: {
  operation_id: string;
  kind: BookingKind;
  title: string;
  city_name?: string;
  start_date?: string | null;
  end_date?: string | null;
  detail?: Record<string, string>;
  supplier_name?: string;
  quoted_net?: number | null;
  currency?: string;
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!input.title.trim()) return { ok: false, error: "ops.err.titleRequired" };

  try {
    const supabase = await db();
    const { data, error } = await supabase
      .from("operation_bookings")
      .insert({
        operation_id: input.operation_id,
        kind: input.kind,
        title: input.title.trim(),
        city_name: input.city_name ?? "",
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        detail: input.detail ?? {},
        supplier_name: input.supplier_name ?? "",
        source: "manual",
        status: "pending",
        // Written on creation, before any supplier call could ever happen. The
        // unique index on this column is the double-booking guard.
        client_reference: `TRV-${randomUUID()}`,
        quoted_net: input.quoted_net ?? null,
        currency: input.currency ?? "SAR",
        created_by: await getCurrentEmployeeId(),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };

    const id = (data as { id: string }).id;
    await logAudit({
      action: "booking.created",
      entity: "operation_bookings",
      entity_id: id,
      meta: { operation_id: input.operation_id, kind: input.kind, source: "manual" },
    });
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Record a confirmation the agent read off a supplier email or portal.
 *
 * There is no silent path to 'confirmed': the confirmation number is required,
 * because "confirmed" without one is a claim nobody can check at the hotel desk.
 */
export async function confirmBookingManually(input: {
  booking_id: string;
  confirmation_number: string;
  net_charged?: number | null;
  cancellation_policy?: string | null;
  cancellation_deadline?: string | null;
}): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!input.confirmation_number.trim()) return { ok: false, error: "ops.err.confirmationRequired" };

  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_bookings")
      .update({
        status: "confirmed",
        confirmation_number: input.confirmation_number.trim(),
        net_charged: input.net_charged ?? null,
        cancellation_policy: input.cancellation_policy ?? null,
        cancellation_deadline: input.cancellation_deadline ?? null,
        confirmed_at: new Date().toISOString(),
        confirmed_by: await getCurrentEmployeeId(),
      })
      .eq("id", input.booking_id);
    if (error) return { ok: false, error: "err.updateFailed" };

    await logAudit({
      action: "booking.confirmed",
      entity: "operation_bookings",
      entity_id: input.booking_id,
      meta: { confirmation_number: input.confirmation_number.trim(), source: "manual" },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Mark a confirmed booking as actually paid / ticketed.
 *
 * Separate from confirmation on purpose — see OperationBooking.is_paid. Only a
 * paid booking prints a clean voucher; a confirmed-but-unpaid one prints with a
 * warning band across it.
 */
export async function markBookingPaid(bookingId: string, paid: boolean): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_bookings")
      .update({ is_paid: paid, paid_at: paid ? new Date().toISOString() : null })
      .eq("id", bookingId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "booking.confirmed",
      entity: "operation_bookings",
      entity_id: bookingId,
      meta: { is_paid: paid },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function cancelBooking(bookingId: string, reason: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), note: reason })
      .eq("id", bookingId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "booking.cancelled", entity: "operation_bookings", entity_id: bookingId, meta: { reason } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteBooking(bookingId: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase.from("operation_bookings").delete().eq("id", bookingId);
    return error ? { ok: false, error: "err.deleteFailed" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------------- documents ----------------

export type OperationDocument = {
  id: string;
  kind: VoucherKind;
  booking_id: string | null;
  version: number;
  token: string;
  revoked_at: string | null;
  created_at: string;
};

export async function listDocuments(operationId: string): Promise<OperationDocument[]> {
  if (await requireOps()) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_documents")
      .select("id, kind, booking_id, version, token, revoked_at, created_at")
      .eq("operation_id", operationId)
      .order("created_at", { ascending: false });
    return (data ?? []) as OperationDocument[];
  } catch {
    return [];
  }
}

function toVoucherBooking(b: OperationBooking): VoucherBooking {
  return {
    kind: b.kind,
    title: b.title,
    city_name: b.city_name,
    start_date: b.start_date,
    end_date: b.end_date,
    confirmation_number: b.confirmation_number,
    supplier_name: b.supplier_name,
    detail: b.detail ?? {},
    cancellation_policy: b.cancellation_policy,
    is_paid: b.is_paid,
  };
}

/**
 * Freeze a voucher.
 *
 * The snapshot IS the document: re-rendering it later must not pick up a hotel
 * name or a date that changed after the traveller was handed the paper. Same
 * reasoning as offer_renders, which is why neither is generated on the fly.
 *
 * A voucher can only be issued against a CONFIRMED booking. Handing someone a
 * document for a room nobody booked is worse than handing them nothing — they
 * stop chasing it and find out at the desk.
 */
export async function issueDocument(input: {
  operation_id: string;
  kind: VoucherKind;
  booking_id?: string | null;
}): Promise<{ ok: true; id: string; token: string } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = await db();

    const opRes = await supabase
      .from("operations")
      .select("id, offer_id, offers(serial, destination, customers(arabic_name, mobile))")
      .eq("id", input.operation_id)
      .maybeSingle();
    if (!opRes.data) return { ok: false, error: "ops.err.notFound" };
    const op = opRes.data as unknown as {
      offer_id: string;
      offers:
        | { serial: string; destination: string | null; customers: { arabic_name: string | null; mobile: string | null } | { arabic_name: string | null; mobile: string | null }[] | null }
        | { serial: string; destination: string | null; customers: unknown }[]
        | null;
    };
    const offer = Array.isArray(op.offers) ? op.offers[0] : op.offers;
    const cust = Array.isArray(offer?.customers) ? offer?.customers[0] : offer?.customers;
    const customer = (cust ?? null) as { arabic_name: string | null; mobile: string | null } | null;

    const [allBookings, travelers, daysRes] = await Promise.all([
      listBookings(input.operation_id),
      listTravelers(input.operation_id),
      supabase
        // the column is day_date, not date — selecting a name that does not
        // exist makes PostgREST return NOTHING rather than error loudly, which
        // reads as "this trip has no program" instead of "the query is wrong"
        .from("offer_days")
        .select("day_number, day_date, city_name, title, activities")
        .eq("offer_id", op.offer_id)
        .order("day_number", { ascending: true }),
    ]);

    // Only confirmed bookings belong on a document handed to a traveller.
    const confirmed = allBookings.filter((b) => b.status === "confirmed");
    const scoped = input.booking_id
      ? confirmed.filter((b) => b.id === input.booking_id)
      : input.kind === "hotel_voucher"
        ? confirmed.filter((b) => b.kind === "hotel")
        : input.kind === "flight_ticket"
          ? confirmed.filter((b) => b.kind === "flight")
          : input.kind === "booking_summary"
            ? confirmed
            : [];

    const days = ((daysRes.data ?? []) as {
      day_number: number;
      day_date: string | null;
      city_name: string | null;
      title: string | null;
      activities: string[] | null;
    }[]).map((d) => ({
      day_number: d.day_number,
      date: d.day_date,
      city_name: d.city_name ?? "",
      title: d.title ?? "",
      activities: d.activities ?? [],
    }));

    if (input.kind === "itinerary" ? days.length === 0 : scoped.length === 0) {
      return { ok: false, error: "ops.err.nothingToIssue" };
    }

    const snapshot: VoucherDTO = {
      kind: input.kind,
      serial: offer?.serial ?? "",
      issued_at: new Date().toISOString().slice(0, 10),
      destination: offer?.destination ?? null,
      customer: { name: customer?.arabic_name ?? "", phone: customer?.mobile ?? null },
      travelers: travelers.map((t) => ({ name: t.display_name, nationality: null })),
      bookings: scoped.map(toVoucherBooking),
      days: input.kind === "itinerary" ? days : [],
      notes: [],
    };

    const prev = await supabase
      .from("operation_documents")
      .select("version")
      .eq("operation_id", input.operation_id)
      .eq("kind", input.kind)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((prev.data as { version: number } | null)?.version ?? 0) + 1;

    // 32 bytes of randomness: the token IS the access control for the public
    // link, so it must not be guessable the way a serial is.
    const token = randomBytes(24).toString("base64url");

    const { data, error } = await supabase
      .from("operation_documents")
      .insert({
        operation_id: input.operation_id,
        booking_id: input.booking_id ?? null,
        kind: input.kind,
        version,
        snapshot_json: snapshot,
        token,
        issued_by: await getCurrentEmployeeId(),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };

    const id = (data as { id: string }).id;
    await logAudit({
      action: "voucher.issued",
      entity: "operation_documents",
      entity_id: id,
      meta: { operation_id: input.operation_id, kind: input.kind, version },
    });
    return { ok: true, id, token };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function revokeDocument(documentId: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_documents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "voucher.revoked", entity: "operation_documents", entity_id: documentId });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
