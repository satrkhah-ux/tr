"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { notifyOperationConfirmed } from "@/lib/data/ops-notify";
import { setOfferStatus } from "@/lib/data/offer-status";
import {
  canAdvanceClient,
  canAdvanceExecution,
  isClientStatus,
  isExecutionStatus,
  kanbanStageFor,
  type ClientStatus,
  type ExecutionStatus,
} from "@/lib/operations/state";
import { currentCan } from "@/lib/roles/current";

/**
 * «العمليات» — the execution hub. This module is the ONLY writer of
 * operations.client_status and operations.execution_status; bookings, dispatches
 * and vouchers all advance the track by calling setExecutionStatus rather than
 * touching the column, so the transition rules cannot be bypassed.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

/** null when allowed, else the i18n key to return. */
async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return await currentCan("operations.write") ? null : "ops.err.forbidden";
}

export type ConfirmChannel = "phone" | "whatsapp" | "office" | "other";

export type OperationRow = {
  id: string;
  offer_id: string;
  render_id: string | null;
  client_status: ClientStatus;
  execution_status: ExecutionStatus;
  travel_start: string | null;
  travel_end: string | null;
  confirm_channel: ConfirmChannel | null;
  confirmed_at: string;
  note: string | null;
};

/** One row of the operations board — the offer joined in, no passport data. */
export type OperationCard = OperationRow & {
  serial: string;
  destination: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total: number | null;
  currency: string | null;
  paid: number;
  travelers_count: number;
};

type OkId = { ok: true; id: string };
type Fail = { ok: false; error: TranslationKey };

/**
 * Turn a confirmed offer into an operation.
 *
 * v1 records what the AGENT was told — the client confirms by phone or WhatsApp,
 * so there is no client-facing button and no token (a token on `offers` would be
 * anon-readable and would let a stranger confirm every offer in the system).
 *
 * IDEMPOTENT by unique(offer_id): an agent will double-click, and two agents may
 * confirm the same case at once. Both end at the same row.
 */
