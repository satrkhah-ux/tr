"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { listTravelers } from "@/lib/data/operation-travelers";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";
import { COMPANY } from "@/components/offer-doc/labels";
import { currentCan } from "@/lib/roles/current";
import { DRV, driverMessage, driverServiceKind, meetTime, type ServiceKind } from "@/lib/operations/drivers";

/**
 * «السائقون والاستقبال» — the driver's card sent to the driver, and the day's
 * drives of every case on one sheet.
 *
 * The card's facts are booking detail (edited through updateBooking like any
 * other detail); this module only reads them out and sends them. Sending is a
 * reviewed act, as for supplier requests: the message is drafted, shown in an
 * editable box, and leaves when a human presses the button.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };

async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("operations.write")) ? null : "ops.err.forbidden";
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type OfferJoin = { serial: string; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null };
type OpJoin = { execution_status?: string; offers: OfferJoin | OfferJoin[] | null };

export type DriverDraft = { to_label: string; to_phone: string | null; body: string; canSendWhatsapp: boolean };

export async function draftDriverMessage(bookingId: string): Promise<{ ok: true; draft: DriverDraft } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select("id, operation_id, kind, title, city_name, start_date, detail, operations(offers(serial, customers(arabic_name)))")
      .eq("id", bookingId)
      .maybeSingle();
    const row = data as unknown as {
      operation_id: string;
      kind: string;
      title: string;
      city_name: string;
      start_date: string | null;
      detail: Record<string, string> | null;
      operations: OpJoin | OpJoin[] | null;
    } | null;
    const kind = row ? driverServiceKind(row) : null;
    if (!row || !kind) return { ok: false, error: "ops.err.notFound" };
    const offer = one(one(row.operations)?.offers);
    const d = row.detail ?? {};

    // the hotel the drive starts or ends at: the stay in the same city that covers the day
    const [staysRes, travelers] = await Promise.all([
      supabase
        .from("operation_bookings")
        .select("title, city_name, start_date, end_date")
        .eq("operation_id", row.operation_id)
        .eq("kind", "hotel")
        .neq("status", "cancelled"),
      listTravelers(row.operation_id),
    ]);
    const city = row.city_name.trim();
    const stays = ((staysRes.data ?? []) as { title: string; city_name: string; start_date: string | null; end_date: string | null }[]).filter(
      (s) => s.city_name.trim() === city,
    );
    const day = row.start_date ?? "";
    const stay = stays.find((s) => day && (s.start_date ?? "") <= day && day <= (s.end_date ?? s.start_date ?? "")) ?? stays[0] ?? null;
    let hotel: { name: string; name_en: string | null; address: string | null; city: string } | null = null;
    if (stay) {
      // what the driver types into a map: the English name and address from /hotels
      const { data: h } = await supabase.from("hotels").select("english_name, address").eq("arabic_name", stay.title.trim()).limit(1).maybeSingle();
      const info = h as { english_name: string | null; address: string | null } | null;
      hotel = { name: stay.title, name_en: info?.english_name ?? null, address: info?.address ?? null, city };
    }

    const guests = travelers.map((t) => t.display_name).filter(Boolean);
    const body = driverMessage({
      kind,
      serial: offer?.serial ?? "",
      title: row.title,
      date: row.start_date,
      time: meetTime(row),
      flight: d[DRV.flight] ?? "",
      meet: d[DRV.meet] ?? "",
      hotel,
      guests: guests.length > 0 ? guests : [one(offer?.customers)?.arabic_name ?? ""].filter(Boolean),
      pax: d["الركاب"] ?? "",
      car: d[DRV.car] ?? "",
      plate: d[DRV.plate] ?? "",
      // the driver works for us whoever sold the trip — he calls our operations line
      contact: COMPANY.phone,
    });

    const to_phone = d[DRV.phone]?.trim() || null;
    const conversation = to_phone ? await conversationForPhone(to_phone) : null;
    return { ok: true, draft: { to_label: d[DRV.driver]?.trim() || "السائق", to_phone, body, canSendWhatsapp: conversation !== null } };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Send the card the agent reviewed, and keep what went out.
 *
 * The operation is read off the booking, not taken from the browser: the
 * dispatch log is the case's paper trail and must land on the right case.
 */
