"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { translate, type TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { notifyOperationConfirmed, notifyPartnerCase } from "@/lib/data/ops-notify";
import { getPartnerSession } from "@/lib/partners/session";
import { raisePartnerInvoice } from "@/lib/partners/ledger-server";
import { readinessFor, syncOperation } from "@/lib/data/operation-sync";
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
import { gateManager, gateOperation, mayWork, opsAccess } from "@/lib/operations/access";
import { mintReceipt } from "@/lib/data/payment-receipt";
import { isIsoDate, riyadhDate } from "@/lib/operations/payments";

/**
 * «العمليات» — the execution hub. A case's two statuses move in three places,
 * all through the transition rules in operations/state.ts:
 *   · here — setClientStatus / setExecutionStatus, an agent's hand
 *     (the case's gate in operations/access.ts, on their own session);
 *   · operation-sync.ts — forward-only, derived from the bookings, documents
 *     and payments, after the gated action that changed them (service role);
 *   · operations/daily.ts — the morning cron: «سافر», then closed (service role).
 * The database refuses every other session write: since 0073 the operations
 * tables accept INSERT/UPDATE/DELETE only from staff holding operations.write —
 * and, since 0078, from an operations.own holder on the files they issued.
 * Who may touch which case is one rule: operations/access.ts.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
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
  /** the partner company that sold this file, or null for our own sale. */
  partner_name: string | null;
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
  // «تم تأكيد العميل» is the salesperson's handover (the kanban card) as much as
  // operations' — offers.write or operations.write. A salesperson holds no
  // operations.write, so the case is opened through the service role, after
  // this check (0073 refuses their session's insert into operations).
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  if (!(await currentCan("offers.write")) && !(await currentCan("operations.write"))) {
    return { ok: false, error: "ops.err.forbidden" };
  }
  return recordConfirmation(createSupabaseServiceClient() as unknown as SupabaseClient, input);
}

/**
 * A partner company records that ITS client confirmed — from its portal.
 *
 * Partners cannot write operations (RLS is staff-only), so this runs through the
 * service role, and only after checking on the server that the offer is this
 * partner's own and still live. Then it is the same confirmation as an agent's:
 * same operation row, same offer status, same ops notice.
 */
export async function confirmPartnerOffer(serial: string): Promise<OkId | Fail> {
  const partner = await getPartnerSession();
  if (!partner) return { ok: false, error: "err.session" };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await service
      .from("offers")
      .select("id, status, partner_company_id, valid_until, partner_cost")
      .eq("serial", serial.trim())
      .maybeSingle();
    const offer = data as { id: string; status: string | null; partner_company_id: string | null; valid_until: string | null; partner_cost: number | string | null } | null;
    // not theirs and not there read the same — no probing other companies' serials
    if (!offer || offer.partner_company_id !== partner.partner_id) return { ok: false, error: "ops.err.notFound" };
    if (offer.status === "cancelled") return { ok: false, error: "ops.err.invalidTransition" };
    // its prices held until valid_until — after that the partner renews them (operations can still confirm)
    if (offer.valid_until && offer.valid_until < new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })) {
      return { ok: false, error: "ops.err.offerExpired" };
    }
    // nothing fixed to bill them: confirmed by us, from operations, once it is priced
    if (offer.partner_cost == null) return { ok: false, error: "ops.err.noPartnerCost" };
    // The invoice FIRST, in one locked database step with the credit check, so
    // parallel confirmations cannot each pass the limit on the same balance.
    // Past the limit (or in another currency than it) the partner cannot
    // confirm alone — we can, from operations.
    const invoice = await raisePartnerInvoice(service, offer.id, true);
    if (!invoice.ok) return invoice;
    const confirmed = await recordConfirmation(service, {
      offer_id: offer.id,
      channel: "other",
      note: `أكّدته الشركة الشريكة «${partner.partner_name}» من بوابتها`,
    });
    // no operation, no invoice: take back the one this call raised
    if (!confirmed.ok && invoice.created) await service.from("partner_invoices").delete().eq("id", invoice.created);
    return confirmed;
  } catch {
    return { ok: false, error: "err.db" };
  }
}

