import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { translate } from "@/lib/i18n";
import { notifyOps } from "./ops-notify";
import { weeklyLines, type IssueCounts } from "./quality";

export type CountRow = { issue: string; total: number; used: number | null };

/** Keep the RPC error so a timeout or expired session is not reported as a missing migration. */
export async function qualityCounts(supabase: SupabaseClient): Promise<CountRow[]> {
  const { data, error } = await supabase.rpc("data_quality_counts");
  if (error) throw error;
  return (data ?? []) as CountRow[];
}

/** Last week's numbers live in app_settings (0054) under this key: {"day":"YYYY-MM-DD","counts":{…}}. */
const SETTING = "data_quality_weekly";
/** Sunday — the first working day in Riyadh. */
const WEEKDAY = 0;

/**
 * The weekly data-quality summary (data order 11.4), sent from the operations
 * morning (runOpsDaily) on Sundays: each count and its change since the last one
 * sent. The snapshot is kept before sending, so a second run the same morning
 * sends nothing. Best-effort: never throws into the cron.
 */
export async function sendWeeklyDataQuality(today: string): Promise<boolean> {
  if (new Date(`${today}T00:00:00Z`).getUTCDay() !== WEEKDAY) return false;
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: kept } = await supabase.from("app_settings").select("value").eq("key", SETTING).maybeSingle();
    let prev: { day?: string; counts?: IssueCounts } | null = null;
    try {
      prev = JSON.parse((kept as { value?: string } | null)?.value ?? "null");
    } catch {
      prev = null;
    }
    if (prev?.day === today) return false;

    const rows = await qualityCounts(supabase);
    const counts: IssueCounts = Object.fromEntries(rows.map((r) => [r.issue, r.total]));
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: SETTING, value: JSON.stringify({ day: today, counts }), updated_at: new Date().toISOString() });
    if (error) return false;

    const text = [
      translate("ar", "data.quality.weekly.title"),
      "",
      ...weeklyLines(counts, prev?.counts ?? null, (key) => translate("ar", key)),
    ].join("\n");
    return (await notifyOps(text, "/data-quality")) > 0;
  } catch {
    return false;
  }
}
