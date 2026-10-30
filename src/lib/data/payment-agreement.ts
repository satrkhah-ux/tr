"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan, currentCanOpen } from "@/lib/roles/current";
import { logAudit } from "./audit";
import { getPaymentFees } from "./app-settings";
import { issuedDraftData } from "./issued-draft";
import { confirmOffer, type ConfirmChannel } from "./operations";
import { saveInstallments, setAgreedTotal } from "./operation-payments";
import { gateOperation } from "@/lib/operations/access";
import { riyadhDate } from "@/lib/operations/payments";
import { scheduleOf, validateAgreement, type Agreement, type AgreementError } from "@/lib/operations/agreement";
import { beforeCharge } from "@/lib/offer/issue-pricing";
import { isPayMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";

/**
 * «كيف تم الاتفاق المالي؟» on the server (the owner, 2026-10-30): what the
 * confirm dialog starts from, and writing the agreement into the case through
 * the case's OWN schedule and agreed price (saveInstallments / setAgreedTotal —
 * their gates, their audit), so nothing here is a second table.
 */

export type AgreementContext = {
  /** our price — the offer's total before the way it was issued with added its charge */
  base: number;
  /** the offer's total as issued (what the client was sent) */
  total: number;
  currency: string;
  /** the way the file was issued with, if any — the dialog starts on it */
  method: PayMethod | null;
  travelStart: string | null;
  today: string;
  /** null outside SAR: E's fees carry a fixed part in riyals, so no charge is quoted */
  fees: PaymentFees | null;
};

export type AgreementAnswer = { ok: true } | { ok: false; error: AgreementError | "failed" };

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function contextOf(offerId: string): Promise<AgreementContext | null> {
  const db = service();
  const [{ data: offer }, { data: client }, { data: internal }] = await Promise.all([
    db.from("offers").select("id, serial, currency, partner_company_id").eq("id", offerId).maybeSingle(),
    db.from("offer_renders").select("total:snapshot_json->total, currency:snapshot_json->>currency").eq("offer_id", offerId).eq("variant", "client").order("version", { ascending: false }).limit(1).maybeSingle(),
    // only the date leaves the cost sheet (as recordConfirmation reads it)
    db.from("offer_renders").select("arrival_date:snapshot_json->>arrival_date").eq("offer_id", offerId).eq("variant", "internal").order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const o = offer as { id: string; serial: string; currency: string | null; partner_company_id: string | null } | null;
  const r = client as { total: number | string | null; currency: string | null } | null;
  const total = Number(r?.total);
  if (!o || !(total > 0)) return null;
  const currency = r?.currency || o.currency || "SAR";
  const draft = await issuedDraftData(db, o).catch(() => null);
  const chosen = (draft?.pricing as { payment_method?: unknown; display_currency?: unknown } | undefined)?.payment_method;
  const method = isPayMethod(chosen) ? chosen : null;
  const fees = currency === "SAR" ? await getPaymentFees() : null;
  const travelStart = (internal as { arrival_date: string | null } | null)?.arrival_date ?? null;
  return {
    base: fees && method ? beforeCharge(total, method, fees) : total,
    total,
    currency,
    method,
    travelStart: travelStart && /^\d{4}-\d{2}-\d{2}$/.test(travelStart) ? travelStart : null,
    today: riyadhDate(),
    fees,
  };
}

/** For the dialog — staff who may confirm a file (offers.write or operations.write). */
export async function offerAgreementContext(offerId: string): Promise<AgreementContext | null> {
  if (!(await getServerUser())) return null;
  if (!(await currentCan("offers.write")) && !(await currentCan("operations.write"))) return null;
  try {
    return await contextOf(String(offerId));
  } catch {
    return null;
  }
}

/** The agreement checked against the offer, BEFORE anything is confirmed: a wrong date opens no case. */
export async function checkAgreement(offerId: string, agreement: Agreement | undefined): Promise<AgreementError | "failed" | null> {
  if (!agreement || agreement.kind === "later") return null;
  const ctx = await offerAgreementContext(offerId);
  if (!ctx) return "failed";
  return validateAgreement(agreement.rows, ctx);
}

/**
 * Into the case: the agreed price first (the sum of what the client pays by
 * each row's way — null when it is the offer's own total), then the schedule;
 * a schedule that cannot be saved takes the price back, so the case is never
 * half agreed. «لاحقاً» writes nothing and is recorded.
 */
export async function applyAgreement(operationId: string, agreement: Agreement | undefined): Promise<AgreementAnswer> {
  if (!agreement) return { ok: true };
  if (await gateOperation(operationId)) return { ok: false, error: "failed" };
  try {
    const { data: op } = await service().from("operations").select("offer_id").eq("id", operationId).maybeSingle();
    const offerId = (op as { offer_id: string } | null)?.offer_id;
    if (!offerId) return { ok: false, error: "failed" };
    if (agreement.kind === "later") {
      await logAudit({ action: "payment.agreement_later", entity: "operations", entity_id: operationId, meta: {} });
      return { ok: true };
    }
    const ctx = await contextOf(offerId);
    if (!ctx) return { ok: false, error: "failed" };
    const invalid = validateAgreement(agreement.rows, ctx);
    if (invalid) return { ok: false, error: invalid };
    const schedule = scheduleOf(agreement.rows, ctx.fees);
    const owed = Math.round(schedule.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const agreed = Math.abs(owed - ctx.total) < 0.005 ? null : owed;
    if (agreed !== null && !(await setAgreedTotal(operationId, agreed)).ok) return { ok: false, error: "failed" };
    const saved = await saveInstallments(operationId, schedule);
    if (!saved.ok) {
      if (agreed !== null) await setAgreedTotal(operationId, null);
      return { ok: false, error: "failed" };
    }
    await logAudit({
      action: "payment.agreement_set",
      entity: "operations",
      entity_id: operationId,
      meta: { kind: agreement.kind, rows: agreement.rows.map((r) => ({ due_date: r.due_date, amount: r.amount, method: r.method })), owed },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** The kanban's «تم تأكيد العميل» with the same dialog: checked, confirmed, then agreed. */
export async function confirmOfferWithAgreement(
  offerId: string,
  channel: "whatsapp" | "phone" | "office",
  agreement?: Agreement,
): Promise<{ ok: true; operationId: string; canOpen: boolean; agreementFailed?: AgreementError | "failed" } | { ok: false; error: string }> {
  const invalid = await checkAgreement(offerId, agreement);
  if (invalid) return { ok: false, error: `agree_${invalid}` };
  const ch: ConfirmChannel = channel === "phone" || channel === "office" ? channel : "whatsapp";
  const res = await confirmOffer({ offer_id: offerId, channel: ch });
  if (!res.ok) return { ok: false, error: "failed" };
  const agreed = await applyAgreement(res.id, agreement);
  return { ok: true, operationId: res.id, canOpen: await currentCanOpen("/operations"), ...(agreed.ok ? {} : { agreementFailed: agreed.error }) };
}
