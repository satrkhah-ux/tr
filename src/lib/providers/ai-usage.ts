import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { addUsage, budgetAllows, mergeUsage, parseBudget, type DayUsage, type ModelClass } from "./ai-usage-core";

/**
 * The day's AI numbers, kept in app_settings «ai_usage:YYYY-MM-DD» (Riyadh's day) — what each feature used, by model — and
 * the background budget they are held to («ai_budget» {"strong":…,"cheap":…} tokens a day; the defaults in ai-usage-core.ts).
 * Counted in memory and written every few seconds (a restart loses at most that), read back at most once a minute. A broken
 * read never stops a call: the budget is a brake, not a gate that can lock the system.
 */

const day = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

let pending: DayUsage = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let cache: { at: number; day: string; used: DayUsage; budget: Record<ModelClass, number> } | null = null;

async function readDay(d: string): Promise<DayUsage> {
  const { data } = await db().from("app_settings").select("value").eq("key", `ai_usage:${d}`).maybeSingle();
  try {
    return JSON.parse((data as { value?: string } | null)?.value ?? "{}") as DayUsage;
  } catch {
    return {};
  }
}

async function flush(): Promise<void> {
  timer = null;
  const mine = pending;
  pending = {};
  if (!Object.keys(mine).length) return;
  try {
    const d = day();
    const merged = mergeUsage(await readDay(d), mine);
    await db().from("app_settings").upsert({ key: `ai_usage:${d}`, value: JSON.stringify(merged), updated_at: new Date().toISOString() });
    if (cache?.day === d) cache = { ...cache, used: merged };
  } catch {
    pending = mergeUsage(mine, pending);
  }
}

/** One finished call: the tokens it used (input and output, the output including a reasoning model's thinking). */
export function recordAiUsage(feature: string, model: string, tokens: { input: number; output: number }): void {
  pending = addUsage(pending, feature, model, tokens);
  if (!timer) {
    timer = setTimeout(() => void flush(), 15_000);
    timer.unref?.();
  }
}

/** Throws before a background call the day's budget no longer covers; foreground features never wait on it. */
export async function assertAiBudget(feature: string, model: string): Promise<void> {
  try {
    const d = day();
    if (!cache || cache.day !== d || Date.now() - cache.at > 60_000) {
      const [used, { data }] = await Promise.all([readDay(d), db().from("app_settings").select("value").eq("key", "ai_budget").maybeSingle()]);
      cache = { at: Date.now(), day: d, used, budget: parseBudget((data as { value?: string } | null)?.value) };
    }
    if (!budgetAllows(mergeUsage(cache.used, pending), feature, model, cache.budget)) throw new Error("ai_budget_exhausted");
  } catch (error) {
    if (error instanceof Error && error.message === "ai_budget_exhausted") throw error;
    /* an unreadable budget never stops a call */
  }
}

/** The same question without the throw: for a job that claims work before it calls (the learning sweep must not skip conversations the budget refused). */
export async function aiBudgetOpen(feature: string, model: string): Promise<boolean> {
  try {
    await assertAiBudget(feature, model);
    return true;
  } catch {
    return false;
  }
}

