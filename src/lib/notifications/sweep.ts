import "server-only";
import { myDay } from "@/lib/mine/day";
import { secretaryDb, secretarySettings } from "@/lib/secretary/core";
import { dedupeKeys } from "./core";
import { notifyEmployee } from "./notify";
import { followedMarks } from "@/lib/leads/lifecycle";
import { followedSince } from "@/lib/leads/lifecycle-rules";

/**
 * The notification sweep on the minute job: for every employee whose system is
 * open RIGHT NOW (presence, same window as the day plan), what «متابعتي» ranks
 * for them becomes notifications — a due «ذكّرني», a client newly waiting, a
 * hot client untouched today, a due offer follow-up. The dedupe keys
 * (core.ts) make every event land once however many minutes this runs.
 */

const PRESENCE_WINDOW_MS = 2 * 60_000;
const EMPLOYEES_PER_RUN = 8;
const riyadhDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(ms);

export async function sweepNotifications(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const db = secretaryDb();
  const settings = await secretarySettings(db);
  if (settings.off) return { off: true };

  const cut = new Date(nowMs - PRESENCE_WINDOW_MS).toISOString();
  const { data: beats } = await db.from("presence").select("employee_id").gte("last_seen_at", cut);
  const online = [...new Set(((beats ?? []) as { employee_id: string }[]).map((b) => b.employee_id))].slice(0, EMPLOYEES_PER_RUN);
  if (!online.length) return { online: 0 };

  let created = 0;
  const today = riyadhDay(nowMs);
  const dayStart = Date.parse(`${today}T00:00:00+03:00`);
  for (const employeeId of online) {
    const day = await myDay(employeeId, nowMs).catch(() => null);
    if (!day) continue;
    // «@#@#@#»: the employee followed the conversation up — no reminder about it (the owner, 2026-10-29); their own «ذكّرني» stays
    const marks = await followedMarks(day.items.map((i) => i.conversationId ?? 0));
    for (const i of day.items.slice(0, 12)) {
      if (i.kind !== "reminder" && i.conversationId && followedSince(marks.get(i.conversationId), i.kind === "waiting" && i.since ? i.since : dayStart)) continue;
      const base = { employeeId, source: "secretary", href: "/secretary" as const };
      const name = i.name || (i.conversationId ? `عميل #${i.conversationId}` : "عميل");
      const r =
        i.kind === "reminder" && i.reminder
          ? await notifyEmployee({ ...base, kind: "reminder", dedupeKey: dedupeKeys.reminder(i.reminder.id), title: `⏰ ${i.reminder.text || name}`, body: i.conversationId ? name : "" })
          : i.kind === "waiting" && i.conversationId && i.since
            ? await notifyEmployee({ ...base, kind: "waiting", dedupeKey: dedupeKeys.waiting(i.conversationId, Math.floor(i.since / 1000)), title: `💬 ${name} ينتظر ردك`, body: i.preview?.slice(0, 180) ?? "" })
            : i.kind === "hot" && i.conversationId
              ? await notifyEmployee({ ...base, kind: "hot", dedupeKey: dedupeKeys.hot(i.conversationId, today), title: `🔥 ${name} ساخن ولم تكلمه اليوم`, body: i.wants?.slice(0, 180) ?? "" })
              : i.kind === "offer" && i.followupId
                ? await notifyEmployee({ ...base, kind: "offer_due", dedupeKey: dedupeKeys.offerDue(i.followupId, i.step), title: `📋 متابعة عرض ${name} مستحقة`, body: i.advice?.slice(0, 180) ?? "", href: `/followups/${i.followupId}` })
                : null;
      if (r?.created) created += r.created;
    }
  }
  return { online: online.length, created };
}