async function recordConfirmation(
  supabase: SupabaseClient,
  input: { offer_id: string; channel?: ConfirmChannel; note?: string | null },
): Promise<OkId | Fail> {
  try {
    const existing = await supabase.from("operations").select("id").eq("offer_id", input.offer_id).maybeSingle();
    if (existing.data) return { ok: true, id: (existing.data as { id: string }).id };

    // The offer's own status trail records the commercial fact; the operation
    // records the work. Both, not one.
    await setOfferStatus(supabase, input.offer_id, "confirmed", input.note ?? "confirmed by agent");

    // Point at the frozen internal render rather than copying the document.
    // offer_renders is append-only, so this IS an immutable snapshot. Service
    // client because that render is the cost sheet (0047 closed the table) — so
    // only its id and the two dates leave the database, not the snapshot.
    const render = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("offer_renders")
      .select("id, arrival_date:snapshot_json->>arrival_date, departure_date:snapshot_json->>departure_date")
      .eq("offer_id", input.offer_id)
      .eq("variant", "internal")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const snapshot = render.data as { id: string; arrival_date: string | null; departure_date: string | null } | null;

    const { data, error } = await supabase
      .from("operations")
      .insert({
        offer_id: input.offer_id,
        render_id: snapshot?.id ?? null,
        travel_start: snapshot?.arrival_date ?? null,
        travel_end: snapshot?.departure_date ?? null,
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
    // a partner's file raises its invoice now, at the cost fixed when it was
    // issued — no credit check: this is us confirming (the partner's own
    // confirmation raised it already, and this finds it there)
    try {
      await raisePartnerInvoice(createSupabaseServiceClient() as unknown as SupabaseClient, input.offer_id, false);
    } catch {
      /* the company page lists a confirmed file without an invoice — it is not lost */
    }
    // the board says what operations says: a confirmed card leaves «نشط غير مؤكد» / «تمت المتابعة»
    await supabase
      .from("offers")
      .update({ pipeline_stage: "confirmed_hotels" })
      .eq("id", input.offer_id)
      .in("pipeline_stage", ["active_not_confirmed", "followed_up"]);
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
        travelStart: snapshot?.arrival_date ?? null,
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
  // cancelling a case stays the manager's, even on one's own file (access.ts gateManager)
  const denied = (await gateOperation(operationId)) ?? (to === "cancelled" ? await gateManager() : null);
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
    await notifyPartnerCase({ offerId: current.offer_id, what: translate("ar", `ops.client.${to}` as TranslationKey) });
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
  const denied = (await gateOperation(operationId)) ?? (to === "cancelled" ? await gateManager() : null);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const current = await loadStatuses(supabase, operationId);
    if (!current) return { ok: false, error: "err.loadFailed" };
    if (!canAdvanceExecution(current.execution_status, to)) return { ok: false, error: "ops.err.invalidTransition" };
    // «جاهز للسفر» is a promise to the client — only on a green checklist (operations order 6)
    if (to === "ready_to_travel") {
      const items = await readinessFor(operationId);
      if (!items || items.some((i) => !i.ok)) return { ok: false, error: "ops.err.notReady" };
    }

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
    await notifyPartnerCase({ offerId: current.offer_id, what: translate("ar", `ops.exec.${to}` as TranslationKey) });
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
  /** «سند القبض» — null on a refund, and on an old row until its receipt is first opened. */
  receipt_no: string | null;
  receipt_token: string | null;
  /** the client's slip is on file; its path never leaves the server. */
  has_proof: boolean;
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
}): Promise<{ ok: true; id: string } | Fail> {
  // money IN is the file's work; a refund is money going OUT — the manager's
  const denied = (await gateOperation(input.operation_id)) ?? (input.kind === "refund" ? await gateManager() : null);
  if (denied) return { ok: false, error: denied };
  if (!(input.amount > 0)) return { ok: false, error: "ops.err.amountPositive" };
  try {
    const supabase = await db();
    const kind = input.kind ?? "deposit";
    const recordedBy = await getCurrentEmployeeId();
    let id = "";
    // the receipt number is a Riyadh day + 4 random characters: a clash is rare, not impossible
    for (let attempt = 0; !id; attempt++) {
      const { data, error } = await supabase
        .from("operation_payments")
        .insert({
          operation_id: input.operation_id,
          amount: Math.round(input.amount * 100) / 100,
          currency: input.currency ?? "SAR",
          kind,
          method: input.method ?? null,
          reference: input.reference?.trim() || null,
          // the office's day, not UTC's — a payment taken at 1am Riyadh is today's
          paid_at: isIsoDate(input.paid_at) ? input.paid_at : riyadhDate(),
          recorded_by: recordedBy,
          note: input.note?.trim() || null,
          // a refund is money going out — it gets no «سند قبض»
          ...(kind === "refund" ? {} : mintReceipt()),
        })
        .select("id")
        .single();
      if (data) id = (data as { id: string }).id;
      else if (error?.code !== "23505" || attempt >= 2) return { ok: false, error: "err.createFailed" };
    }

    await logAudit({
      action: "payment.recorded",
      entity: "operations",
      entity_id: input.operation_id,
      meta: { amount: input.amount, currency: input.currency ?? "SAR", kind, payment_id: id },
    });
    // the money moves the client track (paid_partial / paid_full)
    await syncOperation(input.operation_id);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function listOperationPayments(operationId: string): Promise<OperationPayment[]> {
  try {
    if (await gateOperation(operationId)) return [];
    const supabase = await db();
    const { data } = await supabase
      .from("operation_payments")
      .select("id, amount, currency, kind, method, reference, paid_at, note, receipt_no, receipt_token, proof_path")
      .eq("operation_id", operationId)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });
    return ((data ?? []) as (Omit<OperationPayment, "has_proof"> & { proof_path: string | null })[]).map(
      ({ proof_path, ...p }) => ({ ...p, amount: Number(p.amount), has_proof: Boolean(proof_path) }),
    );
  } catch {
    return [];
  }
}

type OfferJoin = {
  serial: string;
  destination: string | null;
  total: number | null;
  currency: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  employee_id: string | null;
  customers: { arabic_name: string | null; mobile: string | null } | null;
  booking_partners: { name: string | null } | { name: string | null }[] | null;
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

/** The board: every live operation with what the cards and signals need — an own-files holder's own only. */
export async function listOperations(): Promise<OperationCard[]> {
  try {
    const access = await opsAccess();
    if (!access) return [];
    const supabase = await db();

    const { data } = await supabase
      .from("operations")
      .select(
        "id, offer_id, render_id, client_status, execution_status, travel_start, travel_end, confirm_channel, confirmed_at, note, offers(serial, destination, total, currency, adults, children, infants, employee_id, customers(arabic_name, mobile), booking_partners(name))",
      )
      .order("travel_start", { ascending: true, nullsFirst: false });

    const rows = ((data ?? []) as unknown as (OperationRow & { offers: OfferJoin | OfferJoin[] | null })[]).filter((r) =>
      mayWork(access, one(r.offers)?.employee_id),
    );
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
        // the travellers entered, else the ones the offer was sold for — a new case is not «0»
        travelers_count: travelers.get(r.id) ?? (offer?.adults ?? 0) + (offer?.children ?? 0) + (offer?.infants ?? 0),
        partner_name: one(offer?.booking_partners)?.name ?? null,
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
