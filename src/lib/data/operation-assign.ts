"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId, getCurrentRole } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { can } from "@/lib/roles/roles";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";

/**
 * Who is doing this booking.
 *
 * The office does not issue everything itself: some bookings ops handles, some
 * go to a partner agency, some to a named colleague. Without an owner on the
 * row, "who is chasing the Baku hotel?" is answered by asking around, and a
 * booking nobody picked up looks exactly like one somebody is working on.
 *
 * Assigning is a HANDOFF, not a status: it records who, when, by whom and what
 * they were asked to do — and then offers to send them the request. The sending
 * is a separate, explicit act, because a message that goes out the instant a
 * dropdown changes is a message nobody reviewed.
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

export type AssigneeKind = "ops" | "employee" | "partner";

export type BookingPartner = {
  id: string;
  name: string;
  kinds: string[];
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type AssigneeOption = { kind: AssigneeKind; id: string | null; label: string; phone: string | null };

/** Everyone a booking can be handed to: the team, colleagues, partner companies. */
export async function listAssignees(): Promise<AssigneeOption[]> {
  if (await requireOps()) return [];
  try {
    const supabase = await db();
    const [emps, partners] = await Promise.all([
      supabase.from("employees").select("id, arabic_name, mobile").order("arabic_name").limit(200),
      supabase.from("booking_partners").select("id, name, phone").eq("active", true).order("name"),
    ]);

    return [
      { kind: "ops" as const, id: null, label: "قسم العمليات", phone: null },
      ...((emps.data ?? []) as { id: string; arabic_name: string | null; mobile: string | null }[]).map((e) => ({
        kind: "employee" as const,
        id: e.id,
        label: e.arabic_name ?? "—",
        phone: e.mobile,
      })),
      ...((partners.data ?? []) as { id: string; name: string; phone: string | null }[]).map((p) => ({
        kind: "partner" as const,
        id: p.id,
        label: p.name,
        phone: p.phone,
      })),
    ];
  } catch {
    return [];
  }
}

export async function listPartners(): Promise<BookingPartner[]> {
  if (await requireOps()) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("booking_partners")
      .select("id, name, kinds, contact_name, phone, email, active")
      .order("name");
    return (data ?? []) as BookingPartner[];
  } catch {
    return [];
  }
}

