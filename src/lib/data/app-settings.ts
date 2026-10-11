"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";

/**
 * Choices the administration makes once for everyone (app_settings, 0054).
 *
 * Read by any staff session; written only here, after settings.manage, through
 * the service role — the table has no write policy at all.
 */

/** Which system the package generator searches for hotels: "internal" or a hotel_suppliers code. */
export async function getHotelSearchSource(): Promise<string> {
  if (!(await getServerUser())) return "internal";
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase.from("app_settings").select("value").eq("key", "hotel_search_source").maybeSingle();
    return (data as { value?: string } | null)?.value?.trim() || "internal";
  } catch {
    return "internal";
  }
}

export type SetSettingResult = { ok: true } | { ok: false; error: "err.forbidden" | "err.db" };

export async function setHotelSearchSource(code: string): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "err.forbidden" };
  const value = code.trim();
  if (!value) return { ok: false, error: "err.db" };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    // Only a source that exists: the internal catalogue, or a supplier row.
    if (value !== "internal") {
      const { data } = await supabase.from("hotel_suppliers").select("code").eq("code", value).maybeSingle();
      if (!data) return { ok: false, error: "err.db" };
    }
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "hotel_search_source", value, updated_at: new Date().toISOString() });
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
