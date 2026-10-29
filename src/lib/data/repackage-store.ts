import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { normalizeRepackageData, type RepackageData } from "@/lib/repackage/repackage-types";

/**
 * `repackage_imports` — every read and write of it, the FULL file, supplier cost
 * included. An import IS the supplier's price, so 0047 closed the table and its
 * bucket to every session: the service role here, behind the one rule this file
 * states — repackage.write. Every caller sits inside a try, so a refusal reads as
 * the action's ordinary failure.
 *
 * Not a server-actions module: the actions in repackage.ts and
 * repackage-order.ts call it after their own checks, and nothing here may be
 * called from a browser.
 */
export async function repackageDb(): Promise<SupabaseClient> {
  if (!(await currentCan("repackage.write"))) throw new Error("repackage.write required");
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

export type RepackageRecord = { id: string; data: RepackageData; updated_at: string };

export async function loadRepackage(id: string): Promise<RepackageRecord | null> {
  try {
    const supabase = await repackageDb();
    const { data } = await supabase.from("repackage_imports").select("id, data, updated_at").eq("id", id).maybeSingle();
    if (!data) return null;
    const row = data as { id: string; data: Record<string, unknown>; updated_at: string };
    return { id: row.id, data: normalizeRepackageData(row.data), updated_at: row.updated_at };
  } catch {
    return null;
  }
}

export type WriteRepackageResult = { ok: boolean; error?: TranslationKey };

/** Shallow top-level merge of slices into the import's jsonb (mirror drafts). */
export async function writeRepackageStages(id: string, slices: Partial<RepackageData>): Promise<WriteRepackageResult> {
  try {
    const supabase = await repackageDb();
    const { data: existing } = await supabase.from("repackage_imports").select("data").eq("id", id).maybeSingle();
    if (!existing) return { ok: false, error: "err.loadFailed" };
    const current = normalizeRepackageData((existing as { data: Record<string, unknown> }).data);
    const merged: RepackageData = { ...current, ...slices };
    const title = merged.source.supplier_name || merged.extracted?.destination || merged.extracted?.country || null;
    const { error } = await supabase
      .from("repackage_imports")
      .update({
        data: merged as unknown as Record<string, unknown>,
        title,
        supplier_id: merged.source.supplier_id,
        original_file_path: merged.source.original_file_path,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
