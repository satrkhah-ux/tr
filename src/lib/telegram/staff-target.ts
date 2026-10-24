import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MONTHS, type Target } from "@/lib/finance/model";
import { commissionMonth } from "@/lib/commissions/month";
import { loadCases } from "@/lib/data/operation-money";
import { getRates } from "@/lib/data/rates-actions";
import { escapeHtml, type StaffMember } from "./staff-bot";
import { isBotManager } from "./staff-manager";
import type { InlineButton } from "./ops-bot";

/**
 * «🎯 هدفي» (the owner, 2026-10-24): the month's net-profit target that the
 * financial plan («الحسابات المالية» → «الخطة القادمة») set for each seller, and
 * how far they are. An employee sees their own line only; the bot's managers
 * see every seller's, each with a progress bar.
 *
 * Achieved = «العمولات»'s own monthly profit (commissionMonth): the files whose
 * client finished paying this month, on their actual profit.
 *
 * The plan writes the sellers in its focus text, one line:
 *   «أهداف البائعين (صافي ربح): <short name> <amount> · <short name> <amount> · … = <total>»
 * (the repository is public: never a real name or figure from the plan in here or in the tests)
 * ponytail: read from that line's wording; a structured per-seller field in the plan when the owner wants to edit targets one by one.
 */

type Line = { name: string; profit: number };
type Person = { id: string; name: string };
export type Matched = Person & { profit: number };

const LINE = /أهداف البائعين[^:]*:([^\n]*)/;

export function sellerTargets(focus: string): Line[] {
  const line = LINE.exec(focus)?.[1] ?? "";
  return line
    .split(/[·=]/)
    .map((part) => /^\s*([^\d]+?)\s+([\d,]+)\s*$/.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[1].trim(), profit: Number(m[2].replace(/,/g, "")) }));
}

const words = (s: string) =>
  s
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ـً-ْ]/g, "")
    .split(/\s+/)
    .filter(Boolean);

/**
 * The plan's short name (a family name, or first + second) belongs to the one employee
 * whose name holds every word of it. A line no one or several fit
 * («التأشيرات», «اليمن») stays a line, never guessed onto a person.
 */
export function matchSellers(lines: Line[], people: Person[]): { matched: Matched[]; unmatched: string[] } {
  const matched: Matched[] = [];
  const unmatched: string[] = [];
  for (const l of lines) {
    const fits = people.filter((p) => words(l.name).every((w) => words(p.name).includes(w)));
    if (fits.length === 1) matched.push({ ...fits[0], profit: l.profit });
    else unmatched.push(l.name);
  }
  return { matched, unmatched };
}

const riyadhMonth = (nowMs: number) => new Date(nowMs + 3 * 3600_000).toISOString().slice(0, 7);

/** this month's target in Riyadh, else the next one planned (the plan is written ahead of its month) */
export function planMonth(targets: Target[], nowMs: number): Target | null {
  const now = riyadhMonth(nowMs);
  return targets.find((t) => t.month === now) ?? [...targets].filter((t) => t.month > now).sort((a, b) => a.month.localeCompare(b.month))[0] ?? null;
}

export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const sar = (n: number) => Math.round(n).toLocaleString("en-US");

/** ten cells and the share, e.g. «▓▓▓▓░░░░░░ 38%» (past 100% the bar stays full, the share says how far) */
export function bar(done: number, target: number): string {
  const pct = target > 0 ? Math.max(0, Math.round((done / target) * 100)) : 0;
  const cells = Math.min(10, Math.floor(pct / 10));
  return `${"▓".repeat(cells)}${"░".repeat(10 - cells)} ${pct}%`;
}

