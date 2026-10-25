import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { teletelConversationUrl, teletelGet } from "@/lib/providers/teletel";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";
import { siteUrl } from "@/lib/telegram/ops-bot";
import { followupPeople } from "@/lib/followups/service";
import { loadSettings, myDay } from "./day";
import { dayCounts, KIND_LABEL, KIND_ORDER, quiet } from "./rank";

/**
 * «متابعتي» in «تنبيهاتي» (the owner, 2026-10-25: «تذكيرات دائمة»), for the
 * employee alone — never a manager, never the client:
 *   - the day's list, once a day, the first time they are online outside their quiet hours
 *   - «ذكّرني» when it comes due (once: notified_at)
 * The waiting client's «⏰ ينتظر ردك» stays where it was (staff-screen remindWaiting),
 * now on each employee's own minutes and quiet hours, and sooner for a hot client.
 * Nothing goes to anyone «غير متصل».
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const WINDOW_MS = 2 * 60_000;

/**
 * Teletel agents who are online now: their system open (presence) or «متصل» in
 * Teletel. null = Teletel unreadable: nobody is silenced for our failure.
 */
export async function onlineAgents(): Promise<Set<number> | null> {
  const [agents, seen] = await Promise.all([
    teletelGet<{ id?: number; availability_status?: string | null }[]>("/agents"),
    db().from("presence").select("employee_id").gte("last_seen_at", new Date(Date.now() - WINDOW_MS).toISOString()),
  ]);
  if (!agents) return null;
  const ids = ((seen.data ?? []) as { employee_id: string }[]).map((r) => r.employee_id);
  const { data: emps } = ids.length ? await db().from("employees").select("teletel_agent_id").in("id", ids).not("teletel_agent_id", "is", null) : { data: [] };
  return new Set([
    ...agents.filter((a) => typeof a.id === "number" && a.availability_status === "online").map((a) => a.id as number),
    ...((emps ?? []) as { teletel_agent_id: number | string }[]).map((e) => Number(e.teletel_agent_id)),
  ]);
}

const riyadhDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(ms);
const OPEN_MINE = () => [[{ text: "📋 افتح متابعتي", url: `${siteUrl()}/my-followups` }]];

/** The minute job's share, every fifth minute. */
export async function mineTick(nowMs = Date.now()): Promise<{ days: number; reminders: number } | null> {
  if (Math.floor(nowMs / 60_000) % 5 !== 3) return null;
  const sellers = (await followupPeople()).filter((p) => p.seller);
  if (!sellers.length) return { days: 0, reminders: 0 };
  const { data } = await db().from("employees").select("id,arabic_name,telegram_chat_id").in("id", sellers.map((s) => s.id)).not("telegram_chat_id", "is", null);
  const people = ((data ?? []) as { id: string; arabic_name: string; telegram_chat_id: number | string }[]).map((e) => ({ ...e, chat: Number(e.telegram_chat_id), agent: sellers.find((s) => s.id === e.id)?.agentId ?? null }));
  const online = await onlineAgents();
  const today = riyadhDay(nowMs);
  let days = 0;
  let reminders = 0;

  for (const p of people) {
    if (!p.chat || (online && !(p.agent && online.has(p.agent)))) continue;
    const settings = await loadSettings(p.id);
    if (quiet(settings, nowMs)) continue;

    // «ذكّرني» that came due: claimed once, then said
    const { data: due } = await db().from("my_followup_reminders").select("id,conversation_id,text,due_at").eq("employee_id", p.id).is("done_at", null).is("notified_at", null).lte("due_at", new Date(nowMs).toISOString());
    for (const r of (due ?? []) as { id: number; conversation_id: number | null; text: string }[]) {
      const { data: claimed } = await db().from("my_followup_reminders").update({ notified_at: new Date(nowMs).toISOString() }).eq("id", r.id).is("notified_at", null).select("id");
      if (!claimed?.length) continue;
      const url = r.conversation_id ? teletelConversationUrl(Number(r.conversation_id)) : null;
      const text = [`⏰ <b>تذكير طلبته</b>`, r.text ? escapeHtml(r.text) : `العميل في المحادثة #${r.conversation_id}`].join("\n");
      const buttons = [...(url ? [[{ text: "💬 افتح في تيلي تيل", url }]] : []), ...OPEN_MINE()];
      if ((await staffSend(p.chat, text, buttons, {}, `mine:r:${r.id}`)).ok) reminders += 1;
    }

    // the day's list, once: the first tick they are online today outside the quiet hours
    const { data: first } = await db().from("my_followup_marks").upsert({ employee_id: p.id, key: `day:${today}`, pinged_at: new Date(nowMs).toISOString() }, { onConflict: "employee_id,key", ignoreDuplicates: true }).select("key");
    if (!first?.length) continue;
    const day = await myDay(p.id, nowMs);
    if (!day) continue;
    const c = dayCounts(day.items);
    const lines = [
      `👋 <b>أهلاً ${escapeHtml(p.arabic_name.trim())}</b> — هذا ما عليك اليوم في «متابعتي»`,
      "",
      c.total ? KIND_ORDER.filter((k) => c[k]).map((k) => `• ${KIND_LABEL[k]}: <b>${c[k]}</b>`).join("\n") : "لا شيء عليك الآن 👏",
      ...(c.total ? ["", "<b>ابدأ بهؤلاء:</b>", ...day.items.slice(0, 5).map((i) => `${i.heat === "hot" ? "🔥" : "▫️"} ${escapeHtml(i.name)} — ${KIND_LABEL[i.kind]}`)] : []),
    ];
    if ((await staffSend(p.chat, lines.join("\n"), OPEN_MINE(), {}, "mine:day")).ok) days += 1;
  }
  return { days, reminders };
}
