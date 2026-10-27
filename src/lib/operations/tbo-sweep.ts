import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listSweepBookings, refreshLoadedBooking } from "@/lib/data/supplier-booking";
import { notifyOps } from "@/lib/data/ops-notify";
import { asSystem } from "@/lib/supabase/system-actor";

/**
 * TBO keeps no webhooks (the whole V2.1 spec read, 2026-10-26: no push, no
 * callback — polling is the only door). So the system ASKS: once a day from
 * /api/ops/daily, and once when a case page opens (sweepCaseTbo, fire-and-
 * forget), each TBO hotel booking of a live case is read back (BookingDetail
 * through the existing refresh core). A cancellation or a changed status is
 * never silent: it becomes an «مشكلة» on the case (operation_issues) and a
 * «تنبيهاتي» line to the operations team — and the booking row itself moves
 * exactly as the refresh button moves it.
 */

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type TboSweepResult = { checked: number; moved: number; issues: number };

async function issueOnce(supabase: SupabaseClient, operationId: string, ref: string, description: string): Promise<boolean> {
  // operation_alerts' unique (operation, kind, ref) is the dedupe — the issue and the notice ride on it
  const { error } = await supabase.from("operation_alerts").insert({ operation_id: operationId, kind: "tbo_status", ref });
  if (error) return false;
  await supabase.from("operation_issues").insert({ operation_id: operationId, description });
  await notifyOps(`🏨 ${description}`, `/operations/${operationId}`);
  return true;
}

async function sweep(today: string, operationId?: string): Promise<TboSweepResult> {
  const result: TboSweepResult = { checked: 0, moved: 0, issues: 0 };
  const rows = await listSweepBookings(today, operationId);
  const supabase = service();
  for (const { row, operation_id } of rows) {
    const before = { status: row.status, confirmation: row.confirmation_number };
    const out = await refreshLoadedBooking(row).catch(() => null);
    result.checked += 1;
    if (!out || !("ok" in out) || out.ok !== true) continue;
    const word = out.status.replace(/\s+/g, "").toLowerCase();
    const cancelled = /cancel|cxl/.test(word);
    const changed = cancelled || (before.status === "confirmed" && out.confirmation_number !== before.confirmation);
    if (changed) {
      result.moved += 1;
      const what = cancelled
        ? `TBO ألغى أو يلغي حجز «${row.title}» — حالة المورّد: ${out.status}`
        : `TBO غيّر حجز «${row.title}» — رقم التأكيد تغيّر إلى ${out.confirmation_number ?? "—"}`;
      if (await issueOnce(supabase, operation_id, `${row.id}:${word}`, what)) result.issues += 1;
    }
  }
  return result;
}

/** The daily pass over every live case's TBO bookings — ops-daily calls it. */
export async function sweepTboBookings(today: string): Promise<TboSweepResult> {
  return asSystem({ name: "tbo-sweep", can: [] }, () => sweep(today));
}

/** One case's TBO bookings, when its page opens — fire-and-forget (after()). */
export async function sweepCaseTbo(operationId: string, today: string): Promise<TboSweepResult> {
  return asSystem({ name: "tbo-sweep", can: [] }, () => sweep(today, operationId));
}
