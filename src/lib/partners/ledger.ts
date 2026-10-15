"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { currentCan } from "@/lib/roles/current";
import { balances, receiptNo, type LedgerLine } from "./ledger-math";
import { readLedger } from "./ledger-server";
import { getPartnerSession, isStaffSession } from "./session";

/**
 * «كشف الحساب» — a partner's account with us, for the partner (its own rows,
 * by RLS) and for us (any company, staff only), and the two things only we do
 * to it: record a payment the partner made, and set how far it may run.
 */

export type PartnerStatement = {
  lines: LedgerLine[];
  balances: { currency: string; owed: number }[];
  limit: { amount: number | null; currency: string };
};

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const statementOf = ({ lines, limit }: Awaited<ReturnType<typeof readLedger>>): PartnerStatement => ({
  lines,
  balances: balances(lines),
  limit,
});

/** The signed-in partner's own account (RLS: partner_id = current_partner_id()). */
export async function getMyStatement(): Promise<PartnerStatement | null> {
  const partner = await getPartnerSession();
  // the company's account is its manager's to see, not every salesperson's
  if (!partner || partner.role !== "owner") return null;
  try {
    return statementOf(await readLedger(await db(), partner.partner_id));
  } catch {
    return null;
  }
}

/** Any company's account — ours to read. */
export async function getPartnerStatement(partnerId: string): Promise<PartnerStatement | null> {
  if (!(await isStaffSession())) return null;
  try {
    return statementOf(await readLedger(await db(), partnerId));
  } catch {
    return null;
  }
}

const METHODS = ["bank_transfer", "cash", "card", "other"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
type Result = { ok: true; receipt?: string } | { ok: false; message: string };

/**
 * Money on the account is the administration's call: settings.manage, not the
 * data.write every role holds. Sessions cannot write partner_payments or the
 * company's limit, so the write itself goes through the service role, and only
 * after this check.
 */
async function mayManageMoney(): Promise<boolean> {
  return Boolean(await getServerUser()) && (await currentCan("settings.manage"));
}

function service(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

/** A payment the partner made to us — with a receipt number. settings.manage. */
export async function recordPartnerPayment(input: {
  partner_id: string;
  amount: number;
  currency: string;
  method: string;
  reference?: string;
  paid_at?: string;
  note?: string;
}): Promise<Result> {
  if (!(await mayManageMoney())) return { ok: false, message: "لا تملك صلاحية." };
  if (!UUID.test(input.partner_id)) return { ok: false, message: "الشركة غير موجودة." };
  if (!(Number.isFinite(input.amount) && input.amount > 0)) return { ok: false, message: "المبلغ غير صحيح." };
  if (!METHODS.includes(input.method as (typeof METHODS)[number])) return { ok: false, message: "طريقة الدفع غير صحيحة." };
  const currency = input.currency?.trim() || "SAR";
  if (!CURRENCY.test(currency)) return { ok: false, message: "العملة غير صحيحة." };
  try {
    const receipt = receiptNo(new Date());
    const { error } = await service().from("partner_payments").insert({
      partner_id: input.partner_id,
      amount: Math.round(input.amount * 100) / 100,
      currency,
      method: input.method,
      reference: input.reference?.trim() || null,
      paid_at: input.paid_at || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
      note: input.note?.trim() || null,
      receipt_no: receipt,
      created_by: await getCurrentEmployeeId(),
    });
    if (error) return { ok: false, message: "تعذّر تسجيل الدفعة." };
    await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: input.partner_id, meta: { payment: true, receipt, amount: input.amount, currency } });
    return { ok: true, receipt };
  } catch {
    return { ok: false, message: "تعذّر تسجيل الدفعة." };
  }
}

/** How far a company may run before its «العميل أكّد» is refused; null = no limit. */
export async function setPartnerCreditLimit(partnerId: string, amount: number | null, currency: string): Promise<Result> {
  if (!(await mayManageMoney())) return { ok: false, message: "لا تملك صلاحية." };
  if (!UUID.test(partnerId)) return { ok: false, message: "الشركة غير موجودة." };
  if (amount != null && !(Number.isFinite(amount) && amount >= 0)) return { ok: false, message: "الحد غير صحيح." };
  const limitCurrency = currency?.trim() || "SAR";
  if (!CURRENCY.test(limitCurrency)) return { ok: false, message: "العملة غير صحيحة." };
  try {
    const { data, error } = await service()
      .from("booking_partners")
      .update({ credit_limit: amount, credit_currency: limitCurrency })
      .eq("id", partnerId)
      .select("id");
    if (error || !data?.length) return { ok: false, message: "تعذّر الحفظ." };
    await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: partnerId, meta: { credit_limit: amount, credit_currency: limitCurrency } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}
