import "server-only";
import { MONTHS } from "@/lib/finance/model";
import { salesCardFor, teamSalesTargets, type MySalesCard } from "@/lib/data/commissions";
import { escapeHtml, type StaffMember } from "./staff-bot";
import { isBotManager } from "./staff-manager";
import type { InlineButton } from "./ops-bot";

/**
 * «🎯 هدفي» — the same monthly sales target and figures as the home card and «العمولات»
 * (the owner, 2026-10-30: one number everywhere, chose «أ»). The target is the one the
 * management types in «العمولات ← أهداف المبيعات»; a file counts in the month its client
 * finished paying. An employee sees their own; the bot's managers also see the team.
 */

export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const sar = (n: number) => Math.round(n).toLocaleString("en-US");

/** ten cells and the share, e.g. «▓▓▓▓░░░░░░ 38%» (past 100% the bar stays full, the share says how far) */
export function bar(done: number, target: number): string {
  const pct = target > 0 ? Math.max(0, Math.round((done / target) * 100)) : 0;
  const cells = Math.min(10, Math.floor(pct / 10));
  return `${"▓".repeat(cells)}${"░".repeat(10 - cells)} ${pct}%`;
}

export function targetText(name: string, c: MySalesCard): string {
  const lines = [
    `🎯 <b>هدف المبيعات — ${monthLabel(c.month)}</b>`,
    "",
    `${escapeHtml(name)}، مبيعاتك هذا الشهر: <b>${sar(c.sales)}</b> ريال`,
    `عملاء مؤكدون: <b>${c.clients}</b> · عمولتك${c.frozen ? "" : " التقديرية"}: <b>${sar(c.commission)}</b> ريال`,
    "",
  ];
  if (c.target && c.progress) {
    lines.push(`هدفك: <b>${sar(c.target)}</b> ريال`, `<code>${bar(c.sales, c.target)}</code>`);
    lines.push(c.progress.left > 0 ? `الباقي: <b>${sar(c.progress.left)}</b> ريال في ${c.daysLeft} يوماً` : "✅ بلغت هدفك، استمر.");
  } else lines.push("لم تحدد الإدارة لك هدفاً لهذا الشهر بعد.");
  lines.push("", "يُحسب العميل في الشهر الذي أكمل فيه الدفع، كما في «العمولات». اسأل مُراد في النظام: «كيف أصل إلى هدفي؟»");
  return lines.join("\n");
}

const TEAM: InlineButton = { text: "👥 أهداف الفريق", callback_data: "tg" };

export async function targetView(me: StaffMember, nowMs = Date.now()): Promise<{ text: string; buttons: InlineButton[][] }> {
  const [card, manager] = await Promise.all([salesCardFor(me.id, nowMs), isBotManager(me.id)]);
  return { text: targetText(me.name.trim(), card), buttons: manager ? [[TEAM]] : [] };
}

/** «👥 أهداف الفريق» — managers only: each employee's target and how far they are. */
export async function teamTargetsView(me: StaffMember): Promise<{ text: string; buttons: InlineButton[][] }> {
  if (!(await isBotManager(me.id))) return { text: "هذا للإدارة فقط.", buttons: [] };
  const { month, rows } = await teamSalesTargets();
  const lines = [`🎯 <b>أهداف المبيعات — ${monthLabel(month)}</b>`, "هدف كل موظف (مبيعات) وما حققه منه", ""];
  if (!rows.length) lines.push("لم تُدخل أهداف بعد — من «العمولات ← أهداف المبيعات» في النظام.");
  for (const r of rows) lines.push(`<b>${escapeHtml(r.name)}</b> — الهدف ${sar(r.target)}`, `<code>${bar(r.sales, r.target)}</code> حقق ${sar(r.sales)}`);
  if (rows.length) {
    const t = rows.reduce((s, r) => s + r.target, 0);
    const d = rows.reduce((s, r) => s + r.sales, 0);
    lines.push("", `المجموع: <b>${sar(t)}</b> — تحقق ${sar(d)}`, "المحقق = مبيعات الملفات التي أكمل عميلها الدفع هذا الشهر (كما في «العمولات»).");
  }
  return { text: lines.join("\n"), buttons: [[{ text: "🔄 تحديث", callback_data: "tg" }, { text: "↩️ الفريق", callback_data: "team" }]] };
}