export async function upsertPartner(input: {
  id?: string;
  name: string;
  kinds?: string[];
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  active?: boolean;
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!input.name.trim()) return { ok: false, error: "ops.err.titleRequired" };
  try {
    const supabase = await db();
    const patch = {
      name: input.name.trim(),
      kinds: input.kinds ?? [],
      contact_name: input.contact_name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      active: input.active ?? true,
    };
    const q = input.id
      ? supabase.from("booking_partners").update(patch).eq("id", input.id).select("id").single()
      : supabase.from("booking_partners").insert(patch).select("id").single();
    const { data, error } = await q;
    if (error || !data) return { ok: false, error: "err.createFailed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Hand a booking to someone.
 *
 * Does NOT send anything — see the module note. The caller offers the request
 * message afterwards, and a human presses send.
 */
export async function assignBooking(input: {
  booking_id: string;
  kind: AssigneeKind;
  assignee_id?: string | null;
  handoff_note?: string | null;
}): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (input.kind !== "ops" && !input.assignee_id) return { ok: false, error: "ops.err.pickAssignee" };

  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_bookings")
      .update({
        assignee_kind: input.kind,
        assignee_employee_id: input.kind === "employee" ? input.assignee_id : null,
        assignee_partner_id: input.kind === "partner" ? input.assignee_id : null,
        assigned_at: new Date().toISOString(),
        assigned_by: await getCurrentEmployeeId(),
        handoff_note: input.handoff_note ?? null,
      })
      .eq("id", input.booking_id);
    if (error) return { ok: false, error: "err.updateFailed" };

    await logAudit({
      action: "booking.created",
      entity: "operation_bookings",
      entity_id: input.booking_id,
      meta: { assigned: input.kind, assignee_id: input.assignee_id ?? null },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type RequestDraft = {
  to_label: string;
  to_phone: string | null;
  body: string;
  /** false when there is no WhatsApp thread — the UI drops to copy / wa.me. */
  canSendWhatsapp: boolean;
};

/**
 * Compose the booking request for whoever the booking was handed to.
 *
 * Returned for REVIEW, never sent here. Everything on it comes from the
 * operation, so the assignee gets the dates and the room the client agreed to
 * rather than a paraphrase typed at speed.
 */
export async function draftBookingRequest(bookingId: string): Promise<{ ok: true; draft: RequestDraft } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select(
        "id, kind, title, city_name, start_date, end_date, detail, handoff_note, assignee_kind, employees:assignee_employee_id(arabic_name, mobile), booking_partners:assignee_partner_id(name, phone, contact_name), operations(offers(serial, customers(arabic_name)))",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!data) return { ok: false, error: "ops.err.notFound" };

    const row = data as unknown as {
      kind: string;
      title: string;
      city_name: string;
      start_date: string | null;
      end_date: string | null;
      detail: Record<string, string> | null;
      handoff_note: string | null;
      assignee_kind: AssigneeKind;
      employees: { arabic_name: string | null; mobile: string | null } | { arabic_name: string | null; mobile: string | null }[] | null;
      booking_partners: { name: string; phone: string | null; contact_name: string | null } | { name: string; phone: string | null; contact_name: string | null }[] | null;
      operations: unknown;
    };

    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    const emp = one(row.employees);
    const partner = one(row.booking_partners);
    const op = one(row.operations as { offers: unknown } | { offers: unknown }[] | null);
    const offer = one((op as { offers?: unknown } | null)?.offers as { serial: string; customers: unknown } | { serial: string; customers: unknown }[] | null);
    const cust = one(offer?.customers as { arabic_name: string | null } | { arabic_name: string | null }[] | null);

    const to_label = row.assignee_kind === "partner" ? (partner?.name ?? "—") : row.assignee_kind === "employee" ? (emp?.arabic_name ?? "—") : "قسم العمليات";
    const to_phone = row.assignee_kind === "partner" ? (partner?.phone ?? null) : row.assignee_kind === "employee" ? (emp?.mobile ?? null) : null;

    const details = Object.entries(row.detail ?? {}).map(([k, v]) => `• ${k}: ${v}`);
    const body = [
      "طلب حجز — ترافليون للسفر والسياحة",
      "",
      `العميل: ${cust?.arabic_name ?? "—"}`,
      `رقم العرض: ${offer?.serial ?? "—"}`,
      "",
      `المطلوب: ${row.title}${row.city_name ? ` — ${row.city_name}` : ""}`,
      row.start_date ? `من: ${row.start_date}${row.end_date ? `  إلى: ${row.end_date}` : ""}` : null,
      ...details,
      row.handoff_note ? `\nملاحظة: ${row.handoff_note}` : null,
      "",
      "يُرجى التأكيد مع رقم الحجز وسياسة الإلغاء.",
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const conversationId = to_phone ? await conversationForPhone(to_phone) : null;
    return { ok: true, draft: { to_label, to_phone, body, canSendWhatsapp: conversationId !== null } };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Send the request the human just reviewed, and record it.
 *
 * `body` comes back from the browser deliberately: the agent may have edited it,
 * and what is stored has to be what actually went out, not what we drafted.
 */
export async function sendBookingRequest(input: {
  booking_id: string;
  operation_id: string;
  channel: "whatsapp" | "manual";
  to_label: string;
  to_phone: string | null;
  body: string;
}): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!input.body.trim()) return { ok: false, error: "ops.err.emptyMessage" };

  try {
    const supabase = await db();
    let providerMessageId: string | null = null;

    if (input.channel === "whatsapp") {
      const conversationId = input.to_phone ? await conversationForPhone(input.to_phone) : null;
      if (!conversationId) return { ok: false, error: "ops.err.noConversation" };
      const sent = await sendTeletelMessage(conversationId, input.body);
      if (sent === null) return { ok: false, error: "ops.err.sendFailed" };
      providerMessageId = String(sent);
    }

    await supabase.from("operation_dispatches").insert({
      operation_id: input.operation_id,
      channel: input.channel,
      audience: "supplier",
      template: "booking_request",
      to_label: input.to_label,
      to_address: input.to_phone,
      body: input.body,
      status: "sent",
      provider_message_id: providerMessageId,
      approved_by: await getCurrentEmployeeId(),
      sent_at: new Date().toISOString(),
    });

    // «مطلوب» — but only if the supplier has not already answered. Re-sending a
    // request (an amendment, a chase, a second copy) must never erase a
    // confirmation number that is already printed on a voucher in the client's
    // hands, and must not resurrect a cancelled booking either.
    await supabase
      .from("operation_bookings")
      .update({ status: "pending" })
      .eq("id", input.booking_id)
      .in("status", ["pending", "prebooked", "in_flight", "failed"]);

    await logAudit({
      action: "dispatch.sent",
      entity: "operation_bookings",
      entity_id: input.booking_id,
      meta: { channel: input.channel, to: input.to_label },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type SentRequest = {
  id: string;
  channel: string;
  to_label: string;
  sent_at: string | null;
  body: string;
};

/** What was already sent for this operation — the paper trail per case. */
export async function listSentRequests(operationId: string): Promise<SentRequest[]> {
  if (await requireOps()) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_dispatches")
      .select("id, channel, to_label, sent_at, body")
      .eq("operation_id", operationId)
      .order("sent_at", { ascending: false });
    return (data ?? []) as SentRequest[];
  } catch {
    return [];
  }
}
