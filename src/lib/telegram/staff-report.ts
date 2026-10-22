import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { agentSummaries, type AgentSummary } from "@/lib/providers/teletel";
import { isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
import { myNumbers, riyadhDayStart, secondsText, waitText, type MyNumbers } from "./staff-numbers";
import { escapeHtml, staffSend, type StaffMember } from "./staff-bot";

/**
 * «تنبيهاتي» stage d: each employee's day, every evening, with two or three
 * tips for tomorrow.
 *
 * The tips stand on the employee's own numbers and nothing else. The rules
 * below turn each number into a sentence (ruleTips). When OpenAI is configured,
 * the model may only rephrase those facts in a friendly Saudi voice, and its
 * answer is dropped if it is empty or too long. The model never sees a client,
 * a phone or a message, only the counts. The team average is a mean over every
 * agent, so nobody else's number is ever said.
 *
 * The evening send runs inside the minute job. The first tick at REPORT_HOUR
 * (Riyadh) claims each employee's row in staff_bot_reports, and a row that
 * exists is never sent twice.
 */

/** 23:00 Riyadh: the end of the working day (the reception's hours end at 23:00). */
export const REPORT_HOUR = 23;

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type Team = { firstResponseSec: number | null; replySec: number | null };

/** The mean of every agent who had conversations today. One figure for the team, nobody's own. */
export function teamAverages(all: Map<number, AgentSummary> | null): Team {
  const rows = [...(all?.values() ?? [])].filter((r) => r.conversations > 0 || r.resolved > 0);
  const mean = (pick: (r: AgentSummary) => number | null) => {
    const v = rows.map(pick).filter((x): x is number => x != null && x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return { firstResponseSec: mean((r) => r.firstResponseSec), replySec: mean((r) => r.replySec) };
}

export type Facts = { numbers: MyNumbers; team: Team; issued: number; botReplies: number };

/** Every tip is one of the employee's numbers, said as something to do tomorrow. The worst first, at most three. */
export function ruleTips(f: Facts): string[] {
  const n = f.numbers;
  const r = n.today.report;
  const tips: string[] = [];
  if (n.neverAnswered > 0) tips.push(`عندك ${n.neverAnswered} محادثة لم يُرد عليها أبداً — ابدأ بها غداً قبل أي شيء، فالعميل الذي لا يجد رداً يذهب لغيرنا.`);
  if (n.waiting > 0) tips.push(`${n.waiting} عميل ينتظر ردك${n.oldestWaitMin != null ? `، أقدمهم منذ ${waitText(n.oldestWaitMin)}` : ""} — ردّ عليهم أول الدوام ولو برسالة قصيرة تطمئنهم.`);
  if (r?.firstResponseSec && f.team.firstResponseSec && r.firstResponseSec > f.team.firstResponseSec * 1.2) {
    tips.push(`متوسط أول رد عندك ${secondsText(r.firstResponseSec)} مقابل ${secondsText(f.team.firstResponseSec)} للفريق — أول رد خلال 5 دقائق يرفع فرصة الحجز.`);
  }
  if (r?.replySec && f.team.replySec && r.replySec > f.team.replySec * 1.2) {
    tips.push(`متوسط ردك أثناء المحادثة ${secondsText(r.replySec)} مقابل ${secondsText(f.team.replySec)} للفريق — فعّل تنبيهات البوت لتعرف فور كتابة العميل.`);
  }
  if (n.open > 25 && (r?.resolved ?? 0) < 3) tips.push(`لديك ${n.open} محادثة مفتوحة — أغلق ما انتهى منها في تيلي تيل حتى تبقى قائمتك لمن ينتظرك فعلاً.`);
  if (!tips.length) tips.push("يومك ممتاز — لا أحد ينتظرك وردودك أسرع من متوسط الفريق. حافظ على نفس الإيقاع غداً 👏");
  return tips.slice(0, 3);
}

const TIPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { tips: { type: "array", items: { type: "string" } } },
  required: ["tips"],
} as const;

/** The same facts in a warmer voice. Null when there is no model, or its answer is unusable, and then the rules stand as written. */
async function voiced(name: string, facts: string[]): Promise<string[] | null> {
  if (!isOpenAIConfigured()) return null;
  try {
    const raw = await openaiJson({
      name: "staff_tips",
      system: [
        "أنت مدرّب مبيعات في شركة سياحة سعودية، تكتب لموظف خدمة عملاء عبر واتساب نصائح قصيرة لليوم التالي.",
        "اكتب بلهجة سعودية مهذبة ودودة، كل نصيحة جملة أو جملتان.",
        "استخدم الحقائق المعطاة فقط وبأرقامها كما هي، ولا تضف أي رقم أو معلومة أو اسم عميل غير موجود فيها.",
        "عدد النصائح بعدد الحقائق، وبنفس ترتيبها.",
      ].join("\n"),
      user: `اسم الموظف: ${name}\nالحقائق:\n${facts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
      schema: TIPS_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.4,
      timeoutMs: 20_000,
    });
    const tips = (JSON.parse(raw ?? "{}") as { tips?: unknown }).tips;
    if (!Array.isArray(tips) || tips.length !== facts.length) return null;
    const clean = tips.map((t) => String(t).trim()).filter((t) => t.length > 0 && t.length <= 260);
    return clean.length === facts.length ? clean : null;
  } catch {
    return null;
  }
}

async function counts(me: StaffMember, since: number): Promise<{ issued: number; botReplies: number }> {
  const iso = new Date(since * 1000).toISOString();
  const [offers, replies] = await Promise.all([
    db().from("offers").select("id", { count: "exact", head: true }).eq("employee_id", me.id).neq("status", "draft").gte("created_at", iso),
    db().from("staff_bot_replies").select("id", { count: "exact", head: true }).eq("employee_id", me.id).gte("created_at", iso),
  ]);
  return { issued: offers.count ?? 0, botReplies: replies.count ?? 0 };
}

export type Report = { text: string; facts: Facts; tips: string[] };

/** One employee's report for Riyadh's day so far. Null without a Teletel agent, or when Teletel cannot be read. */
export async function buildReport(me: StaffMember, nowMs = Date.now(), summaries?: Map<number, AgentSummary> | null): Promise<Report | null> {
  if (!me.agentId) return null;
  const since = riyadhDayStart(nowMs);
  const [numbers, all, extra] = await Promise.all([
    myNumbers(me.agentId, nowMs),
    summaries === undefined ? agentSummaries(since, Math.floor(nowMs / 1000)) : Promise.resolve(summaries),
    counts(me, since),
  ]);
  if (!numbers) return null;
  const facts: Facts = { numbers, team: teamAverages(all), ...extra };
  const rules = ruleTips(facts);
  const tips = (await voiced(me.name, rules)) ?? rules;
  const r = numbers.today.report;
  const day = new Date(nowMs).toLocaleDateString("ar-SA-u-nu-latn-ca-gregory", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long" });
  const text = [
    `📈 <b>تقريرك اليوم</b> — ${escapeHtml(day)}`,
    "",
    `• محادثات اليوم: <b>${r?.conversations ?? 0}</b> · أغلقت: <b>${r?.resolved ?? 0}</b>`,
    `• تحويلات وصلتك: <b>${numbers.today.assigned}</b>`,
    `• متوسط أول رد: <b>${secondsText(r?.firstResponseSec)}</b> (الفريق: ${secondsText(facts.team.firstResponseSec)})`,
    `• متوسط الرد: <b>${secondsText(r?.replySec)}</b> (الفريق: ${secondsText(facts.team.replySec)})`,
    `• ملفات أصدرتها في النظام: <b>${extra.issued}</b>`,
    extra.botReplies ? `• ردود أرسلتها من البوت: <b>${extra.botReplies}</b>` : null,
    "",
    `• مفتوحة لك الآن: <b>${numbers.open}</b> — بانتظار ردك: <b>${numbers.waiting}</b> — لم يُرد عليها: <b>${numbers.neverAnswered}</b>`,
    "",
    "💡 <b>لغدٍ أفضل</b>",
    ...tips.map((t, i) => `${i + 1}. ${escapeHtml(t)}`),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return { text, facts, tips };
}

/**
 * The evening round: from REPORT_HOUR Riyadh, each linked employee with a
 * Teletel agent gets their report once a day. The row is claimed before the
 * send, so a second tick in the same minute finds it taken.
 */
export async function sendDailyReports(nowMs = Date.now()): Promise<{ sent: number } | null> {
  const riyadh = new Date(nowMs + 3 * 3600_000);
  if (riyadh.getUTCHours() < REPORT_HOUR) return null;
  const day = riyadh.toISOString().slice(0, 10);
  const { data } = await db()
    .from("employees")
    .select("id, arabic_name, telegram_chat_id, teletel_agent_id")
    .eq("status", "Active")
    .not("telegram_chat_id", "is", null)
    .not("teletel_agent_id", "is", null);
  const members = ((data ?? []) as { id: string; arabic_name: string; telegram_chat_id: number | string; teletel_agent_id: number }[]).map((e) => ({
    id: e.id,
    name: e.arabic_name,
    chatId: Number(e.telegram_chat_id),
    agentId: e.teletel_agent_id,
  }));
  // the hour after REPORT_HOUR ticks every minute: once everyone has today's row, it asks Teletel nothing
  const { data: done } = await db().from("staff_bot_reports").select("employee_id").eq("day", day);
  const sentTo = new Set(((done ?? []) as { employee_id: string }[]).map((r) => r.employee_id));
  if (!members.some((m) => !sentTo.has(m.id))) return { sent: 0 };
  const since = riyadhDayStart(nowMs);
  const summaries = await agentSummaries(since, Math.floor(nowMs / 1000));
  let sent = 0;
  for (const me of members.filter((m) => !sentTo.has(m.id))) {
    const { data: claimed } = await db().from("staff_bot_reports").upsert({ day, employee_id: me.id }, { onConflict: "day,employee_id", ignoreDuplicates: true }).select("day");
    if (!claimed?.length) continue;
    const report = await buildReport(me, nowMs, summaries);
    if (!report) continue;
    const ok = (await staffSend(me.chatId, report.text)).ok;
    await db()
      .from("staff_bot_reports")
      .update({ numbers: report.facts, tips: report.tips, sent: ok })
      .eq("day", day)
      .eq("employee_id", me.id);
    if (ok) sent += 1;
  }
  return { sent };
}
