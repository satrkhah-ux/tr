import "server-only";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";
import { siteUrl } from "@/lib/telegram/ops-bot";
import { followupDb, followupRows } from "./service";
import { FOLLOWUP_SETTINGS_KEY, handlerOf, parseFollowupSettings, STEP_LABELS, todayGroup, WORK_COLS, type WorkRow } from "./rules";
import { followedMarks } from "@/lib/leads/lifecycle";
import { followedSince } from "@/lib/leads/lifecycle-rules";

/** the day a follow-up fell due (Riyadh), or the client's answer it waits on — a «@#@#@#» since then has followed it */
const dueSince = (r: WorkRow): number => {
  if (r.client_waiting) return Date.parse(r.last_client_at ?? "");
  const at = Date.parse(r.next_followup_at ?? r.created_at ?? "");
  return Number.isFinite(at) ? Date.parse(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(at)}T00:00:00+03:00`) : NaN;
};

/** «تنبيهاتي» for the follow-ups (owner order 4 D): each seller's files due today at 10:00 and 16:00 Riyadh. */
const HOURS = [10, 16];
const LAST_KEY = "followup_digest_last";

async function chats(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { data } = await followupDb().from("employees").select("id,telegram_chat_id").in("id", ids).eq("status", "Active").not("telegram_chat_id", "is", null);
  return new Map(((data ?? []) as { id: string; telegram_chat_id: number | string }[]).map((e) => [e.id, Number(e.telegram_chat_id)]));
}

/** The minute job: at 10:00 and 16:00, once (the slot claimed in app_settings), one message per seller into the «followups» slot. */
export async function followupDigest(nowMs = Date.now()): Promise<{ sent: number } | null> {
  const riyadh = new Date(nowMs + 3 * 3600_000);
  if (!HOURS.includes(riyadh.getUTCHours())) return null;
  const slot = `${riyadh.toISOString().slice(0, 10)}T${riyadh.getUTCHours()}`;
  const db = followupDb();
  const { data: last } = await db.from("app_settings").select("value").eq("key", LAST_KEY).maybeSingle();
  if (last?.value === slot) return null;
  // the claim: whoever moves the value from what it read sends; a second tick finds nothing to move
  const claim = last
    ? await db.from("app_settings").update({ value: slot, updated_at: new Date(nowMs).toISOString() }).eq("key", LAST_KEY).eq("value", last.value).select("key")
    : await db.from("app_settings").insert({ key: LAST_KEY, value: slot }).select("key");
  if (claim.error || !claim.data?.length) return null;
  const [{ data }, { data: setting }] = await Promise.all([
    followupRows((a, b) => db.from("sla_followups").select(WORK_COLS).eq("status", "open").order("id").range(a, b)),
    db.from("app_settings").select("value").eq("key", FOLLOWUP_SETTINGS_KEY).maybeSingle(),
  ]);
  const settings = parseFollowupSettings(setting?.value);
  const mine = new Map<string, WorkRow[]>();
  // «@#@#@#»: the employee followed it up since it fell due — not in the reminder (the owner, 2026-10-29)
  const marks = await followedMarks((data as WorkRow[]).map((r) => r.conversation_id));
  for (const r of data as WorkRow[]) {
    if (followedSince(marks.get(r.conversation_id), dueSince(r))) continue;
    const who = todayGroup(r, nowMs) ? handlerOf(r, settings) : null;
    if (who && who !== "managers") mine.set(who, [...(mine.get(who) ?? []), r]);
  }
  const chatOf = await chats([...mine.keys()]);
  let sent = 0;
  for (const [employee, rows] of mine) {
    const chat = chatOf.get(employee);
    if (!chat) continue;
    const order = { replied: 0, late: 1, due: 2 } as const;
    rows.sort((a, b) => order[todayGroup(a, nowMs)!] - order[todayGroup(b, nowMs)!]);
    const line = (r: WorkRow) => {
      const g = todayGroup(r, nowMs);
      return `• ${escapeHtml(r.contact_name || `#${r.conversation_id}`)} — ${g === "replied" ? "💬 رد وينتظرك" : `${r.step === null ? "تحويل" : STEP_LABELS[r.step]}${g === "late" ? " (متأخرة)" : ""}`}`;
    };
    const text = [`🔔 <b>متابعاتك اليوم: ${rows.length}</b>`, ...rows.slice(0, 15).map(line), ...(rows.length > 15 ? [`و${rows.length - 15} أخرى…`] : []), "", "مُراد جهّز لكل واحدة ملخصاً ورسالة مقترحة."].join("\n");
    if ((await staffSend(chat, text, [[{ text: "افتح المتابعة", url: `${siteUrl()}/followups` }]], {}, "followups")).ok) sent++;
  }
  return { sent };
}

/** At once when the client answers an offer's follow-up (the first message after ours), to the one who holds it. */
export async function alertReply(row: Pick<WorkRow, "id" | "contact_name" | "conversation_id" | "assigned_to" | "step" | "client_waiting">, text: string): Promise<void> {
  if (row.step === null || row.client_waiting || !row.assigned_to) return;
  const chat = (await chats([row.assigned_to])).get(row.assigned_to);
  if (!chat) return;
  const quote = text.trim() ? `\n«${escapeHtml(text.trim().slice(0, 200))}»` : "";
  await staffSend(chat, `💬 <b>${escapeHtml(row.contact_name || `#${row.conversation_id}`)}</b> رد على متابعة عرضه${quote}`, [[{ text: "افتح المتابعة", url: `${siteUrl()}/followups/${row.id}` }]], {}, `fu:${row.id}`);
}
