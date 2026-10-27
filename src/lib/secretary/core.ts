import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { myDay } from "@/lib/mine/day";
import { dayCounts, KIND_LABEL, type DayItem } from "@/lib/mine/rank";
import { HEAT_LABEL } from "@/lib/followups/summary-core";

/**
 * «سكرتيري الخاص» (the owner, 2026-10-24, order 2) — the data side: who the
 * signed-in employee is, and their OWN briefing. The day itself comes from
 * «متابعتي»'s read interface (mine/day.ts myDay — one ranking for the page,
 * the bot and the secretary), so nothing is computed twice and nothing of
 * anyone else's ever enters the briefing or the model's context.
 */

export type SecretaryEmployee = { id: string; name: string; agentId: number | null; chatId: number | null };

/** `suggest`: phase ج — the cheaper proposals' switch, the silence that triggers them, the day's cap, and WHERE prices come from (the owner, 2026-10-26: external official suppliers too, the employee verifies). */
export type SuggestSourceKey = "memory" | "tbo";
export type SecretarySettings = { off: boolean; dailyLimit: number; suggest: { on: boolean; silentHours: number; maxPerDay: number; proposals: number; sources: SuggestSourceKey[] } };
export const SECRETARY_SETTINGS_KEY = "secretary";

export const secretaryDb = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export function parseSecretarySettings(raw: string | null | undefined): SecretarySettings {
  // sources default to the company's own memory until the owner switches a supplier on («tbo» waits for their Search to work)
  const fallback: SecretarySettings = { off: false, dailyLimit: 60, suggest: { on: true, silentHours: 24, maxPerDay: 10, proposals: 2, sources: ["memory"] } };
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<SecretarySettings> & { suggest?: Partial<SecretarySettings["suggest"]> };
    const num = (x: unknown, d: number) => (Number.isFinite(x) && Number(x) > 0 ? Number(x) : d);
    const sources = Array.isArray(v.suggest?.sources) ? v.suggest.sources.filter((s): s is SuggestSourceKey => s === "memory" || s === "tbo") : [];
    return {
      off: v.off === true,
      dailyLimit: num(v.dailyLimit, fallback.dailyLimit),
      suggest: {
        on: v.suggest?.on !== false,
        silentHours: num(v.suggest?.silentHours, fallback.suggest.silentHours),
        maxPerDay: num(v.suggest?.maxPerDay, fallback.suggest.maxPerDay),
        proposals: Math.min(num(v.suggest?.proposals, fallback.suggest.proposals), 3),
        sources: sources.length ? sources : fallback.suggest.sources,
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

export type SecretaryBriefing = { items: DayItem[]; teletel: boolean };

/** Everything the secretary may know: this one employee's «عليّ اليوم» (mine/day.ts). */
export async function secretaryBriefing(employee: SecretaryEmployee, nowMs = Date.now()): Promise<SecretaryBriefing> {
  const day = await myDay(employee.id, nowMs);
  return { items: day?.items ?? [], teletel: day?.teletel ?? false };
}

const sinceText = (sinceMs: number | null, nowMs: number) => {
  if (!sinceMs) return "";
  const m = Math.max(1, Math.round((nowMs - sinceMs) / 60_000));
  return m < 120 ? `منذ ${m} دقيقة` : m < 48 * 60 ? `منذ ${Math.round(m / 60)} ساعة` : `منذ ${Math.round(m / (24 * 60))} يوماً`;
};

const itemLine = (i: DayItem, nowMs: number) => {
  const bits = [
    i.name || (i.conversationId ? `محادثة #${i.conversationId}` : "عميل"),
    `${KIND_LABEL[i.kind]}${i.tags.length ? ` (وأيضاً: ${i.tags.map((t) => KIND_LABEL[t]).join("، ")})` : ""}`,
    i.destination ? `وجهته: ${i.destination}` : "",
    i.heat ? `حرارته: ${HEAT_LABEL[i.heat]}` : "",
    i.wants ? `يريد: ${i.wants}` : "",
    i.since ? sinceText(i.since, nowMs) : "",
    i.advice ? `نصيحة مُراد: ${i.advice}` : "",
    i.reminder ? `تذكيرك: ${i.reminder.text}` : "",
    i.preview ? `آخر رسالة: ${i.preview.slice(0, 120)}` : "",
  ].filter(Boolean);
  return `- ${bits.join(" | ")}`;
};

/** The briefing as Arabic text for the model's context (and nothing else in it). */
export function renderBriefing(employee: SecretaryEmployee, b: SecretaryBriefing, nowMs = Date.now()): string {
  const day = new Date(nowMs).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "full", timeStyle: "short" });
  return [
    `الموظف: ${employee.name || "غير مسمّى"} — الآن: ${day} (توقيت الرياض)`,
    "",
    `قائمة «عليّ اليوم» (${b.items.length})، مرتبة بالأولوية:`,
    ...(b.items.length ? b.items.slice(0, 30).map((i) => itemLine(i, nowMs)) : ["(لا شيء مستحق الآن)"]),
    ...(b.teletel ? [] : ["", "تنبيه: تعذّرت قراءة محادثات تيلي تيل الآن — القائمة تشمل متابعات العروض والتذكيرات فقط."]),
  ].join("\n");
}

/**
 * The day plan as ONE SHORT line of numbers (the owner, 2026-10-26: «هذه
 * الرسالة أنا لا أحتاج هكذا … أريدها أداة») — the tool itself is the board on
 * /secretary and in مُراد's floating panel; this text only points at it.
 */
export function planText(employee: SecretaryEmployee, b: SecretaryBriefing, nowMs = Date.now()): string {
  void nowMs;
  const c = dayCounts(b.items);
  const parts = [
    c.hot ? `🔥 ${c.hot} ساخن` : "",
    c.waiting ? `💬 ${c.waiting} ينتظر ردك` : "",
    c.offer ? `📋 ${c.offer} متابعة عرض` : "",
    c.reminder ? `⏰ ${c.reminder} تذكير` : "",
    c.silent ? `🤐 ${c.silent} ساكت` : "",
  ].filter(Boolean);
  const hot = b.items.filter((i) => i.heat === "hot").slice(0, 3).map((i) => i.name).filter(Boolean);
  return [
    `صباح الخير${employee.name ? ` يا ${employee.name}` : ""} 🌤️`,
    parts.length ? parts.join(" · ") : "لا شيء مستحق عليك الآن — يوم هادئ ✅",
    ...(hot.length ? [`ابدأ بالساخنين: ${hot.join("، ")}`] : []),
    ...(b.teletel ? [] : ["(تعذّرت قراءة تيلي تيل — القائمة قد تنقص المحادثات المنتظرة)"]),
    "افتح «خطتي» من زر مُراد العائم أو قسم «سكرتيري الخاص».",
  ].join("\n");
}
