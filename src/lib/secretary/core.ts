import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { listOpenConversations, type OpenConversation } from "@/lib/providers/teletel";
import { followupRows } from "@/lib/followups/service";
import { FOLLOWUP_SETTINGS_KEY, handlerOf, parseFollowupSettings, STEP_LABELS, todayGroup, WORK_COLS, type WorkRow } from "@/lib/followups/rules";
import { HEAT_LABEL } from "@/lib/followups/summary-core";

/**
 * «سكرتيري الخاص» (the owner, 2026-10-24, order 2) — the data side: who the
 * signed-in employee is, and their OWN briefing (their follow-ups, their open
 * Teletel conversations, who is hot, what is due today). Nothing of anyone
 * else's ever enters the briefing or the model's context.
 */

export type SecretaryEmployee = { id: string; name: string; agentId: number | null; chatId: number | null };

/** `suggest`: phase ج — the cheaper proposals' switch, the silence that triggers them, and the day's cap. */
export type SecretarySettings = { off: boolean; dailyLimit: number; suggest: { on: boolean; silentHours: number; maxPerDay: number; proposals: number } };
export const SECRETARY_SETTINGS_KEY = "secretary";

export const secretaryDb = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export function parseSecretarySettings(raw: string | null | undefined): SecretarySettings {
  const fallback: SecretarySettings = { off: false, dailyLimit: 60, suggest: { on: true, silentHours: 24, maxPerDay: 10, proposals: 2 } };
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<SecretarySettings> & { suggest?: Partial<SecretarySettings["suggest"]> };
    const num = (x: unknown, d: number) => (Number.isFinite(x) && Number(x) > 0 ? Number(x) : d);
    return {
      off: v.off === true,
      dailyLimit: num(v.dailyLimit, fallback.dailyLimit),
      suggest: {
        on: v.suggest?.on !== false,
        silentHours: num(v.suggest?.silentHours, fallback.suggest.silentHours),
        maxPerDay: num(v.suggest?.maxPerDay, fallback.suggest.maxPerDay),
        proposals: Math.min(num(v.suggest?.proposals, fallback.suggest.proposals), 3),
      },
    };
  } catch { return fallback; }
}

export async function secretarySettings(db: SupabaseClient): Promise<SecretarySettings> {
  const { data } = await db.from("app_settings").select("value").eq("key", SECRETARY_SETTINGS_KEY).maybeSingle();
  return parseSecretarySettings((data as { value?: string } | null)?.value);
}

/** The signed-in employee, or null (not signed in / no employee row). */
export async function currentSecretaryEmployee(): Promise<SecretaryEmployee | null> {
  const user = await getServerUser();
  if (!user) return null;
  const { data } = await secretaryDb()
    .from("employees")
    .select("id, arabic_name, teletel_agent_id, telegram_chat_id")
    .eq("auth_user_id", user.id)
    .eq("status", "Active")
    .maybeSingle();
  const e = data as { id: string; arabic_name: string | null; teletel_agent_id: number | string | null; telegram_chat_id: number | string | null } | null;
  if (!e) return null;
  return {
    id: e.id,
    name: e.arabic_name ?? "",
    agentId: e.teletel_agent_id == null ? null : Number(e.teletel_agent_id),
    chatId: e.telegram_chat_id == null ? null : Number(e.telegram_chat_id),
  };
}

export type SecretaryBriefing = {
  followups: WorkRow[];
  dueToday: WorkRow[];
  hot: WorkRow[];
  clientWaiting: WorkRow[];
  /** the employee's own open Teletel conversations, the waiting ones first */
  conversations: Pick<OpenConversation, "id" | "name" | "waitingSince" | "preview" | "serviceType">[];
};

/** Everything the secretary may know: this one employee's files and conversations. */
export async function secretaryBriefing(db: SupabaseClient, employee: SecretaryEmployee, nowMs = Date.now()): Promise<SecretaryBriefing> {
  const [{ data: rows }, { data: setting }, open] = await Promise.all([
    followupRows<WorkRow>((a, b) => db.from("sla_followups").select(WORK_COLS).eq("status", "open").order("id").range(a, b)),
    db.from("app_settings").select("value").eq("key", FOLLOWUP_SETTINGS_KEY).maybeSingle(),
    listOpenConversations().catch(() => null),
  ]);
  const settings = parseFollowupSettings((setting as { value?: string } | null)?.value);
  const mine = rows.filter((r) => handlerOf(r, settings) === employee.id);
  const conversations = (open?.rows ?? [])
    .filter((c) => c.assigneeId != null && c.assigneeId === employee.agentId)
    .sort((a, b) => b.waitingSince - a.waitingSince)
    .slice(0, 30)
    .map((c) => ({ id: c.id, name: c.name, waitingSince: c.waitingSince, preview: c.preview, serviceType: c.serviceType }));
  return {
    followups: mine,
    dueToday: mine.filter((r) => todayGroup(r, nowMs) !== null),
    hot: mine.filter((r) => r.summary?.heat === "hot"),
    clientWaiting: mine.filter((r) => r.client_waiting),
    conversations,
  };
}

