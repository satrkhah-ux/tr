import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { responsesJson } from "@/lib/providers/openai";
import type { RouteKey } from "./reception";
import { foldDue, TOPICS, type Knowledge, type Topic } from "./knowledge-topics";

export { TOPICS, type Knowledge, type Topic };

/**
 * «ذاكرة مُراد» (the owner, 2026-10-24: «ارفع مستوى ذكاء مراد الى اعلى جاهزية»): the thousands of lessons read from
 * past conversations (lessons.ts) folded, per subject, into one short reference Murad reads — the same question asked
 * a hundred times once, the newest and most repeated answer kept, a contradiction or a price from an old chat left out.
 * The management's own teaching always wins and is never folded away. Made again for a subject only when enough new
 * lessons came in, or half a day passed (app_settings murad_knowledge).
 */
export const KNOWLEDGE_KEY = "murad_knowledge";

const KIND_TOPIC: Partial<Record<RouteKey, Topic>> = { تأشيرات: "visa", بكج: "package", طيران: "flight", فنادق: "hotel", مواصلات: "transport" };
export const topicOf = (kind: RouteKey | string | null | undefined): Topic => KIND_TOPIC[kind as RouteKey] ?? "general";
const kindsOf = (t: Topic): (string | null)[] => (t === "general" ? [null, "موظف", "غير واضح"] : Object.entries(KIND_TOPIC).filter(([, v]) => v === t).map(([k]) => k));

const READ_AT_MOST = 400;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "a"], properties: { q: { type: "string" }, a: { type: "string" } } } } },
} as const;

export async function readKnowledge(service: SupabaseClient): Promise<Knowledge> {
  const { data } = await service.from("app_settings").select("value").eq("key", KNOWLEDGE_KEY).maybeSingle();
  try {
    return JSON.parse((data as { value?: string } | null)?.value ?? "") as Knowledge;
  } catch {
    return { at: null, topics: {} };
  }
}

let folding = false;

/** One subject at most per call (the minute job calls it): the one most behind. */
export async function foldKnowledge(service: SupabaseClient): Promise<Topic | null> {
  if (folding) return null;
  folding = true;
  try {
    const known = await readKnowledge(service);
    const counts = await Promise.all((Object.keys(TOPICS) as Topic[]).map(async (t) => {
      const kinds = kindsOf(t);
      let q = service.from("murad_lessons").select("id", { count: "exact", head: true }).eq("active", true).eq("source", "conversation");
      q = kinds.includes(null) ? q.or(`kind.is.null,${kinds.filter(Boolean).map((k) => `kind.eq.${k}`).join(",")}`) : q.in("kind", kinds as string[]);
      const { count } = await q;
      return [t, count ?? 0] as const;
    }));
    const now = Date.now();
    const due = counts
      .map(([t, n]) => ({ t, n, was: known.topics[t] }))
      .filter(({ n, was }) => foldDue(n, was, now))
      .sort((a, b) => (b.n - (b.was?.lessons ?? 0)) - (a.n - (a.was?.lessons ?? 0)))[0];
    if (!due) return null;

    const kinds = kindsOf(due.t);
    let q = service.from("murad_lessons").select("question, answer").eq("active", true).eq("source", "conversation").order("created_at", { ascending: false }).limit(READ_AT_MOST);
    q = kinds.includes(null) ? q.or(`kind.is.null,${kinds.filter(Boolean).map((k) => `kind.eq.${k}`).join(",")}`) : q.in("kind", kinds as string[]);
    const { data } = await q;
    const lessons = (data ?? []) as { question: string | null; answer: string }[];
    const prompt = [
      `أنت تبني «ذاكرة مُراد» في موضوع «${TOPICS[due.t]}» لشركة ترافليون للسفر: مرجع قصير يقرؤه مساعد الاستقبال قبل أن يرد على العميل.`,
      "أمامك دروس استُخرجت من محادثات الموظفين مع العملاء (الأحدث أولاً). ادمجها في أسئلة وأجوبة نهائية:",
      "- السؤال المتكرر مرة واحدة بصيغة عامة، وجوابه الأكثر تكراراً والأحدث.",
      "- احذف ما يتعارض ولا يمكن الحسم فيه، أو اكتب «يتأكد منه الموظف».",
      "- لا تكتب أي سعر أو مبلغ أو رسوم بالأرقام — الأسعار من قوائم الشركة فقط، قل «حسب القائمة الحالية».",
      "- لا تكتب اسماً أو رقماً لعميل. لا تخترع شيئاً ليس في الدروس.",
      "- 40 سؤالاً على الأكثر، كل جواب سطران على الأكثر، بالعربية الواضحة.",
      "",
      ...lessons.map((l, i) => `${i + 1}. س: ${l.question ?? "—"} | ج: ${l.answer}`),
    ].join("\n");
    const out = (await responsesJson("murad_knowledge", SCHEMA, [{ type: "input_text", text: prompt }], process.env["OPENAI_FOLLOWUP_MODEL"] || "gpt-5.5")) as { items?: { q: string; a: string }[] };
    const items = (out.items ?? []).filter((i) => i.q?.trim() && i.a?.trim()).slice(0, 40);
    if (!items.length) return null;
    // re-read just before the write: another subject may have been folded meanwhile
    const latest = await readKnowledge(service);
    const at = new Date().toISOString();
    const next: Knowledge = { at, topics: { ...latest.topics, [due.t]: { at, lessons: due.n, items } } };
    await service.from("app_settings").upsert({ key: KNOWLEDGE_KEY, value: JSON.stringify(next), updated_at: at });
    return due.t;
  } finally {
    folding = false;
  }
}

/** The subject's reference and the general one, as the text Murad's answer reads after the policies and the teaching. */
export function knowledgeText(k: Knowledge, kind: RouteKey | string | null | undefined): string {
  const pick = [...new Set([topicOf(kind), "general" as Topic])].map((t) => [t, k.topics[t]] as const).filter(([, v]) => v?.items.length);
  if (!pick.length) return "";
  return pick
    .map(([t, v]) => [`## ذاكرة مُراد — ${TOPICS[t]} (من محادثات فريقنا؛ السياسات وقائمة التأشيرات وتعليم الإدارة أولى منها)`, ...v!.items.map((i) => `س: ${i.q}\nج: ${i.a}`)].join("\n"))
    .join("\n\n");
}
