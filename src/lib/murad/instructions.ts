/**
 * «تعليمات الإدارة لمُراد» (the owner, 2026-10-24): the manager writes Murad an order — on «إعدادات مُراد» or from a
 * management number on WhatsApp — «لا تستلم اي طلب يخص التأشيرات», «لا ترسل لفلان», «ارسل الرسائل المتأخرة الى
 * الموظف», «تدرب على هذه المحادثة». The model only READS the order into this fixed set of actions; applying them is
 * plain code (applyActions) and what Murad says back is written from the actions, never by the model — so an order
 * cannot do more than a person could on the page, and the answer says exactly what changed.
 */
import { KIND_MODES, TASK_LABELS, validControl, type KindMode, type MuradControl } from "./control";
import { DEPARTMENT, ROUTE_KEYS, type RouteKey } from "./reception";

export type Named = { id: number; name: string };
export type Scope = "test" | "all";
export type Action =
  | { do: "kind_mode"; kind: RouteKey; mode: KindMode }
  | { do: "pause" | "resume"; agentId: number }
  | { do: "route"; kind: RouteKey; teamId: number | null; agentId: number | null }
  | { do: "late"; minutes: number; agentId: number }
  | { do: "late_off" }
  | { do: "task"; task: keyof typeof TASK_LABELS; on: boolean }
  | { do: "price" | "visa_all"; on: boolean }
  | { do: "scope"; scope: Scope };

/** what the model returns (strict schema: every key present, null when it does not apply) */
export type Reading = {
  type: "decision" | "lesson" | "train" | "client" | "preview" | "unclear";
  actions: {
    do: Action["do"];
    kind: RouteKey | null;
    mode: KindMode | null;
    agent_id: number | null;
    team_id: number | null;
    minutes: number | null;
    task: keyof typeof TASK_LABELS | null;
    on: boolean | null;
    scope: Scope | null;
  }[];
  lesson_question: string | null;
  lesson_answer: string | null;
  lesson_kind: RouteKey | null;
  conversation_id: number | null;
  ask_back: string | null;
};

const nul = (t: string, values?: readonly string[]) => (values ? { type: [t, "null"], enum: [...values, null] } : { type: [t, "null"] });
const DOS = ["kind_mode", "pause", "resume", "route", "late", "late_off", "task", "price", "visa_all", "scope"] as const;
export const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "actions", "lesson_question", "lesson_answer", "lesson_kind", "conversation_id", "ask_back"],
  properties: {
    type: { type: "string", enum: ["decision", "lesson", "train", "client", "preview", "unclear"] },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["do", "kind", "mode", "agent_id", "team_id", "minutes", "task", "on", "scope"],
        properties: {
          do: { type: "string", enum: [...DOS] },
          kind: nul("string", ROUTE_KEYS),
          mode: nul("string", Object.keys(KIND_MODES)),
          agent_id: nul("integer"),
          team_id: nul("integer"),
          minutes: nul("integer"),
          task: nul("string", Object.keys(TASK_LABELS)),
          on: nul("boolean"),
          scope: nul("string", ["test", "all"]),
        },
      },
    },
    lesson_question: nul("string"),
    lesson_answer: nul("string"),
    lesson_kind: nul("string", ROUTE_KEYS),
    conversation_id: nul("integer"),
    ask_back: nul("string"),
  },
} as const;

