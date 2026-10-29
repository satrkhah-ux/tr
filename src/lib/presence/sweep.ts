import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { staffSend } from "@/lib/telegram/staff-bot";
import { STATUS_BUTTON, type StatusKind } from "./excuse";

/**
 * A button forgotten on (the owner, 2026-10-29: «ضع حداً أقصى معقولاً … كي لا يبقى الزر مفعّلاً منسياً»): past its cap it
 * already stopped counting (excuse.ts statusWindow); here, each minute, it is closed at the cap, marked «auto», and the
 * colleague is told in «تنبيهاتي». Twenty at a time.
 */
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export async function closeExpiredStatuses(nowMs = Date.now()): Promise<{ closed: number } | null> {
  const { data, error } = await db()
    .from("employee_status_events")
    .select("id, employee_id, kind, started_at, cap_at")
    .is("ended_at", null)
    .lte("cap_at", new Date(nowMs).toISOString())
    .limit(20);
  if (error || !data?.length) return null;
  let closed = 0;
  for (const s of data as { id: number; employee_id: string; kind: StatusKind; started_at: string; cap_at: string }[]) {
    // claimed by its own still-open row: two ticks never close (or tell) twice
    const { data: done } = await db()
      .from("employee_status_events")
      .update({ ended_at: s.cap_at, ended_by: "auto" })
      .eq("id", s.id)
      .is("ended_at", null)
      .select("id");
    if (!done?.length) continue;
    closed += 1;
    const { data: emp } = await db().from("employees").select("telegram_chat_id").eq("id", s.employee_id).maybeSingle();
    const chat = Number((emp as { telegram_chat_id?: number | string | null } | null)?.telegram_chat_id);
    const minutes = Math.round((Date.parse(s.cap_at) - Date.parse(s.started_at)) / 60_000);
    if (chat)
      await staffSend(
        chat,
        `⏱️ انتهت حالة «${STATUS_BUTTON[s.kind]}» تلقائياً بعد ${minutes} دقيقة.\nإن كنت ما زلت مشغولاً فاضغطها من جديد بجانب مُراد.`,
        undefined,
        {},
        "status",
      ).catch(() => undefined);
  }
  return { closed };
}
