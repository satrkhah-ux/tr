import "server-only";
import { logAudit } from "@/lib/data/audit";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";
import { siteUrl } from "@/lib/telegram/ops-bot";
import { dayCounts } from "@/lib/mine/rank";
import { planText, secretaryBriefing, secretaryDb, secretarySettings, type SecretaryEmployee } from "./core";

/**
 * «سكرتيري الخاص» — the day plan on the minute job (api/murad/run): an employee
 * whose presence beat today (first open of the system) and who has no plan
 * message today gets one, in the thread and on «تنبيهاتي». The plan is
 * deterministic (core.ts planText) — no model, so no cost and nothing invented.
 */

const PRESENCE_WINDOW_MS = 2 * 60_000;
const PER_RUN = 3; // each plan reads the open list once; the minute job must stay light

export async function sweepSecretaryPlans(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const db = secretaryDb();
  const settings = await secretarySettings(db);
  if (settings.off) return { off: true };

  const dayStart = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(nowMs) + "T00:00:00+03:00").toISOString();
  const cut = new Date(nowMs - PRESENCE_WINDOW_MS).toISOString();
  const { data: beats } = await db.from("presence").select("employee_id").gte("last_seen_at", cut);
  const online = [...new Set(((beats ?? []) as { employee_id: string }[]).map((b) => b.employee_id))];
  if (!online.length) return { online: 0 };

  const [{ data: planned, error: plannedError }, { data: emps }] = await Promise.all([
    db.from("secretary_messages").select("employee_id").eq("role", "plan").gte("created_at", dayStart).in("employee_id", online),
    db.from("employees").select("id, arabic_name, teletel_agent_id, telegram_chat_id").in("id", online).eq("status", "Active"),
  ]);
  if (plannedError) return { error: "table_missing" };
  const done = new Set(((planned ?? []) as { employee_id: string }[]).map((p) => p.employee_id));
  const due = ((emps ?? []) as { id: string; arabic_name: string | null; teletel_agent_id: number | string | null; telegram_chat_id: number | string | null }[])
    .filter((e) => !done.has(e.id))
    .slice(0, PER_RUN);

  let sent = 0;
  for (const e of due) {
    const employee: SecretaryEmployee = {
      id: e.id,
      name: e.arabic_name ?? "",
      agentId: e.teletel_agent_id == null ? null : Number(e.teletel_agent_id),
      chatId: e.telegram_chat_id == null ? null : Number(e.telegram_chat_id),
    };
    const briefing = await secretaryBriefing(employee, nowMs).catch(() => null);
    if (!briefing) continue;
    const text = planText(employee, briefing, nowMs);
    // the row FIRST: it is the once-a-day claim, so a failed Telegram send never repeats the plan
    const { error } = await db.from("secretary_messages").insert({ employee_id: e.id, role: "plan", content: text });
    if (error) continue;
    if (employee.chatId) {
      await staffSend(employee.chatId, `🗂 <b>خطة يومك من مُراد</b>\n\n${escapeHtml(text)}`, [[{ text: "افتح خطتي", url: `${siteUrl()}/secretary` }]], {}, "secretary").catch(() => null);
    }
    await logAudit({ action: "secretary.plan_sent", entity: "secretary_messages", entity_id: e.id, meta: dayCounts(briefing.items) });
    sent++;
  }
  return { online: online.length, sent };
}