export async function sendDriverMessage(input: {
  booking_id: string;
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
    const { data } = await supabase.from("operation_bookings").select("operation_id").eq("id", input.booking_id).maybeSingle();
    const operationId = (data as { operation_id: string } | null)?.operation_id;
    if (!operationId) return { ok: false, error: "ops.err.notFound" };

    let providerMessageId: string | null = null;
    if (input.channel === "whatsapp") {
      // an existing Teletel conversation only — a new one cannot be opened safely (teletel.ts)
      const conversationId = input.to_phone ? await conversationForPhone(input.to_phone) : null;
      if (!conversationId) return { ok: false, error: "ops.err.noConversation" };
      const sent = await sendTeletelMessage(conversationId, input.body);
      if (sent === null) return { ok: false, error: "ops.err.sendFailed" };
      providerMessageId = String(sent);
    }

    await supabase.from("operation_dispatches").insert({
      operation_id: operationId,
      channel: input.channel,
      // a driver is the ground supplier's man — the existing audience, not a new one
      audience: "supplier",
      template: "driver_card",
      to_label: input.to_label,
      to_address: input.to_phone,
      body: input.body,
      status: "sent",
      provider_message_id: providerMessageId,
      approved_by: await getCurrentEmployeeId(),
      sent_at: new Date().toISOString(),
    });
    await logAudit({
      action: "dispatch.sent",
      entity: "operation_bookings",
      entity_id: input.booking_id,
      meta: { channel: input.channel, to: input.to_label, template: "driver_card" },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ScheduleRow = {
  id: string;
  operation_id: string;
  serial: string;
  customer: string | null;
  kind: ServiceKind;
  title: string;
  city: string;
  time: string;
  flight: string;
  meet: string;
  car: string;
  plate: string;
  driver: string;
  phone: string;
  pax: string;
  confirmed: boolean;
};

/** Every drive and tour of every live case on one date, in the order the cars leave. */
export async function listDriverSchedule(date: string): Promise<ScheduleRow[]> {
  if (await requireOps()) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select("id, operation_id, kind, title, city_name, start_date, detail, status, operations(execution_status, offers(serial, customers(arabic_name)))")
      .eq("start_date", date)
      .in("kind", ["transport", "service"])
      .neq("status", "cancelled");
    const rows = (data ?? []) as unknown as {
      id: string;
      operation_id: string;
      kind: string;
      title: string;
      city_name: string;
      start_date: string | null;
      detail: Record<string, string> | null;
      status: string;
      operations: OpJoin | OpJoin[] | null;
    }[];
    return rows
      .flatMap((r): ScheduleRow[] => {
        const kind = driverServiceKind(r);
        const op = one(r.operations);
        if (!kind || op?.execution_status === "cancelled") return [];
        const offer = one(op?.offers);
        const d = r.detail ?? {};
        return [
          {
            id: r.id,
            operation_id: r.operation_id,
            serial: offer?.serial ?? "",
            customer: one(offer?.customers)?.arabic_name ?? null,
            kind,
            title: r.title,
            city: r.city_name.trim(),
            time: meetTime(r),
            flight: d[DRV.flight] ?? "",
            meet: d[DRV.meet] ?? "",
            car: d[DRV.car] ?? "",
            plate: d[DRV.plate] ?? "",
            driver: d[DRV.driver] ?? "",
            phone: d[DRV.phone] ?? "",
            pax: d["الركاب"] ?? "",
            confirmed: r.status === "confirmed",
          },
        ];
      })
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  } catch {
    return [];
  }
}
