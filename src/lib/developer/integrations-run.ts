import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { translate } from "@/lib/i18n";
import { eyeListeners, eyeSend, escapeHtml } from "@/lib/telegram/eye-bot";
import { runCheck } from "./checks";
import { nextAlert, type HealthStatus } from "./integration-alerts";

/**
 * «الربط الخارجي»'s watch (the owner, 2026-10-19): each registered integration
 * that has an automatic check is checked, its health written on its row, and a
 * problem — a check failing twice in a row, an end date within 14/7/1 days —
 * said once to the administration through «عين الإدارة» (integration-alerts.ts).
 *
 * Every 30 minutes at most, from the minute job (api/murad/run), so nothing new
 * needs scheduling; `force` (the page's «افحص الآن») runs it at once.
 */
const EVERY_MS = 30 * 60_000;
const LAST_RUN = "integrations_last_run";

type Row = { id: string; name: string; check_key: string | null; renews_on: string | null; fail_streak: number; alerted: string | null };

export async function runIntegrationChecks(force = false): Promise<{ ran: boolean; checked: number; alerts: number }> {
  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const now = new Date();
  if (!force) {
    const { data } = await db.from("app_settings").select("value").eq("key", LAST_RUN).maybeSingle();
    const last = Date.parse((data as { value?: string } | null)?.value ?? "");
    if (Number.isFinite(last) && now.getTime() - last < EVERY_MS) return { ran: false, checked: 0, alerts: 0 };
  }
  // claimed before the checks: the next minute's call does not start a second round
  await db.from("app_settings").upsert({ key: LAST_RUN, value: now.toISOString(), updated_at: now.toISOString() });

  const { data } = await db.from("integrations").select("id, name, check_key, renews_on, fail_streak, alerted").eq("unused", false);
  const rows = (data ?? []) as Row[];
  const keys = [...new Set(rows.map((r) => r.check_key).filter((k): k is string => Boolean(k)))];
  const results = new Map((await Promise.all(keys.map(async (k) => [k, await runCheck(k).catch(() => null)] as const))).map(([k, r]) => [k, r]));
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const lines: string[] = [];

  for (const row of rows) {
    const result = row.check_key ? (results.get(row.check_key) ?? null) : null;
    const days = typeof result?.detail.params?.days === "number" ? (result.detail.params.days as number) : null;
    const step = nextAlert(row, result ? { status: result.status as HealthStatus, days } : null, row.renews_on, today);
    const detail = result ? translate("ar", result.detail.key, result.detail.params) : null;
    const failing = result?.status === "down" || result?.status === "unconfigured";
    await db
      .from("integrations")
      .update({
        fail_streak: step.fail_streak,
        alerted: step.alerted,
        ...(result && !failing ? { last_ok_at: now.toISOString() } : {}),
        ...(failing ? { last_error: detail, last_error_at: now.toISOString() } : {}),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    if (step.alert === "fail") lines.push(`❌ ${escapeHtml(row.name)} — لا يعمل (فحصان متتاليان): ${escapeHtml(detail ?? "")}`);
    else if (step.alert) lines.push(`⏳ ${escapeHtml(row.name)} — ينتهي خلال ${step.days} يوماً`);
  }

  if (lines.length) {
    const text = ["🔌 <b>الربط الخارجي</b> — يحتاج انتباهاً:", ...lines, "", "التفاصيل: «المطوّر» ← «الربط الخارجي»"].join("\n");
    for (const listener of await eyeListeners().catch(() => [])) await eyeSend(listener.chatId, text).catch(() => null);
  }
  return { ran: true, checked: keys.length, alerts: lines.length };
}
