import "server-only";
import { ttlCache } from "@/lib/ttl-cache";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { FEATURES_SETTING_KEY, parseFeatures, type Feature, type FeatureFlags } from "./features";

const flagsCache = ttlCache<"flags", FeatureFlags>(30_000, 1);

/** After a switch is flipped in this process (setFeature) — others catch up within 30 s. */
export function forgetFeatureFlags(): void {
  flagsCache.clear();
}

/**
 * Which services are on, once per request. Read with the service role: the
 * switches are not secret, and a partner's session (no app_settings read) must
 * see the same answer as ours. Any failure reads as "everything on".
 */
export const getFeatureFlags = cache(async (): Promise<FeatureFlags> => {
  const known = flagsCache.get("flags");
  if (known) return known;
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", FEATURES_SETTING_KEY).maybeSingle();
    const flags = parseFeatures((data as { value?: string } | null)?.value);
    if (!error) flagsCache.set("flags", flags);
    return flags;
  } catch {
    return parseFeatures(null);
  }
});

export async function featureOn(feature: Feature): Promise<boolean> {
  return (await getFeatureFlags())[feature];
}
