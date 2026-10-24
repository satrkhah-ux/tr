import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * «فاتح النظام = متصل» (the owner, 2026-10-24): anyone whose session beat the
 * presence heartbeat recently counts as online — on our own screens and when
 * routing requests — even when they set themselves «غير متصل» in Teletel.
 * The heartbeat beats every 30 s from any open page (TraveliunShell), so a
 * couple of minutes of silence genuinely means the system is closed.
 */
const WINDOW_MS = 2 * 60_000;

/** Teletel agent ids of employees whose system session is alive right now. Best-effort: empty on any failure. */
export async function presenceOnlineAgentIds(given?: SupabaseClient): Promise<Set<number>> {
  try {
    const service = given ?? (createSupabaseServiceClient() as unknown as SupabaseClient);
    const cut = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data } = await service.from("presence").select("employee_id").gte("last_seen_at", cut);
    const ids = ((data ?? []) as { employee_id: string }[]).map((r) => r.employee_id);
    if (ids.length === 0) return new Set();
    const { data: emps } = await service
      .from("employees")
      .select("teletel_agent_id")
      .in("id", ids)
      .not("teletel_agent_id", "is", null);
    return new Set(((emps ?? []) as { teletel_agent_id: number | string }[]).map((e) => Number(e.teletel_agent_id)));
  } catch {
    return new Set(); // Teletel's own availability still stands
  }
}
