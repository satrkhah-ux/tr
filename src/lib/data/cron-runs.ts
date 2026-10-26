import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Every run of a scheduled job leaves one trace, so /developer can say when it
 * last ran: a run that moved nothing used to record nothing, and that silence
 * looked exactly like a dead crontab.
 *
 * One app_settings row per job ("cron_last_run:<job>" → {at, ok, ms, summary}),
 * overwritten by each run — NOT an audit row per run. /api/ops/flights fires
 * every 30 minutes: 48 "nothing landed" rows a day into the trail that answers
 * "who did what", which «عين الإدارة» reads whole every evening. Only the last
 * run is ever asked for, and that is one row, not a log.
 */
export type CronJob = "ops_daily" | "ops_flights" | "leads_pull" | "murad_run" | "followups_sync" | "staff_tick" | "shared_sweep" | "secretary_plans" | "notify_sweep";
export type CronRun = { at: string; ok: boolean; ms: number; summary: Record<string, unknown> };

export const cronRunKey = (job: CronJob): string => `cron_last_run:${job}`;

/**
 * Run `work` and record how it went. Its result — or its error — passes through
 * untouched, so a failed run is still a 500 the crontab's `curl -f` sees.
 */
export async function recordCronRun<T extends object>(job: CronJob, work: () => Promise<T>): Promise<T> {
  const at = new Date().toISOString();
  const start = Date.now();
  const save = async (ok: boolean, summary: object) => {
    try {
      const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
      const value = JSON.stringify({ at, ok, ms: Date.now() - start, summary });
      await supabase.from("app_settings").upsert({ key: cronRunKey(job), value, updated_at: new Date().toISOString() });
    } catch {
      /* the record must never fail the job it records */
    }
  };
  try {
    const result = await work();
    await save(true, result);
    return result;
  } catch (error) {
    await save(false, { error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
    throw error;
  }
}
