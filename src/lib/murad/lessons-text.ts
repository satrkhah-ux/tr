import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
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

/**
 * A fixed reply (the destinations list) with the management's teaching applied (the owner's test, 2026-10-24: «أضف
 * أننا أقوياء في جنوب شرق آسيا…» was learnt and the next «ايش العروض» was the same list): the model may add or
 * reword what a lesson for this question says, never drop what the reply lists. The reply as it was on any failure.
 */
export async function withTeaching(service: SupabaseClient, reply: string, clientText: string, kind?: RouteKey): Promise<string> {
  const taught = await lessonsText(service, kind);
  if (!taught || !isOpenAIConfigured()) return reply;
  try {
    const raw = await openaiJson({
      name: "taught_reply",
      system: [
        "You are Murad, the WhatsApp assistant of Traveliun, a Saudi travel company. Below: what the management taught you, the client's message, and the reply about to be sent.",
        "If a lesson applies to this message, return the reply with that lesson applied — add what it says to add, use its wording where it gives one — keeping every country, number and the closing question of the reply. Short Saudi Arabic. If no lesson applies, return the reply unchanged. Never add a fact that is in neither.",
        "",
        taught,
      ].join("\n"),
      user: `رسالة العميل: ${clientText.slice(-1000)}\n\nالرد:\n${reply}`,
      schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false },
      temperature: 0,
      timeoutMs: 15000,
    });
    const out = (JSON.parse(raw ?? "{}") as { reply?: string }).reply?.trim();
    return out || reply;
  } catch {
    return reply;
  }
}
