"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";

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
