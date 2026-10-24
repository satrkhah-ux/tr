import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteKey } from "./reception";

/**
 * What Murad has been taught, as the text his answers read beside the company's policies and visa Q&A (run.ts
 * readSettings). The management's teaching first and whole; a kind narrows it (the visa desk reads visa lessons
 * and the general ones).
 */
export async function lessonsText(service: SupabaseClient, kind?: RouteKey): Promise<string> {
  const { data } = await service.from("murad_lessons").select("question, answer, kind").eq("active", true).eq("source", "teaching").order("created_at").limit(200);
  const rows = ((data ?? []) as { question: string | null; answer: string; kind: string | null }[]).filter((r) => !kind || !r.kind || r.kind === kind);
  if (!rows.length) return "";
  return ["## ما علّمته الإدارة لمُراد (يُقدَّم على غيره)", ...rows.map((r) => (r.question ? `س: ${r.question}\nج: ${r.answer}` : `- ${r.answer}`))].join("\n");
}
