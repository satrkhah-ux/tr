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

/**
 * The lessons read from past conversations that touch what the client wrote — a few, best matched first — as
 * examples beside the policies: they show how the team answered, and may be older than the list and the policies.
 */
export async function relevantLessons(service: SupabaseClient, text: string, kind?: RouteKey): Promise<string> {
  const words = [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))].sort((a, b) => b.length - a.length).slice(0, 5);
  if (!words.length) return "";
  const { data } = await service
    .from("murad_lessons")
    .select("question, answer, kind")
    .eq("active", true)
    .eq("source", "conversation")
    .or(words.map((w) => `question.ilike.*${w}*`).join(","))
    .limit(60);
  const score = (r: { question: string | null; answer: string; kind: string | null }) =>
    words.filter((w) => `${r.question ?? ""} ${r.answer}`.includes(w)).length + (kind && r.kind === kind ? 1 : 0);
  const rows = ((data ?? []) as { question: string | null; answer: string; kind: string | null }[])
    .filter((r) => !kind || !r.kind || r.kind === kind)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6);
  if (!rows.length) return "";
  return ["## من محادثات فريقنا السابقة (أمثلة — السياسات وقائمة التأشيرات وتعليم الإدارة أولى منها)", ...rows.map((r) => `س: ${r.question ?? "—"}\nج: ${r.answer}`)].join("\n");
}
