"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
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
  if (!partner) return null;
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
type Result = { ok: true; receipt?: string } | { ok: false; message: string };

/** A payment the partner made to us — with a receipt number. Staff with data.write. */
export async function recordPartnerPayment(input: {
  partner_id: string;
  amount: number;
  currency: string;
  method: string;
  reference?: string;
  paid_at?: string;
  note?: string;
}): Promise<Result> {
  if (!(await getServerUser()) || !(await currentCan("data.write"))) return { ok: false, message: "لا تملك صلاحية." };
  if (!(Number.isFinite(input.amount) && input.amount > 0)) return { ok: false, message: "المبلغ غير صحيح." };
  if (!METHODS.includes(input.method as (typeof METHODS)[number])) return { ok: false, message: "طريقة الدفع غير صحيحة." };
  try {
    const receipt = receiptNo(new Date());
    const { error } = await (await db()).from("partner_payments").insert({
      partner_id: input.partner_id,
      amount: Math.round(input.amount * 100) / 100,
      currency: input.currency || "SAR",
      method: input.method,
      reference: input.reference?.trim() || null,
      paid_at: input.paid_at || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
      note: input.note?.trim() || null,
      receipt_no: receipt,
      created_by: await getCurrentEmployeeId(),
    });
    if (error) return { ok: false, message: "تعذّر تسجيل الدفعة." };
    await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: input.partner_id, meta: { payment: true, receipt, amount: input.amount, currency: input.currency } });
    return { ok: true, receipt };
  } catch {
    return { ok: false, message: "تعذّر تسجيل الدفعة." };
  }
}

/** How far a company may run before its «العميل أكّد» is refused; null = no limit. */
export async function setPartnerCreditLimit(partnerId: string, amount: number | null, currency: string): Promise<Result> {
  if (!(await getServerUser()) || !(await currentCan("data.write"))) return { ok: false, message: "لا تملك صلاحية." };
  if (amount != null && !(Number.isFinite(amount) && amount >= 0)) return { ok: false, message: "الحد غير صحيح." };
  try {
    const { error } = await (await db())
      .from("booking_partners")
      .update({ credit_limit: amount, credit_currency: currency || "SAR" })
      .eq("id", partnerId);
    if (error) return { ok: false, message: "تعذّر الحفظ." };
    await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: partnerId, meta: { credit_limit: amount, credit_currency: currency } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}
