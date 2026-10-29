import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { mineTick } from "@/lib/mine/remind";
import { closeExpiredStatuses } from "@/lib/presence/sweep";
import { listOpenConversations, teletelConversationUrl } from "@/lib/providers/teletel";
import { clearSlot, escapeHtml, staffForAgent, staffSend } from "./staff-bot";
import type { InlineButton } from "./ops-bot";
import { sendDailyReports } from "./staff-report";
import { refreshScreens, remindWaiting } from "./staff-screen";
import { pushDecisions } from "./staff-decisions";
import { lettersTick } from "./staff-letters";
import { forwardClientMessage, onMessageUpdated, refreshDeliveries, rememberThread, type TeletelMessageEvent } from "./staff-replies";

/**
 * «تنبيهاتي»: a conversation assigned to an employee in Teletel reaches their
 * Telegram once.
 *
 * Two sources feed one claim (staff_bot_claim_assignment):
 *   - Teletel's webhook: conversation_created with an assignee, and
 *     conversation_updated whose changed attributes include assignee_id. It is
 *     instant.
 *   - the minute sweep over the open conversations. It catches what the webhook
 *     missed: a webhook that is not ticked yet, a deploy, a dropped call.
 * Whichever sees the change first gets the claim, and the other one is silent.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type Announced = { id: number; name: string; phone: string; team: string | null; preview: string };

/** What a Teletel webhook body carries for a conversation event (Chatwoot conversation.webhook_data). */
export type TeletelEvent = {
  event?: string;
  id?: number;
  changed_attributes?: unknown;
  content?: string | null;
  created_at?: number | string;
  messages?: { content?: string | null }[];
  last_non_activity_message?: { content?: string | null } | null;
  meta?: {
    sender?: { name?: string | null; phone_number?: string | null } | null;
    assignee?: { id?: number } | null;
    team?: { name?: string | null } | null;
  } | null;
};

/** Every Teletel webhook event goes through here: assignments, the client's messages (forwarded), and our replies' WhatsApp status. */
export async function staffOnTeletel(body: TeletelEvent): Promise<void> {
  if (body.event === "message_created") return forwardClientMessage(body as TeletelMessageEvent);
  if (body.event === "message_updated") return onMessageUpdated(body as TeletelMessageEvent);
  if (body.event !== "conversation_created" && body.event !== "conversation_updated") return;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return;
  const agent = typeof body.meta?.assignee?.id === "number" ? body.meta.assignee.id : null;
  // a label or a status changing is not an assignment: the state moves, nobody is told
  const moved = body.event === "conversation_created" || JSON.stringify(body.changed_attributes ?? "").includes("assignee_id");
  const preview = body.last_non_activity_message?.content ?? body.messages?.at(-1)?.content ?? "";
  await claimAndAnnounce(id, agent, "webhook", moved, {
    id,
    name: body.meta?.sender?.name?.trim() || body.meta?.sender?.phone_number || `#${id}`,
    phone: body.meta?.sender?.phone_number ?? "",
    team: body.meta?.team?.name ?? null,
    preview: preview ?? "",
  });
}

async function claimAndAnnounce(conversationId: number, agent: number | null, source: "webhook" | "sweep", announce: boolean, card: Announced): Promise<boolean> {
  const { data, error } = await db().rpc("staff_bot_claim_assignment", {
    p_conversation: conversationId,
    p_agent: agent,
    p_source: source,
    p_announce: announce && agent !== null,
  });
  if (error || data !== true || agent === null) return false;
  const member = await staffForAgent(agent);
  if (!member) return false;
  const sent = await staffSend(member.chatId, assignmentText(card), assignmentButtons(conversationId), {}, `conv:${conversationId}`);
  if (sent.ok) await rememberThread(member.chatId, sent.messageId, conversationId);
  return sent.ok;
}