const waitedText = (sinceUnix: number, nowMs: number) => {
  if (!sinceUnix) return "";
  const m = Math.max(1, Math.round((nowMs / 1000 - sinceUnix) / 60));
  return m < 120 ? `ينتظر ${m} دقيقة` : `ينتظر ${Math.round(m / 60)} ساعة`;
};

const fuLine = (r: WorkRow, nowMs: number) => {
  const s = r.summary;
  const bits = [
    r.contact_name || `محادثة #${r.conversation_id}`,
    r.destination ? `وجهته: ${r.destination}` : "",
    r.step !== null ? `خطوة المتابعة: ${STEP_LABELS[r.step] ?? r.step}` : "",
    s ? `حرارته: ${HEAT_LABEL[s.heat]}` : "",
    r.client_waiting ? "العميل رد وينتظرك" : "",
    todayGroup(r, nowMs) ? "مستحقة اليوم" : "",
    s?.stopped ? `أين توقفت: ${s.stopped}` : "",
    s?.advice ? `نصيحة مُراد: ${s.advice}` : "",
  ].filter(Boolean);
  return `- ${bits.join(" | ")}`;
};

/** The briefing as Arabic text for the model's context (and nothing else in it). */
export function renderBriefing(employee: SecretaryEmployee, b: SecretaryBriefing, nowMs = Date.now()): string {
  const day = new Date(nowMs).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "full", timeStyle: "short" });
  return [
    `الموظف: ${employee.name || "غير مسمّى"} — الآن: ${day} (توقيت الرياض)`,
    "",
    `ملفات المتابعة المفتوحة (${b.followups.length})، منها مستحقة اليوم ${b.dueToday.length} وساخنة ${b.hot.length} وعملاء ردوا وينتظرون ${b.clientWaiting.length}:`,
    ...(b.followups.length ? b.followups.slice(0, 25).map((r) => fuLine(r, nowMs)) : ["(لا ملفات متابعة مفتوحة)"]),
    "",
    `محادثاته المفتوحة في تيلي تيل (${b.conversations.length}):`,
    ...(b.conversations.length
      ? b.conversations.slice(0, 20).map((c) => `- ${c.name || `#${c.id}`}${c.serviceType ? ` (${c.serviceType})` : ""}${c.waitingSince ? ` — ${waitedText(c.waitingSince, nowMs)}` : " — الرد الأخير منا"}${c.preview ? ` — آخر رسالة: ${c.preview.slice(0, 120)}` : ""}`)
      : ["(لا محادثات مفتوحة)"]),
  ].join("\n");
}

/** The day plan, deterministic (no model): what is due, who is hot, who waits. */
export function planText(employee: SecretaryEmployee, b: SecretaryBriefing, nowMs = Date.now()): string {
  const name = (r: WorkRow) => r.contact_name || `محادثة #${r.conversation_id}`;
  const lines: string[] = [`صباح الخير${employee.name ? ` يا ${employee.name}` : ""} 🌤️ — خطة يومك:`];
  if (b.clientWaiting.length) lines.push("", `💬 عملاء ردوا وينتظرونك (${b.clientWaiting.length}):`, ...b.clientWaiting.slice(0, 8).map((r) => `• ${name(r)}`));
  const hotIds = new Set(b.hot.map((r) => r.id));
  if (b.hot.length) lines.push("", `🔥 عملاء ساخنون — كلّمهم أولاً (${b.hot.length}):`, ...b.hot.slice(0, 8).map((r) => `• ${name(r)}${r.summary?.heat_why ? ` — ${r.summary.heat_why}` : ""}`));
  const due = b.dueToday.filter((r) => !hotIds.has(r.id) && !r.client_waiting);
  if (due.length) lines.push("", `📋 متابعات مستحقة اليوم (${due.length}):`, ...due.slice(0, 10).map((r) => `• ${name(r)}${r.step !== null ? ` — ${STEP_LABELS[r.step] ?? ""}` : ""}`));
  const waiting = b.conversations.filter((c) => c.waitingSince > 0);
  if (waiting.length) lines.push("", `⏳ محادثات تنتظر ردك الآن (${waiting.length}):`, ...waiting.slice(0, 8).map((c) => `• ${c.name || `#${c.id}`} — ${waitedText(c.waitingSince, nowMs)}`));
  if (lines.length === 1) lines.push("", "لا شيء مستحق عليك الآن — يوم هادئ. ✅");
  lines.push("", "اسألني أي وقت: «ما حال محادثاتي؟» أو «من الساخن؟»");
  return lines.join("\n");
}