export function readingPrompt(text: string, ctx: { agents: Named[]; teams: Named[] }): string {
  return [
    "أنت مُراد، مساعد استقبال العملاء في شركة ترافليون للسفر. هذه رسالة من الإدارة (رقم إدارة أو صفحة الإعدادات). صنّفها:",
    "- decision: قرار إداري يغيّر طريقة عملك: استلام أو عدم استلام نوع من الطلبات، أو الرد بلا إجابة، أو التحويل لقسم أو موظف، أو إيقاف التحويل لموظف أو إعادته، أو الرسائل المتأخرة، أو تشغيل أو إيقاف مهمة، أو ذكر السعر، أو العمل مع كل العملاء أو أرقام التجربة.",
    "- lesson: تعليم لطريقة الرد (إذا سأل العميل عن كذا فرد بكذا، الرد الأفضل هو…، لا تقل كذا). ضع السؤال أو الموقف في lesson_question والرد أو القاعدة في lesson_answer.",
    "- train: طلب أن تتدرب على محادثة، ومعه رقم المحادثة في conversation_id.",
    "- client: رسالة مكتوبة كأنها من عميل (طلب سفر، تأشيرة، سؤال عميل) — تجربة لك كعميل.",
    "- preview: الإدارة تطلب أن ترى ردك الآن، لا أن تعلّمك («اعطني الإجابة الآن»، «ايش الإجابة إذا أحد سألك عن كذا»، «كيف بترد لو سألك عميل…»، «جرّب الرد»). ضع سؤال العميل نفسه في lesson_question («ايش العروض اللي عندكم»)، أو null إذا لم يُذكر سؤال. سؤال عن ردّك ليس درساً أبداً.",
    "- unclear: أمر لا تفهمه بثقة؛ اكتب في ask_back سؤالاً قصيراً واحداً.",
    "",
    "أفعال القرار (actions) — استخدم الأرقام من القوائم فقط ولا تخترع رقماً:",
    `- kind_mode: kind + mode (${Object.entries(KIND_MODES).map(([k, v]) => `${k}=${v}`).join("، ")}). «لا تستلم طلبات التأشيرات» = تأشيرات + off. «حوّلها فقط بدون رد» = route.`,
    "- pause / resume: agent_id — لا تحوّل لهذا الموظف / عاد يستلم.",
    "- route: kind + team_id و/أو agent_id — طلبات هذا النوع تذهب إلى هذا القسم أو الموظف.",
    "- late: minutes + agent_id — إذا لم يرد أحد بعد التحويل خلال المدة حوّلها لهذا الموظف. late_off: أوقف ذلك.",
    `- task: task + on (${Object.entries(TASK_LABELS).map(([k, v]) => `${k}=${v}`).join("، ")}).`,
    "- price: on — ذكر السعر في الردود. visa_all: on — الرد على التأشيرات لجميع العملاء. scope: test أو all — العمل مع أرقام التجربة فقط أو جميع العملاء.",
    `أنواع الطلبات: ${ROUTE_KEYS.map((k) => `${k} (${DEPARTMENT[k]})`).join("، ")}.`,
    `الموظفون: ${ctx.agents.map((a) => `${a.id}=${a.name}`).join("، ") || "—"}.`,
    `الأقسام: ${ctx.teams.map((t) => `${t.id}=${t.name}`).join("، ") || "—"}.`,
    "إذا ذُكر موظف أو قسم غير موجود في القوائم فالنوع unclear واسأل عنه.",
    "",
    `الرسالة: ${text}`,
  ].join("\n");
}

/** The model's reading as actions this system can do — anything naming an unknown colleague or department is dropped. */
export function toActions(r: Reading, ctx: { agents: Named[]; teams: Named[] }): Action[] {
  const agent = (id: number | null) => (id && ctx.agents.some((a) => a.id === id) ? id : null);
  const team = (id: number | null) => (id && ctx.teams.some((t) => t.id === id) ? id : null);
  const out: Action[] = [];
  for (const a of r.actions) {
    if (a.do === "kind_mode" && a.kind && a.mode) out.push({ do: "kind_mode", kind: a.kind, mode: a.mode });
    else if ((a.do === "pause" || a.do === "resume") && agent(a.agent_id)) out.push({ do: a.do, agentId: agent(a.agent_id)! });
    else if (a.do === "route" && a.kind && (team(a.team_id) || agent(a.agent_id))) out.push({ do: "route", kind: a.kind, teamId: team(a.team_id), agentId: agent(a.agent_id) });
    else if (a.do === "late" && agent(a.agent_id) && a.minutes && a.minutes >= 1 && a.minutes <= 1440) out.push({ do: "late", minutes: a.minutes, agentId: agent(a.agent_id)! });
    else if (a.do === "late_off") out.push({ do: "late_off" });
    else if (a.do === "task" && a.task && a.on !== null) out.push({ do: "task", task: a.task, on: a.on });
    else if ((a.do === "price" || a.do === "visa_all") && a.on !== null) out.push({ do: a.do, on: a.on });
    else if (a.do === "scope" && a.scope) out.push({ do: "scope", scope: a.scope });
  }
  return out;
}

