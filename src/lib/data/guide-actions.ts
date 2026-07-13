"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GuideFile = { name: string; url: string; size: number | null };

/** Lists PDFs in the public `guide` Storage bucket with real download URLs. */
export async function listGuideFiles(): Promise<GuideFile[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from("guide")
      .list("", { limit: 200, sortBy: { column: "name", order: "asc" } });
    if (error || !data) return [];
    return data
      .filter((entry) => entry.name && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        url: supabase.storage.from("guide").getPublicUrl(entry.name).data.publicUrl,
        size: (entry.metadata as { size?: number } | null)?.size ?? null,
      }));
  } catch {
    return [];
  }
}
