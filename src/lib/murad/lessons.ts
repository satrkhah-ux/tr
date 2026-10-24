import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { responsesJson } from "@/lib/providers/openai";
import { ROUTE_KEYS, type RouteKey } from "./reception";
import { readThread } from "./run";

/**
 * What Murad learns (the owner, 2026-10-24: «اريده ان يتعلم من كل المحادثات الموجودة في النظام»): the management's
 * teaching in its own words, and what the colleagues' good answers in past conversations show — a client's question
 * and the company's answer, never a client's name, number or private price.
 */
export type Lesson = { question: string | null; answer: string; kind: RouteKey | null };

const LESSONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lessons"],
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer", "kind"],
        properties: { question: { type: "string" }, answer: { type: "string" }, kind: { type: ["string", "null"], enum: [...ROUTE_KEYS, null] } },
      },
    },
  },
} as const;

const strip = (s: string) => s.replace(/\+?\d[\d\s-]{7,}\d/g, "[رقم]").replace(/\S+@\S+/g, "[بريد]").trim();

/** Up to six lessons from one conversation's colleague answers; [] when nothing general was said. */
export async function lessonsFrom(conversationId: number): Promise<Lesson[] | null> {
  const thread = await readThread(conversationId);
  if (!thread) return null;
  const lines = thread.messages.filter((t) => !t.isPrivate && !t.template && t.text.trim()).map((t) => `${t.fromClient ? "العميل" : "الموظف"}: ${strip(t.text).slice(0, 600)}`);
  if (lines.length < 2 || !lines.some((l) => l.startsWith("الموظف"))) return [];
  const prompt = [
    "هذه محادثة واتساب بين عميل وموظف في شركة ترافليون للسفر. استخرج ما يتعلمه مساعد الاستقبال «مُراد» من ردود الموظف الجيدة:",
    "- سؤال أو موقف يتكرر عند العملاء (بصيغة عامة) والجواب الذي أعطته الشركة أو طريقة الرد.",
    "- لا تكتب اسم العميل ولا رقمه ولا سعراً خاصاً بطلبه ولا تواريخه. معلومة عامة عن الخدمة أو السياسة أو الإجراء أو الأسلوب فقط.",
    "- لا تستخرج شيئاً من رد خاطئ أو غير مهذب. إن لم يكن في المحادثة شيء عام يُتعلّم فأعد قائمة فارغة.",
    `- kind نوع الطلب: ${ROUTE_KEYS.join("، ")} أو null.`,
    "- ستة دروس على الأكثر، كل جواب في سطرين على الأكثر.",
    "",
    lines.slice(-40).join("\n"),
  ].join("\n");
  const out = (await responsesJson("murad_lessons", LESSONS_SCHEMA, [{ type: "input_text", text: prompt }], process.env["OPENAI_FOLLOWUP_MODEL"] || "gpt-5.5")) as { lessons?: Lesson[] };
  return (out.lessons ?? []).filter((l) => l.answer?.trim()).slice(0, 6).map((l) => ({ question: l.question?.trim() || null, answer: l.answer.trim(), kind: l.kind }));
}

/** «تدرب على هذه المحادثة»: its lessons, kept; how many. */
export async function trainOn(service: SupabaseClient, conversationId: number, instructionId: string | null = null): Promise<number | null> {
  const lessons = await lessonsFrom(conversationId);
  if (!lessons) return null;
  if (!lessons.length) return 0;
  const { error } = await service.from("murad_lessons").insert(lessons.map((l) => ({ source: "conversation", kind: l.kind, question: l.question, answer: l.answer, conversation_id: conversationId, instruction_id: instructionId })));
  return error ? null : lessons.length;
}