export async function confirmOffer(input: {
  offer_id: string;
  channel?: ConfirmChannel;
  note?: string | null;
}): Promise<OkId | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = await db();

    const existing = await supabase.from("operations").select("id").eq("offer_id", input.offer_id).maybeSingle();
    if (existing.data) return { ok: true, id: (existing.data as { id: string }).id };

    // The offer's own status trail records the commercial fact; the operation
    // records the work. Both, not one.
    await setOfferStatus(supabase, input.offer_id, "confirmed", input.note ?? "confirmed by agent");

    // Point at the frozen internal render rather than copying the document.
    // offer_renders is append-only, so this IS an immutable snapshot.
    const render = await supabase
      .from("offer_renders")
      .select("id, snapshot_json")
      .eq("offer_id", input.offer_id)
      .eq("variant", "internal")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const snapshot = (render.data as { id: string; snapshot_json: Record<string, unknown> } | null) ?? null;
    const snap = (snapshot?.snapshot_json ?? {}) as { arrival_date?: string | null; departure_date?: string | null };

    const { data, error } = await supabase
      .from("operations")
      .insert({
        offer_id: input.offer_id,
        render_id: snapshot?.id ?? null,
        travel_start: snap.arrival_date ?? null,
        travel_end: snap.departure_date ?? null,
        confirm_channel: input.channel ?? "phone",
        confirmed_by: await getCurrentEmployeeId(),
        note: input.note ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      // A concurrent confirm hit the unique index — re-select rather than fail.
      const retry = await supabase.from("operations").select("id").eq("offer_id", input.offer_id).maybeSingle();
      if (retry.data) return { ok: true, id: (retry.data as { id: string }).id };
      return { ok: false, error: "ops.err.confirmFailed" };
    }

    const id = (data as { id: string }).id;
    await logAudit({
      action: "operation.confirmed",
      entity: "operations",
      entity_id: id,
      meta: { offer_id: input.offer_id, channel: input.channel ?? "phone" },
    });

    // Push it at the ops team rather than waiting for someone to open the board.
    // Best-effort: a failed notification must not undo a confirmation that has
    // already been recorded — the operation exists either way.
    try {
      const offerRes = await supabase
        .from("offers")
        .select("serial, destination, customers(arabic_name)")
        .eq("id", input.offer_id)
        .maybeSingle();
      const o = offerRes.data as unknown as {
        serial: string;
        destination: string | null;
        customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
      } | null;
      await notifyOperationConfirmed({
        serial: o?.serial ?? "",
        customer: one(o?.customers)?.arabic_name ?? null,
        destination: o?.destination ?? null,
        travelStart: snap.arrival_date ?? null,
        operationId: id,
        confirmedBy: (await getServerUser())?.email ?? null,
      });
    } catch {
      /* notification is best-effort */
    }

    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

async function loadStatuses(
  supabase: SupabaseClient,
  operationId: string,
): Promise<{ id: string; offer_id: string; client_status: ClientStatus; execution_status: ExecutionStatus } | null> {
  const { data } = await supabase
    .from("operations")
    .select("id, offer_id, client_status, execution_status")
    .eq("id", operationId)
    .maybeSingle();
  const row = data as { id: string; offer_id: string; client_status: string; execution_status: string } | null;
  if (!row || !isClientStatus(row.client_status) || !isExecutionStatus(row.execution_status)) return null;
  return { ...row, client_status: row.client_status, execution_status: row.execution_status };
}

export async function setClientStatus(
  operationId: string,
  to: ClientStatus,
  note?: string | null,
): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const current = await loadStatuses(supabase, operationId);
    if (!current) return { ok: false, error: "err.loadFailed" };
    if (!canAdvanceClient(current.client_status, to)) return { ok: false, error: "ops.err.invalidTransition" };

    await supabase
      .from("operations")
      .update({ client_status: to, updated_at: new Date().toISOString() })
      .eq("id", operationId);
    await logAudit({
      action: "operation.client_status",
      entity: "operations",
      entity_id: operationId,
      meta: { from: current.client_status, to, note: note ?? null },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Advance the execution track — and re-project the kanban stage in the same
 * breath, so a card cannot sit on «الطيران» while the vouchers are already out.
 *
 * ponytail: the projection overwrites a manual kanban drag on an offer that has
 * an operation. Disable drag for those cards if it ever bites.
 */
export async function setExecutionStatus(
  operationId: string,
  to: ExecutionStatus,
  note?: string | null,
): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const current = await loadStatuses(supabase, operationId);
    if (!current) return { ok: false, error: "err.loadFailed" };
    if (!canAdvanceExecution(current.execution_status, to)) return { ok: false, error: "ops.err.invalidTransition" };

    await supabase
      .from("operations")
      .update({ execution_status: to, updated_at: new Date().toISOString() })
      .eq("id", operationId);

    const stage = kanbanStageFor(to);
    if (stage) await supabase.from("offers").update({ pipeline_stage: stage }).eq("id", current.offer_id);

    await logAudit({
      action: to === "cancelled" ? "operation.cancelled" : "operation.execution_status",
      entity: "operations",
      entity_id: operationId,
      meta: { from: current.execution_status, to, note: note ?? null },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type PaymentKind = "deposit" | "installment" | "final" | "refund";
export type PaymentMethod = "transfer" | "cash" | "pos" | "link";

export type OperationPayment = {
  id: string;
  amount: number;
  currency: string;
  kind: PaymentKind;
  method: PaymentMethod | null;
  reference: string | null;
  paid_at: string;
  note: string | null;
};

export async function recordPayment(input: {
  operation_id: string;
  amount: number;
  currency?: string;
  kind?: PaymentKind;
  method?: PaymentMethod | null;
  reference?: string | null;
  paid_at?: string;
  note?: string | null;
}): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!(input.amount > 0)) return { ok: false, error: "ops.err.amountPositive" };
  try {
    const supabase = await db();
    const { error } = await supabase.from("operation_payments").insert({
      operation_id: input.operation_id,
      amount: input.amount,
      currency: input.currency ?? "SAR",
      kind: input.kind ?? "deposit",
      method: input.method ?? null,
      reference: input.reference ?? null,
      paid_at: input.paid_at ?? new Date().toISOString().slice(0, 10),
      recorded_by: await getCurrentEmployeeId(),
      note: input.note ?? null,
    });
    if (error) return { ok: false, error: "err.createFailed" };

    await logAudit({
      action: "payment.recorded",
      entity: "operations",
      entity_id: input.operation_id,
      meta: { amount: input.amount, currency: input.currency ?? "SAR", kind: input.kind ?? "deposit" },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function listOperationPayments(operationId: string): Promise<OperationPayment[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await db();
    const { data } = await supabase
      .from("operation_payments")
      .select("id, amount, currency, kind, method, reference, paid_at, note")
      .eq("operation_id", operationId)
      .order("paid_at", { ascending: false });
    return ((data ?? []) as OperationPayment[]).map((p) => ({ ...p, amount: Number(p.amount) }));
  } catch {
    return [];
  }
}

type OfferJoin = {
  serial: string;
  destination: string | null;
  total: number | null;
  currency: string | null;
  customers: { arabic_name: string | null; mobile: string | null } | null;
};

/**
 * PostgREST types an embedded relation as an ARRAY even when the foreign key
 * makes it to-one, so every join in this file lands as `T[] | T | null`. One
 * helper rather than a cast at each site — a cast would silently accept the
 * array and give `undefined` for every joined field.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** The board: every live operation with what the cards and signals need. */
export async function listOperations(): Promise<OperationCard[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await db();

    const { data } = await supabase
      .from("operations")
      .select(
        "id, offer_id, render_id, client_status, execution_status, travel_start, travel_end, confirm_channel, confirmed_at, note, offers(serial, destination, total, currency, customers(arabic_name, mobile))",
      )
      .order("travel_start", { ascending: true, nullsFirst: false });

    const rows = (data ?? []) as unknown as (OperationRow & { offers: OfferJoin | OfferJoin[] | null })[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [payRes, travRes] = await Promise.all([
      supabase.from("operation_payments").select("operation_id, amount, kind").in("operation_id", ids),
      supabase.from("operation_travelers").select("operation_id").in("operation_id", ids),
    ]);

    const paid = new Map<string, number>();
    for (const p of (payRes.data ?? []) as { operation_id: string; amount: number; kind: string }[]) {
      const delta = p.kind === "refund" ? -Number(p.amount) : Number(p.amount);
      paid.set(p.operation_id, (paid.get(p.operation_id) ?? 0) + delta);
    }
    const travelers = new Map<string, number>();
    for (const t of (travRes.data ?? []) as { operation_id: string }[]) {
      travelers.set(t.operation_id, (travelers.get(t.operation_id) ?? 0) + 1);
    }

    return rows.map((r) => {
      const offer = one(r.offers);
      const customer = one(offer?.customers);
      return {
        id: r.id,
        offer_id: r.offer_id,
        render_id: r.render_id,
        client_status: r.client_status,
        execution_status: r.execution_status,
        travel_start: r.travel_start,
        travel_end: r.travel_end,
        confirm_channel: r.confirm_channel,
        confirmed_at: r.confirmed_at,
        note: r.note,
        serial: offer?.serial ?? "",
        destination: offer?.destination ?? null,
        customer_name: customer?.arabic_name ?? null,
        customer_phone: customer?.mobile ?? null,
        total: offer?.total != null ? Number(offer.total) : null,
        currency: offer?.currency ?? null,
        paid: paid.get(r.id) ?? 0,
        travelers_count: travelers.get(r.id) ?? 0,
      };
    });
  } catch {
    return [];
  }
}

/** Confirmed offers that have no operation yet — the board's "start" list. */
export type ConfirmableOffer = { id: string; serial: string; destination: string | null; customer_name: string | null };

export async function listConfirmableOffers(limit = 40): Promise<ConfirmableOffer[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await db();

    const [offersRes, opsRes] = await Promise.all([
      supabase
        .from("offers")
        .select("id, serial, destination, customers(arabic_name)")
        .in("status", ["sent", "confirmed"])
        .order("created_at", { ascending: false })
        .limit(limit * 3),
      supabase.from("operations").select("offer_id"),
    ]);

    const taken = new Set(((opsRes.data ?? []) as { offer_id: string }[]).map((o) => o.offer_id));
    type OfferRow = {
      id: string;
      serial: string;
      destination: string | null;
      customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
    };
    const rows = (offersRes.data ?? []) as unknown as OfferRow[];

    return rows
      .filter((o) => !taken.has(o.id))
      .slice(0, limit)
      .map((o) => ({
        id: o.id,
        serial: o.serial,
        destination: o.destination,
        customer_name: one(o.customers)?.arabic_name ?? null,
      }));
  } catch {
    return [];
  }
}
