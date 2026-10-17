import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { FEATURES_SETTING_KEY, parseFeatures, type Feature, type FeatureFlags } from "./features";

/**
 * Which services are on, once per request. Read with the service role: the
 * switches are not secret, and a partner's session (no app_settings read) must
 * see the same answer as ours. Any failure reads as "everything on".
 */
export const getFeatureFlags = cache(async (): Promise<FeatureFlags> => {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase.from("app_settings").select("value").eq("key", FEATURES_SETTING_KEY).maybeSingle();
    return parseFeatures((data as { value?: string } | null)?.value);
  } catch {
    return parseFeatures(null);
  }
});

export async function featureOn(feature: Feature): Promise<boolean> {
  return (await getFeatureFlags())[feature];
}
