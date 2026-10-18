"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";
import { gateOperation, gateOps, gateRow, gateRows } from "@/lib/operations/access";
import { composeRequest } from "@/lib/data/supplier-work";

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

export type AssigneeKind = "ops" | "employee" | "partner" | "supplier";

export type BookingPartner = {
  id: string;
  name: string;
  kinds: string[];
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type AssigneeOption = {
  kind: AssigneeKind;
  id: string | null;
  label: string;
  phone: string | null;
  /** a supplier's «فنادق، طيران، تنقلات، خدمات» — the picker offers it for those kinds only. */
  categories?: string | null;
};

/** Everyone a booking can be handed to: the team, colleagues, partner companies, our suppliers. */
export async function listAssignees(): Promise<AssigneeOption[]> {
  if (await gateOps()) return [];
  try {
    const supabase = await db();
    const [emps, partners, suppliers] = await Promise.all([
      supabase.from("employees").select("id, arabic_name, mobile").order("arabic_name").limit(200),
      // «المطار» (0099) buys transport from us — a client, not someone we hand a booking to
      supabase.from("booking_partners").select("id, name, phone").eq("active", true).neq("portal", "transport").order("name"),
      supabase.from("company_suppliers").select("id, arabic_name, mobile, whatsapp, categories").neq("status", "Disabled").order("arabic_name"),
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
      ...((suppliers.data ?? []) as { id: string; arabic_name: string; mobile: string | null; whatsapp: string | null; categories: string | null }[]).map((s) => ({
        kind: "supplier" as const,
        id: s.id,
        label: s.arabic_name,
        phone: s.whatsapp || s.mobile,
        categories: s.categories,
      })),
    ];
  } catch {
    return [];
  }
}

export async function listPartners(): Promise<BookingPartner[]> {
  if (await gateOps()) return [];
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
  // the partner-agency list is shared, not a file's — the same any-operations
  // gate as before (sales edit it on /partner-companies with data.write anyway)
  const denied = await gateOps();
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
  const denied = await gateRow("operation_bookings", input.booking_id);
  if (denied) return { ok: false, error: denied };
  if (input.kind !== "ops" && !input.assignee_id) return { ok: false, error: "ops.err.pickAssignee" };

  try {
    const supabase = await db();
    const patch = {
      assignee_kind: input.kind,
      assignee_employee_id: input.kind === "employee" ? input.assignee_id : null,
      assignee_partner_id: input.kind === "partner" ? input.assignee_id : null,
      assigned_at: new Date().toISOString(),
      assigned_by: await getCurrentEmployeeId(),
      handoff_note: input.handoff_note ?? null,
    };
    const write = (values: Record<string, unknown>) => supabase.from("operation_bookings").update(values).eq("id", input.booking_id);
    let { error } = await write({ ...patch, assignee_supplier_id: input.kind === "supplier" ? input.assignee_id : null });
    // until 0063 is applied there is no supplier column — nobody but a supplier needs it
    if (error && input.kind !== "supplier") ({ error } = await write(patch));
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
  /** a supplier's email — the UI offers a mailto beside WhatsApp. */
  to_email?: string | null;
  subject?: string;
  body: string;
  /** false when there is no WhatsApp thread — the UI drops to copy / wa.me. */
  canSendWhatsapp: boolean;
};

/**
 * Compose the booking request for whoever the booking was handed to.
 *
 * Returned for REVIEW, never sent here. One composer for every assignee
 * (supplier-work.ts): a supplier gets it in its own language, everyone gets the
 * names as in the passport, the rooms, the flight times and the meeting point.
 */
export async function draftBookingRequest(bookingId: string): Promise<{ ok: true; draft: RequestDraft } | Fail> {
  return composeRequest(bookingId);
}

/**
 * Send the request the human just reviewed, and record it.
 *
 * `body` comes back from the browser deliberately: the agent may have edited it,
 * and what is stored has to be what actually went out, not what we drafted.
 */
export async function sendBookingRequest(input: {
  booking_id: string;
  /** more bookings the same message covers (composeRequest's alsoIds) — each marked requested, the message sent once. */
  also_ids?: string[];
  operation_id: string;
  channel: "whatsapp" | "manual";
  to_label: string;
  to_phone: string | null;
  body: string;
}): Promise<{ ok: true } | Fail> {
  // both ids come from the browser: the booking AND the case the log lands on
  const ids = [...new Set([input.booking_id, ...(input.also_ids ?? [])])];
  const denied = (await gateRows("operation_bookings", ids)) ?? (await gateOperation(input.operation_id));
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
      .in("id", ids)
      .in("status", ["pending", "prebooked", "in_flight", "failed"]);

    // the request's own clock — «بلا رد» is counted from here (0063)
    await supabase
      .from("operation_bookings")
      .update({ request_status: "sent", request_sent_at: new Date().toISOString(), request_answered_at: null })
      .in("id", ids)
      .neq("status", "cancelled");

    for (const id of ids) {
      await logAudit({
        action: "dispatch.sent",
        entity: "operation_bookings",
        entity_id: id,
        meta: { channel: input.channel, to: input.to_label },
      });
    }
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
  if (await gateOperation(operationId)) return [];
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
