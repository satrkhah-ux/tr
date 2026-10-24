import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { responsesJson } from "@/lib/providers/openai";
import { ROUTE_KEYS, type RouteKey } from "./reception";
import { readThread } from "./run";
import { onList, type MuradControl } from "./control";

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
export async function lessonsFrom(conversationId: number, opts: { model?: string; skip?: string[] } = {}): Promise<Lesson[] | null> {
  const thread = await readThread(conversationId);
  if (!thread) return null;
  // the management's own numbers are orders and trials, not the company talking to a client
  if (onList(thread.phone, opts.skip)) return [];
  const lines = thread.messages.filter((t) => !t.isPrivate && !t.template && t.text.trim()).map((t) => `${t.fromClient ? "العميل" : "الموظف"}: ${strip(t.text).slice(0, 600)}`);
  if (lines.length < 2 || !lines.some((l) => l.startsWith("الموظف"))) return [];
  const prompt = [
    "هذه محادثة واتساب بين عميل وموظف في شركة ترافليون للسفر. استخرج ما يتعلمه مساعد الاستقبال «مُراد» من ردود الموظف الجيدة:",
    "- سؤال يتكرر عند العملاء (بصيغة عامة) وجواب الشركة عليه، والجواب فيه معلومة محددة: متطلبات، مدة، إجراء، ما يشمله البكج، سياسة دفع أو إلغاء، نصيحة سفر.",
    "- لا تستخرج العبارات العامة: الترحيب، «سيتم تحويلك»، «سيتواصل معك الموظف/المستشار»، «سنتابع طلبك»، الشكر. هذه ليست دروساً.",
    "- لا تكتب اسم العميل ولا رقمه ولا سعراً خاصاً بطلبه ولا تواريخه.",
    "- لا تستخرج شيئاً من رد خاطئ أو غير مهذب. إن لم يكن في المحادثة معلومة محددة تُتعلّم فأعد قائمة فارغة — وهذا هو الغالب.",
    `- kind نوع الطلب: ${ROUTE_KEYS.join("، ")} أو null.`,
    "- ثلاثة دروس على الأكثر، كل جواب في سطرين على الأكثر.",
    "",
    lines.slice(-40).join("\n"),
  ].join("\n");
  const out = (await responsesJson("murad_lessons", LESSONS_SCHEMA, [{ type: "input_text", text: prompt }], opts.model ?? (process.env["OPENAI_FOLLOWUP_MODEL"] || "gpt-5.5"))) as { lessons?: Lesson[] };
  return (out.lessons ?? []).filter((l) => l.answer?.trim() && !GENERIC.test(l.answer)).slice(0, 3).map((l) => ({ question: l.question?.trim() || null, answer: l.answer.trim(), kind: l.kind }));
}

/** an answer that only says someone will answer — what the first 18 lessons were (2026-10-24), and no lesson */
const GENERIC = /^[^.،]{0,40}(سيتم تحويل|سيتواصل معك|سنتواصل|يرحب بالعميل|سنتابع|زميلنا|المستشار)[^.]*\.?$/u;

/** kept unless the same question is already known — the same few questions recur across thousands of conversations */
async function keep(service: SupabaseClient, lessons: Lesson[], conversationId: number, instructionId: string | null): Promise<number | null> {
  const asked = lessons.map((l) => l.question).filter((q): q is string => Boolean(q));
  const { data } = asked.length ? await service.from("murad_lessons").select("question").in("question", asked) : { data: [] };
  const known = new Set(((data ?? []) as { question: string }[]).map((r) => r.question));
  const fresh = lessons.filter((l) => !l.question || !known.has(l.question));
  if (!fresh.length) return 0;
  const { error } = await service.from("murad_lessons").insert(fresh.map((l) => ({ source: "conversation", kind: l.kind, question: l.question, answer: l.answer, conversation_id: conversationId, instruction_id: instructionId })));
  return error ? null : fresh.length;
}

/** «تدرب على هذه المحادثة»: its lessons, kept; how many. */
export async function trainOn(service: SupabaseClient, conversationId: number, instructionId: string | null = null): Promise<number | null> {
  const lessons = await lessonsFrom(conversationId);
  if (!lessons) return null;
  return lessons.length ? keep(service, lessons, conversationId, instructionId) : 0;
}

/** where the reading of every past conversation stands (app_settings murad_learn) */
export type LearnState = { next: number; read: number; lessons: number; at: string | null };
export const LEARN_KEY = "murad_learn";
const PER_RUN = 3;

/**
 * «تعلّم من كل المحادثات» (murad_control.learn): a few past conversations a minute, newest first, down to the first —
 * their colleague answers read into lessons by a cheaper model (OPENAI_LEARN_MODEL, gpt-4o-mini: tens of thousands of
 * conversations). The management's teaching and «تدرب على المحادثة» keep the stronger one.
 */
export async function learnSweep(service: SupabaseClient, control: MuradControl, skip: string[]): Promise<number> {
  if (!control.learn) return 0;
  const { data } = await service.from("app_settings").select("value").eq("key", LEARN_KEY).maybeSingle();
  let state = (() => { try { return JSON.parse((data as { value?: string } | null)?.value ?? "") as LearnState; } catch { return null; } })();
  if (!state) {
    const { data: top } = await service.from("client_leads").select("teletel_conversation_id").not("teletel_conversation_id", "is", null).order("teletel_conversation_id", { ascending: false }).limit(1).maybeSingle();
    state = { next: Number((top as { teletel_conversation_id?: number } | null)?.teletel_conversation_id ?? 0), read: 0, lessons: 0, at: null };
  }
  if (state.next < 1) return 0;
  const ids = Array.from({ length: PER_RUN }, (_, i) => state!.next - i).filter((id) => id > 0);
  // claimed before the model: the next minute starts below these, whatever happens to them
  const claimed: LearnState = { ...state, next: state.next - PER_RUN, at: new Date().toISOString() };
  await service.from("app_settings").upsert({ key: LEARN_KEY, value: JSON.stringify(claimed), updated_at: claimed.at! });
  const { data: known } = await service.from("murad_lessons").select("conversation_id").in("conversation_id", ids);
  const seen = new Set(((known ?? []) as { conversation_id: number }[]).map((r) => Number(r.conversation_id)));
  let added = 0;
  for (const id of ids.filter((x) => !seen.has(x))) {
    const lessons = await lessonsFrom(id, { model: process.env["OPENAI_LEARN_MODEL"] || "gpt-4o-mini", skip }).catch(() => null);
    if (!lessons?.length) continue;
    added += (await keep(service, lessons, id, null)) ?? 0;
  }
  const { data: now } = await service.from("app_settings").select("value").eq("key", LEARN_KEY).maybeSingle();
  const latest = (() => { try { return JSON.parse((now as { value?: string } | null)?.value ?? "") as LearnState; } catch { return claimed; } })();
  await service.from("app_settings").upsert({ key: LEARN_KEY, value: JSON.stringify({ ...latest, read: latest.read + ids.length, lessons: latest.lessons + added }), updated_at: new Date().toISOString() });
  return added;
}
