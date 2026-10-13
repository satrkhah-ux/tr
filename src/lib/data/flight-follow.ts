import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/data/audit";
import { DRV, retimeTransfers } from "@/lib/operations/drivers";

/**
 * The airline moved a flight; the drives tied to it move with it.
 *
 * Called by updateBooking once a flight booking's detail is saved — never on
 * its own, which is why this is a plain server module and not a server action:
 * the gate is the caller's. Best-effort: the flight edit stands even if a
 * transfer could not be re-timed, and the agent sees the old time to fix.
 */
export async function followFlight(
  supabase: SupabaseClient,
  flight: { id: string; operation_id: string; title: string; detail: Record<string, string> },
  previous: Record<string, string> | null,
): Promise<void> {
  try {
    const { data } = await supabase
      .from("operation_bookings")
      .select("id, kind, title, start_date, detail")
      .eq("operation_id", flight.operation_id)
      .eq("kind", "transport")
      .neq("status", "cancelled");
    const transfers = (data ?? []) as { id: string; kind: string; title: string; start_date: string | null; detail: Record<string, string> | null }[];
    for (const r of retimeTransfers(flight, previous, transfers)) {
      const { error } = await supabase.from("operation_bookings").update({ start_date: r.start_date, detail: r.detail }).eq("id", r.id);
      if (!error) {
        await logAudit({
          action: "booking.retimed",
          entity: "operation_bookings",
          entity_id: r.id,
          meta: { flight_booking: flight.id, date: r.start_date, time: r.detail[DRV.time] ?? null },
        });
      }
    }
  } catch {
    /* the flight edit itself stands */
  }
}
