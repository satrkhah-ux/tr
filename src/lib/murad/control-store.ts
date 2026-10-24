import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/data/audit";
import { MURAD_CONTROL_KEY, parseControl, validControl, type MuradControl } from "./control";
import { SETTING } from "./core";
import type { Scope } from "./instructions";

export async function readControl(service: SupabaseClient): Promise<MuradControl> {
  const { data } = await service.from("app_settings").select("value").eq("key", MURAD_CONTROL_KEY).maybeSingle();
  return parseControl((data as { value?: string } | null)?.value);
}

export async function readScope(service: SupabaseClient): Promise<Scope> {
  const { data } = await service.from("app_settings").select("value").eq("key", SETTING.receptionScope).maybeSingle();
  return (data as { value?: string } | null)?.value === "all" ? "all" : "test";
}

/** Murad's settings written by a management instruction (instruct.ts) — the page's own save checks the session itself. */
export async function storeControl(service: SupabaseClient, next: { control: MuradControl; scope: Scope }, before: { control: MuradControl; scope: Scope }, by: string): Promise<boolean> {
  if (!validControl(next.control)) return false;
  const now = new Date().toISOString();
  const { error } = await service.from("app_settings").upsert({ key: MURAD_CONTROL_KEY, value: JSON.stringify(next.control), updated_at: now });
  if (error) return false;
  if (next.scope !== before.scope) await service.from("app_settings").upsert({ key: SETTING.receptionScope, value: next.scope, updated_at: now });
  await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: MURAD_CONTROL_KEY, meta: { by, before, after: next } });
  return true;
}