/** done = null: the month has not started, nothing to count yet */
export function targetText(name: string, month: string, profit: number | null, done: number | null): string {
  const head = `🎯 <b>هدف المبيعات — ${monthLabel(month)}</b>`;
  if (profit === null) return `${head}\n\nلم يُحدَّد لك هدف مبيعات في الخطة لهذا الشهر.`;
  return [
    head,
    "",
    `${escapeHtml(name)}، هدفك هذا الشهر:`,
    `<b>${sar(profit)} ريال صافي ربح على الأقل</b>`,
    "",
    done === null
      ? `يبدأ احتساب ما تحققه من 1 ${MONTHS[Number(month.slice(5)) - 1]}.`
      : `حققت حتى الآن: <b>${sar(done)}</b> ريال\n<code>${bar(done, profit)}</code>${done < profit ? `\nالباقي: <b>${sar(profit - done)}</b> ريال` : "\n✅ بلغت هدفك، استمر."}`,
    "",
    "اختير هذا الرقم لك بحسب أدائك، وكذلك عدد العملاء الذين يصلونك. هو الحد الأدنى المطلوب منك هذا الشهر، وكلما زاد عدد عملائك وتحسّن أداؤك ارتفع هدفك في الأشهر القادمة.",
  ].join("\n");
}

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** the plan's month, its sellers matched to employees, and each one's profit so far (null before the month starts) */
async function load(nowMs: number) {
  const { data } = await db().from("finance_book_versions").select("targets:book->targets").order("id", { ascending: false }).limit(1).maybeSingle();
  const plan = planMonth(((data as { targets?: Target[] | null } | null)?.targets ?? []) as Target[], nowMs);
  if (!plan) return null;
  const { data: people } = await db().from("employees").select("id, arabic_name").eq("status", "Active");
  const { matched, unmatched } = matchSellers(
    sellerTargets(plan.focus ?? ""),
    ((people ?? []) as { id: string; arabic_name: string }[]).map((p) => ({ id: p.id, name: p.arabic_name.trim() })),
  );
  let done: Map<string, { profit: number; noCost: boolean }> | null = null;
  if (plan.month === riyadhMonth(nowMs)) {
    const [cases, rates] = await Promise.all([loadCases(db()), getRates()]);
    const { employees } = commissionMonth(cases, plan.month, rates.sarPer);
    done = new Map(employees.map((e) => [e.employee_id, { profit: e.profit, noCost: e.files.some((f) => f.no_cost) }]));
  }
  return { month: plan.month, matched, unmatched, done };
}

const NO_PLAN = "🎯 <b>هدف المبيعات</b>\n\nلم تُحدَّد خطة هذا الشهر بعد.";
const TEAM: InlineButton = { text: "👥 أهداف الفريق", callback_data: "tg" };

export async function targetView(me: StaffMember, nowMs = Date.now()): Promise<{ text: string; buttons: InlineButton[][] }> {
  const [plan, manager] = await Promise.all([load(nowMs), isBotManager(me.id)]);
  if (!plan) return { text: NO_PLAN, buttons: manager ? [[TEAM]] : [] };
  const mine = plan.matched.find((m) => m.id === me.id);
  const done = plan.done ? (plan.done.get(me.id)?.profit ?? 0) : null;
  return { text: targetText(me.name.trim(), plan.month, mine?.profit ?? null, done), buttons: manager ? [[TEAM]] : [] };
}

/** «👥 أهداف الفريق» — managers only: what each seller must reach, and how far they are. */
export async function teamTargetsView(me: StaffMember, nowMs = Date.now()): Promise<{ text: string; buttons: InlineButton[][] }> {
  if (!(await isBotManager(me.id))) return { text: "هذا للإدارة فقط.", buttons: [] };
  const plan = await load(nowMs);
  if (!plan) return { text: NO_PLAN, buttons: [] };
  const done = (id: string) => plan.done?.get(id)?.profit ?? 0;
  const total = plan.matched.reduce((s, m) => s + m.profit, 0);
  const lines = [`🎯 <b>أهداف المبيعات — ${monthLabel(plan.month)}</b>`, "المطلوب من كل موظف (صافي ربح) وما حققه منه", ""];
  for (const m of plan.matched) {
    lines.push(`<b>${escapeHtml(m.name)}</b> — الهدف ${sar(m.profit)}`);
    if (plan.done) lines.push(`<code>${bar(done(m.id), m.profit)}</code> حقق ${sar(done(m.id))}${plan.done.get(m.id)?.noCost ? " ⚠️" : ""}`);
  }
  lines.push("", `المجموع: <b>${sar(total)}</b>${plan.done ? ` — تحقق ${sar(plan.matched.reduce((s, m) => s + done(m.id), 0))}` : ""}`);
  if (!plan.done) lines.push(`يبدأ احتساب ما يحققه كل موظف من 1 ${MONTHS[Number(plan.month.slice(5)) - 1]}.`);
  else lines.push("المحقق = ربح الملفات التي أكمل عميلها الدفع هذا الشهر (كما في «العمولات»). ⚠️ = فيه ملف بلا تكلفة مسجّلة، فربحه أعلى من الحقيقي.");
  if (plan.unmatched.length) lines.push(`أهداف في الخطة لا تخص موظفاً بعينه: ${plan.unmatched.map(escapeHtml).join("، ")}.`);
  return { text: lines.join("\n"), buttons: [[{ text: "🔄 تحديث", callback_data: "tg" }, { text: "↩️ الفريق", callback_data: "team" }]] };
}