export function assignmentText(c: Announced): string {
  return [
    "📥 <b>محادثة أُسندت إليك</b>",
    "",
    `👤 <b>${escapeHtml(c.name)}</b>${c.phone ? ` · <code>${escapeHtml(c.phone)}</code>` : ""}`,
    c.team ? `🏷️ ${escapeHtml(c.team)}` : null,
    c.preview.trim() ? `💬 «${escapeHtml(c.preview.trim().slice(0, 220))}»` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function assignmentButtons(conversationId: number): InlineButton[][] {
  const url = teletelConversationUrl(conversationId);
  return [
    [{ text: "✍️ رد", callback_data: `r:${conversationId}` }, { text: "📄 آخر الرسائل", callback_data: `c:${conversationId}` }],
    ...(url ? [[{ text: "💬 افتح في تيلي تيل", url }]] : []),
  ];
}

/**
 * The minute sweep. It compares the open list against what we last saw.
 *
 *   - First run (an empty table): everything is recorded silently. The open
 *     conversations of yesterday are not news.
 *   - A known conversation with a different assignee is a transfer: announced.
 *   - An unknown conversation is new if it began within two hours, and is then
 *     announced. An old one is simply reopening and is recorded silently.
 *   - A row whose state changed AFTER the list was read is skipped, because the
 *     webhook got there first and the list is the older of the two.
 */
export async function staffSweep(): Promise<{ seen: number; announced: number; baseline?: number }> {
  const list = await listOpenConversations();
  if (!list) return { seen: 0, announced: 0 };
  const rows = list.rows;

  const { count } = await db().from("staff_bot_conversations").select("conversation_id", { count: "exact", head: true });
  if (!count) {
    for (let i = 0; i < rows.length; i += 500) {
      await db()
        .from("staff_bot_conversations")
        .upsert(rows.slice(i, i + 500).map((r) => ({ conversation_id: r.id, assignee_id: r.assigneeId })), { onConflict: "conversation_id", ignoreDuplicates: true });
    }
    return { seen: rows.length, announced: 0, baseline: rows.length };
  }

  const known = new Map<number, { assignee: number | null; at: number }>();
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await db()
      .from("staff_bot_conversations")
      .select("conversation_id, assignee_id, updated_at")
      .in("conversation_id", rows.slice(i, i + 200).map((r) => r.id));
    for (const s of (data ?? []) as { conversation_id: number; assignee_id: number | null; updated_at: string }[]) {
      known.set(s.conversation_id, { assignee: s.assignee_id, at: Date.parse(s.updated_at) });
    }
  }

  const nowSec = Date.now() / 1000;
  let announced = 0;
  for (const r of rows) {
    const before = known.get(r.id);
    if (before && (before.assignee === r.assigneeId || before.at > list.at)) continue;
    const announce = before ? true : nowSec - r.createdAt < 2 * 3600;
    const card = { id: r.id, name: r.name, phone: r.phone, team: r.team, preview: r.preview };
    if (await claimAndAnnounce(r.id, r.assigneeId, "sweep", announce, card)) announced += 1;
  }
  return { seen: rows.length, announced };
}

/**
 * A client's message leaves the chat once their conversation is closed or is no
 * longer this employee's. Judged against the open list as it was read: a
 * message posted after that read (a fresh assignment) waits for the next one.
 */
export async function dropGone(): Promise<number> {
  const { data } = await db().from("staff_bot_slots").select("chat_id, slot, created_at").like("slot", "conv:%");
  const slots = (data ?? []) as { chat_id: number | string; slot: string; created_at: string }[];
  if (!slots.length) return 0;
  const list = await listOpenConversations();
  if (!list) return 0;
  const assignee = new Map(list.rows.map((r) => [r.id, r.assigneeId]));
  const { data: people } = await db().from("employees").select("telegram_chat_id, teletel_agent_id").not("telegram_chat_id", "is", null);
  const agentOf = new Map(((people ?? []) as { telegram_chat_id: number | string; teletel_agent_id: number | null }[]).map((p) => [Number(p.telegram_chat_id), p.teletel_agent_id]));
  const newest = new Map<string, number>();
  for (const s of slots) {
    const key = `${s.chat_id}|${s.slot}`;
    newest.set(key, Math.max(newest.get(key) ?? 0, Date.parse(s.created_at)));
  }
  let dropped = 0;
  for (const [key, at] of newest) {
    if (at >= list.at) continue;
    const [chat, slot] = key.split("|");
    const chatId = Number(chat);
    if (assignee.get(Number(slot.slice(5))) === agentOf.get(chatId)) continue;
    await clearSlot(chatId, slot);
    dropped += 1;
  }
  return dropped;
}

/** The minute job's share of «تنبيهاتي» (inside /api/murad/run, after the follow-ups sync refreshed the open list): the sweep, the delivery statuses, the waiting reminders, the live screens (every fifth minute), and from 23:00 Riyadh the evening reports. */
export async function staffTick(): Promise<Record<string, unknown>> {
  const [sweep, deliveries, reminders, screens, reports, decisions, letters, mine, statuses] = await Promise.all([
    staffSweep(),
    refreshDeliveries(),
    remindWaiting(),
    refreshScreens(),
    sendDailyReports(),
    pushDecisions(),
    lettersTick(),
    mineTick(),
    closeExpiredStatuses().catch(() => null),
  ]);
  const dropped = await dropGone();
  return {
    sweep,
    deliveries,
    ...(reminders ? { reminders } : {}),
    ...(screens ? { screens } : {}),
    ...(reports ? { reports } : {}),
    ...(decisions ? { decisions } : {}),
    ...(letters ? { letters } : {}),
    ...(mine ? { mine } : {}),
    ...(statuses ? { statuses } : {}),
    ...(dropped ? { dropped } : {}),
  };
}
