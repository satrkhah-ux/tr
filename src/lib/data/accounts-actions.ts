"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { riyadhDate } from "@/lib/operations/payments";
import { expenseError } from "@/lib/accounts/expenses";

/**
 * «تأكيد الفاتورة» — the accounts team checked an internal invoice against the file (finance.accounts).
 * Once per case: a second press keeps the first confirmation (who and when).
 */
export async function confirmInvoice(operationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await getServerUser()) || !(await currentCan("finance.accounts"))) return { ok: false, error: "لا صلاحية" };
  if (!/^[0-9a-f-]{36}$/.test(operationId)) return { ok: false, error: "فاتورة غير معروفة" };
  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { error } = await db
    .from("invoice_confirmations")
    .upsert({ operation_id: operationId, confirmed_by: await getCurrentEmployeeId() }, { onConflict: "operation_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: "تعذّر التأكيد" };
  await logAudit({ action: "invoice.confirmed", entity: "operations", entity_id: operationId, meta: {} });
  revalidatePath(`/accounts/invoices/${operationId}`);
  revalidatePath("/accounts/invoices");
  return { ok: true };
}

const allowed = async () => Boolean(await getServerUser()) && (await currentCan("finance.accounts"));
const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** «أضف مصروفاً» — one company expense (finance.accounts). The amount stays out of the audit, like a supplier payment's. */
export async function addExpense(input: { spent_on: string; category: string; title: string; amount: number; method: string; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const e = { ...input, title: String(input.title ?? "").trim(), note: String(input.note ?? "").trim(), amount: Number(input.amount) };
  const bad = expenseError(e, riyadhDate());
  if (bad) return { ok: false, error: bad };
  const { data, error } = await service()
    .from("company_expenses")
    .insert({ spent_on: e.spent_on, category: e.category, title: e.title, amount: Math.round(e.amount * 100) / 100, method: e.method, note: e.note || null, created_by: await getCurrentEmployeeId() })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "expense.recorded", entity: "company_expenses", entity_id: (data as { id: string }).id, meta: { category: e.category } });
  revalidatePath("/accounts/expenses");
  revalidatePath("/accounts");
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "مصروف غير معروف" };
  const { error } = await service().from("company_expenses").delete().eq("id", id);
  if (error) return { ok: false, error: "تعذّر الحذف" };
  await logAudit({ action: "expense.deleted", entity: "company_expenses", entity_id: id, meta: {} });
  revalidatePath("/accounts/expenses");
  revalidatePath("/accounts");
  return { ok: true };
}
