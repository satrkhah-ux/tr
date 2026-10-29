import type { Permission } from "@/lib/roles/roles";
import { canOpenPath } from "@/lib/roles/section-access";
import { HELP_TOPICS, type HelpTopic } from "./help-corpus";

/**
 * «اسأل مُراد» about the system itself (the owner, 2026-10-29: «اريد السكرتير
 * يجاوب على اسئلة تخص النظام — مثلا كيفية إنشاء بكج، كيفية المتابعة»). مُراد
 * answers from help-corpus.ts ONLY, and only the topics whose page the asking
 * employee may open (section-access.ts + the topic's own permission) — a page
 * they cannot open is never explained to them.
 */

/** «كيف / طريقة / وين / أين / خطوات…» — a question about using the system, not about the employee's own day */
const HOW_TO = /(كيف|كيفية|طريقة|طريقه|خطوات|وين|أين|اين|من وين|ابغى اعرف|أبغى أعرف|اشرح|وش معنى|ما معنى|ماذا يعني|ايش يعني|إيش يعني|شلون)/;

export function isHowTo(question: string): boolean {
  return HOW_TO.test(question);
}

/** the topics this employee may hear about */
export function helpTopicsFor(can: (p: Permission) => boolean, topics: readonly HelpTopic[] = HELP_TOPICS): HelpTopic[] {
  return topics.filter((t) => canOpenPath(t.route, can) && (!t.perm || t.perm.some(can)));
}

const norm = (s: string) =>
  s
    .replace(/[ً-ْـ]/g, "") // تشكيل + تطويل
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();

/** the best few topics for a question: a keyword hit counts double a title word */
export function matchHelp(question: string, topics: readonly HelpTopic[], limit = 3): HelpTopic[] {
  const q = norm(question);
  return topics
    .map((t) => ({
      t,
      score: (question.includes(t.route) ? 3 : 0) + t.keywords.reduce((s, k) => s + (q.includes(norm(k)) ? 2 : 0), 0) + norm(t.title).split(/\s+/).filter((w) => w.length > 2 && q.includes(w)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

export function renderTopic(t: HelpTopic): string {
  return [
    `## ${t.title} — الصفحة: ${t.route}`,
    ...t.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(t.notes?.length ? ["تنبيهات:", ...t.notes.map((n) => `- ${n}`)] : []),
  ].join("\n");
}

/** the answer without a model: the best topic as it is written */
export function helpFallback(matched: readonly HelpTopic[]): string {
  if (!matched.length) return "لست متأكداً من هذا السؤال — ليس في دليلي. افتح الصفحة من القائمة الجانبية أو اسأل مديرك.";
  const t = matched[0];
  return [`${t.title}:`, ...t.steps.map((s, i) => `${i + 1}. ${s}`), ...(t.notes ?? []).map((n) => `• ${n}`), `الصفحة: ${t.route}`].join("\n");
}

export const HELP_SYSTEM = [
  "أنت «مُراد»، مساعد موظفي ترافليون للسفر والسياحة. تشرح للموظف كيف يستعمل النظام.",
  "قواعد لا تُكسر:",
  "- أجب من «دليل النظام» المعطى لك فقط. لا تخترع زراً ولا صفحة ولا ميزة غير مكتوبة فيه.",
  "- إن لم يكن الجواب في الدليل فقل «لست متأكداً» ووجّهه لأقرب صفحة في الدليل أو لمديره.",
  "- اذكر الخطوات مرقّمة وقصيرة بالعربية البسيطة، واذكر رابط الصفحة كما هو في الدليل (مثل /basic).",
  "- لا تشرح صفحة غير موجودة في الدليل المعطى — قد لا تكون من صلاحيته؛ قل «هذه ليست ضمن صفحاتك، اسأل مديرك».",
  "- لا تذكر أسعار شراء ولا مفاتيح ولا بيانات عملاء. الرسوم لا تُعرض على العميل أبداً.",
].join("\n");

export const ERROR_SYSTEM = [
  "أنت «مُراد»، مساعد موظفي ترافليون. ظهر للموظف خطأ في النظام وأرسله لك: اشرح السبب المحتمل وماذا يفعل.",
  "قواعد لا تُكسر:",
  "- بالعربية البسيطة، سطران أو ثلاثة: «السبب المحتمل» ثم «ماذا تفعل».",
  "- استند إلى نص الخطأ وإلى «دليل النظام» المعطى فقط؛ إن لم تعرف السبب فقل ذلك صراحة واقترح «أبلغ الإدارة».",
  "- لا تطلب منه كلمة مرور ولا مفتاحاً، ولا تقترح تجاوز صلاحية أو مراسلة العميل من خارج النظام.",
].join("\n");

export function helpContext(question: string, matched: readonly HelpTopic[], allowed: readonly HelpTopic[]): string {
  return [
    "دليل النظام (المواضيع الأقرب للسؤال):",
    ...(matched.length ? matched.map(renderTopic) : ["(لا موضوع مطابق)"]),
    "",
    `صفحات أخرى يستطيع فتحها: ${allowed.filter((t) => !matched.includes(t)).map((t) => `${t.title} ${t.route}`).join("، ") || "—"}`,
    "",
    `سؤال الموظف: ${question}`,
  ].join("\n");
}

export const HELP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply"],
  properties: { reply: { type: "string" } },
} as const;