/** The actions on Murad's settings — pure; null when the result would not be a valid control. */
export function applyActions(control: MuradControl, scope: Scope, actions: Action[]): { control: MuradControl; scope: Scope } | null {
  const c: MuradControl = structuredClone(control);
  let s = scope;
  for (const a of actions) {
    if (a.do === "kind_mode") c.kinds = { ...c.kinds, [a.kind]: a.mode };
    else if (a.do === "pause") c.paused = [...new Set([...(c.paused ?? []), a.agentId])];
    else if (a.do === "resume") c.paused = (c.paused ?? []).filter((id) => id !== a.agentId);
    else if (a.do === "route") c.handoffs = { ...c.handoffs, [a.kind]: { teamId: a.teamId ?? c.handoffs[a.kind]?.teamId ?? null, agentId: a.agentId } };
    else if (a.do === "late") c.late = { minutes: a.minutes, agentId: a.agentId };
    else if (a.do === "late_off") c.late = null;
    else if (a.do === "task") c.tasks = { ...c.tasks, [a.task]: a.on };
    else if (a.do === "price") c.includePrice = a.on;
    else if (a.do === "visa_all") c.visaAll = a.on;
    else if (a.do === "scope") s = a.scope;
  }
  return validControl(c) ? { control: c, scope: s } : null;
}

const onOff = (on: boolean) => (on ? "تشغيل" : "إيقاف");
/** What Murad says he did — from the actions, in the management's words. */
export function describe(a: Action, ctx: { agents: Named[]; teams: Named[] }): string {
  const agent = (id: number | null) => ctx.agents.find((x) => x.id === id)?.name ?? "—";
  const team = (id: number | null) => ctx.teams.find((x) => x.id === id)?.name ?? "—";
  switch (a.do) {
    case "kind_mode": return `${DEPARTMENT[a.kind]}: ${KIND_MODES[a.mode]}`;
    case "pause": return `لن أحوّل أي محادثة إلى ${agent(a.agentId)}`;
    case "resume": return `عاد ${agent(a.agentId)} يستلم التحويلات`;
    case "route": return `طلبات ${DEPARTMENT[a.kind]} تذهب إلى ${a.teamId ? `«${team(a.teamId)}»` : "قسمها"}${a.agentId ? ` — ${agent(a.agentId)}` : ""}`;
    case "late": return `إذا لم يرد أحد خلال ${a.minutes} دقيقة بعد التحويل أحوّلها إلى ${agent(a.agentId)}`;
    case "late_off": return "أوقفت تحويل الرسائل المتأخرة";
    case "task": return `${TASK_LABELS[a.task]}: ${onOff(a.on)}`;
    case "price": return `ذكر السعر في الردود: ${onOff(a.on)}`;
    case "visa_all": return `الرد على التأشيرات لجميع العملاء: ${onOff(a.on)}`;
    case "scope": return a.scope === "all" ? "أعمل الآن مع جميع العملاء" : "أعمل الآن مع أرقام التجربة فقط";
  }
}

/** «تراجع» / «الغ آخر قرار» — the undo word, folded loosely */
export const isUndo = (text: string) => /^(تراجع|تراجّع|الغ(اء)? (اخر|آخر) (قرار|امر|أمر)|undo)[.!؟\s]*$/u.test(text.trim());
/** «لا» / «غلط» / «مو كذا» — a lesson just saved, refused */
export const isRefusal = (text: string) => /^(لا|لاء|لا ?مو ?كذا|مو ?كذا|غلط|خطأ|خطا|مو ?صحيح|غير ?صحيح|لا ?تحفظه|احذفه|امسحه)[.!؟\s]*$/u.test(text.trim());
