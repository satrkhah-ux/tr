import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { summarizeBookings, type ServiceSummary } from "@/lib/operations/booking-summary";
import { mayWork, opsAccess } from "@/lib/operations/access";

/**
 * A confirmed file's services as operations holds them, for the files list
 * («الطيران ✓»، «الفنادق 1/3»…): per operation, per kind. Service role —
 * operation_bookings is closed to sales sessions — and only for the operations
 * this caller may work («ملفاتي»: an agent with operations.own sees the files
 * they issued, never a colleague's). Server code only.
 */
export async function bookingSummaries(operationIds: string[]): Promise<Record<string, ServiceSummary[]>> {
  const out: Record<string, ServiceSummary[]> = {};
  if (operationIds.length === 0) return out;
  try {
    const access = await opsAccess();
    if (!access) return out;
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: ops } = await service.from("operations").select("id, offers(employee_id)").in("id", operationIds);
    const allowed = ((ops ?? []) as { id: string; offers: { employee_id: string | null } | { employee_id: string | null }[] | null }[])
      .filter((o) => mayWork(access, (Array.isArray(o.offers) ? o.offers[0] : o.offers)?.employee_id))
      .map((o) => o.id);
    if (allowed.length === 0) return out;
    const { data } = await service.from("operation_bookings").select("operation_id, kind, status").in("operation_id", allowed);
    const byOp = new Map<string, { kind: string; status: string }[]>();
    for (const r of (data ?? []) as { operation_id: string; kind: string; status: string }[]) byOp.set(r.operation_id, [...(byOp.get(r.operation_id) ?? []), r]);
    for (const [id, rows] of byOp) out[id] = summarizeBookings(rows);
  } catch {
    // the list still opens; a confirmed file just shows no service chips
  }
  return out;
}
