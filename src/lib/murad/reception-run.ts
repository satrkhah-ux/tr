import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getFeatureFlags } from "@/lib/features-server";
import { addTeletelNote, assignTeletelTeam, intlPhone, listOpenConversations, listTeletelTeams, sendTeletelMessage } from "@/lib/providers/teletel";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { normalizePhone } from "@/lib/leads/sheet";
import { isHumanReply, maskPhone, SETTING } from "./core";
import { readSettings, readThread } from "./run";
import {
  clarifyText,
  decideReception,
  DEPARTMENT,
  firstName,
  isWorkingTime,
  parseHours,
  readRequest,
  readRoutes,
  receptionText,
  teamFor,
  type RouteKey,
} from "./reception";

/**
 * «المستقبل الآلي» doing what reception.ts decides, for one incoming message —
 * from the Teletel webhook (api/teletel/webhook) the moment it arrives, or from
 * the minute job as a fallback when the webhook missed one.
 *
 * Its gates, in order: the switch (murad_reception), the scope — the owner's
 * two test numbers until they say «الكل» (murad_reception_scope) — and client
 * WhatsApp not switched off. Then the turn is CLAIMED in murad_log (unique per
 * client message), so a webhook retried, or the job arriving second, does
 * nothing. Every act and every refusal after the claim is that row.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** how far back «this visit» reaches: a colleague's answer, or a reception, older than this belongs to an earlier one */
const VISIT_SEC = 12 * 3600;

export type IncomingMessage = { conversationId: number; messageId: number; at: number; phone: string; contactName: string; content: string };

export type ReceptionOutcome =
  | "off"
  | "out_of_scope"
  | "duplicate"
  | "unreadable"
  | `none:${"routed" | "staff" | "window"}`
  | "asked"
  | `routed:${RouteKey}`
  | "send_failed";

export type ReceptionSettings = { scope: "test" | "all"; routesRaw: string | null; hours: string | null };

export async function readReceptionSettings(service: SupabaseClient): Promise<ReceptionSettings> {
  const { data } = await service.from("app_settings").select("key, value").in("key", [SETTING.receptionScope, SETTING.receptionRoutes, SETTING.receptionHours]);
  const v = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return { scope: v.get(SETTING.receptionScope) === "all" ? "all" : "test", routesRaw: v.get(SETTING.receptionRoutes) ?? null, hours: v.get(SETTING.receptionHours) ?? null };
}

/** The conversation's row in «العملاء», made or completed now — the pull fills the rest within five minutes. */
async function markLead(service: SupabaseClient, m: IncomingMessage, fields: { inquiry: string | null; destination: string | null; route: string; at: string }): Promise<void> {
  const name = m.contactName.trim();
  const realName = name && !name.startsWith("#") && normalizePhone(name) !== normalizePhone(m.phone) ? name : null;
  const { data } = await service.from("client_leads").select("id, name, inquiry, destination").eq("teletel_conversation_id", m.conversationId).maybeSingle();
  const had = data as { id: string; name: string | null; inquiry: string | null; destination: string | null } | null;
  const routed = { auto_route: fields.route, auto_routed_at: fields.at, assigned_at: fields.at, assignee_reply_at: null, updated_at: fields.at };
  if (had) {
    await service
      .from("client_leads")
      .update({
        ...routed,
        ...(!had.name && realName ? { name: realName } : {}),
        ...((!had.inquiry || had.inquiry === "يستفسر") && fields.inquiry ? { inquiry: fields.inquiry } : {}),
        ...(!had.destination && fields.destination ? { destination: fields.destination } : {}),
      })
      .eq("id", had.id);
    return;
  }
  const first = new Date(m.at * 1000).toISOString();
  await service.from("client_leads").upsert(
    {
      ...routed,
      phone: normalizePhone(m.phone),
      name: realName,
      inquiry: fields.inquiry,
      destination: fields.destination,
      status: "open",
      source: "teletel",
      teletel_conversation_id: m.conversationId,
      created_at: first,
      first_message_at: first,
    },
    { onConflict: "teletel_conversation_id", ignoreDuplicates: true },
  );
}

export async function receive(m: IncomingMessage): Promise<ReceptionOutcome> {
  if (!m.conversationId || !m.messageId) return "unreadable";
  const service = db();
  const [flags, settings, reception] = await Promise.all([getFeatureFlags(), readSettings(service), readReceptionSettings(service)]);
  if (!flags.murad_reception || settings.clientWhatsapp === "off") return "off";
  const phone = intlPhone(m.phone);
  // the trial: the owner's two numbers only, until they widen it from /developer
  if (reception.scope !== "all" && (!phone || !settings.autoList.includes(phone))) return "out_of_scope";

  // claimed before anything is read or sent — one answer per client message, whoever comes second
  const claim = await service
    .from("murad_log")
    .insert({ conversation_id: m.conversationId, client_message_id: m.messageId, client_message_at: new Date(m.at * 1000).toISOString(), phone: m.phone, mode: "reception" })
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) return "duplicate";
  const logId = (claim.data as { id: string }).id;
  const finish = async (patch: Record<string, unknown>) => {
    await service.from("murad_log").update({ ...patch, acted_at: new Date().toISOString() }).eq("id", logId);
  };

  try {
    const [thread, past, places] = await Promise.all([
      readThread(m.conversationId),
      service.from("murad_log").select("mode, reason, reply_message_id, created_at").eq("conversation_id", m.conversationId),
      loadPlaces(service),
    ]);
    if (!thread) {
      await finish({ reason: "unreadable", error: "teletel: the thread could not be read" });
      return "unreadable";
    }
    const rows = (past.data ?? []) as { mode: string; reason: string | null; reply_message_id: number | null; created_at: string }[];
    // this visit, not the conversation's whole life: WhatsApp reopens the same conversation when a client writes
    // again days later — a reception or a colleague's answer from back then is not this time's
    const thisVisit = (sec: number) => m.at - sec < VISIT_SEC;
    const received = rows.filter((r) => r.mode === "reception" && thisVisit(Date.parse(r.created_at) / 1000));
    const ours = new Set(rows.filter((r) => r.reply_message_id != null).map((r) => Number(r.reply_message_id)));
    const request = readRequest(m.content, places);
    const decision = decideReception({
      routed: received.some((r) => r.reason?.startsWith("routed")),
      asked: received.some((r) => r.reason === "asked"),
      staffReplied: thread.messages.some((t) => thisVisit(t.at) && isHumanReply(t, ours)),
      canReply: thread.canReply,
      request,
    });
    const intake = { kind: request.kind, country: request.country, wants_human: request.wantsHuman };

    if (decision.act === "none") {
      await finish({ reason: `none:${decision.why}`, intake });
      return `none:${decision.why}`;
    }

    if (decision.act === "ask") {
      const text = clarifyText(request.salam);
      const replyId = await sendTeletelMessage(m.conversationId, text);
      await finish({ reason: replyId ? "asked" : "send_failed", reply: text, reply_message_id: replyId, intake, ...(replyId ? {} : { error: "send_failed" }) });
      return replyId ? "asked" : "send_failed";
    }

    // the hand-over: the greeting by name, the department, the team in Teletel
    const hours = parseHours(reception.hours);
    const now = new Date();
    const text = receptionText({ name: firstName(m.contactName), salam: request.salam, to: decision.to, opensAt: isWorkingTime(now, hours) ? null : hours.open });
    const replyId = await sendTeletelMessage(m.conversationId, text);
    if (!replyId) {
      await finish({ reason: "send_failed", reply: text, intake, error: "send_failed" });
      return "send_failed";
    }
    const teams = await listTeletelTeams();
    const teamId = teamFor(readRoutes(reception.routesRaw, teams), decision.to);
    const team = teams.find((t) => t.id === teamId) ?? null;
    const assigned = teamId ? await assignTeletelTeam(m.conversationId, teamId) : false;
    await addTeletelNote(
      m.conversationId,
      `🤖 المستقبل الآلي: ${decision.to}${request.country ? ` · ${request.country}` : ""} — ${assigned && team ? `حُوّلت إلى «${team.name}»` : "لا فريق لهذا القسم في الإعدادات — بانتظار من يستلمها"}`,
    );
    const at = now.toISOString();
    await finish({
      reason: `routed:${decision.to}`,
      reply: text,
      reply_message_id: replyId,
      intake: { ...intake, team_id: teamId, team: team?.name ?? null, assigned },
      ...(teamId && !assigned ? { error: "assign_failed" } : {}),
    });
    await markLead(service, m, {
      inquiry: decision.to === "موظف" || decision.to === "غير واضح" ? null : decision.to,
      destination: request.country,
      route: team?.name.trim() ?? DEPARTMENT[decision.to],
      at,
    });
    return `routed:${decision.to}`;
  } catch (error) {
    await finish({ reason: "error", error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
    return "unreadable";
  }
}

/** Today's reception, for /developer: handed over, asked, held back — and the latest few. */
export async function receptionToday(): Promise<{ routed: number; asked: number; other: number; recent: { at: string; phone: string; reason: string; reply: string }[] }> {
  const start = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })}T00:00:00+03:00`).toISOString();
  const { data } = await db().from("murad_log").select("created_at, phone, reason, reply").eq("mode", "reception").gte("created_at", start).order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as { created_at: string; phone: string | null; reason: string | null; reply: string | null }[];
  return {
    routed: rows.filter((r) => r.reason?.startsWith("routed")).length,
    asked: rows.filter((r) => r.reason === "asked").length,
    other: rows.filter((r) => !r.reason?.startsWith("routed") && r.reason !== "asked").length,
    recent: rows.slice(0, 8).map((r) => ({ at: r.created_at, phone: maskPhone(r.phone), reason: r.reason ?? "", reply: (r.reply ?? "").slice(0, 90) })),
  };
}

/**
 * The minute job's fallback for what the webhook missed (not registered yet, a
 * restart, Teletel retrying late): a conversation in scope whose client has
 * waited on us under half an hour (a new one, or one the client reopened) and
 * no reception turn in that half hour — its latest client message is received
 * as if it had just arrived; receive() decides, its claim keeps it to once.
 */
export async function receptionSweep(): Promise<number> {
  const service = db();
  const [flags, settings, reception, list] = await Promise.all([getFeatureFlags(), readSettings(service), readReceptionSettings(service), listOpenConversations()]);
  if (!flags.murad_reception || !list) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  // a client waiting on us for under half an hour — a new conversation, or an old one the client reopened
  const fresh = list.rows.filter((c) => c.waitingSince > 0 && nowSec - c.waitingSince < 1800 && (reception.scope === "all" || settings.autoList.includes(intlPhone(c.phone) ?? "")));
  if (!fresh.length) return 0;
  const { data } = await service
    .from("murad_log")
    .select("conversation_id")
    .eq("mode", "reception")
    .in("conversation_id", fresh.map((c) => c.id))
    .gte("created_at", new Date((nowSec - 1800) * 1000).toISOString());
  const seen = new Set(((data ?? []) as { conversation_id: number }[]).map((r) => Number(r.conversation_id)));
  let n = 0;
  for (const c of fresh.filter((x) => !seen.has(x.id)).slice(0, 5)) {
    const thread = await readThread(c.id);
    const last = [...(thread?.messages ?? [])].reverse().find((t) => t.fromClient && !t.isPrivate);
    if (!thread || !last) continue;
    const out = await receive({ conversationId: c.id, messageId: last.id, at: last.at, phone: c.phone, contactName: thread.name || c.name, content: last.text });
    if (out === "asked" || out.startsWith("routed")) n += 1;
  }
  return n;
}

/**
 * The token in Teletel's webhook URL: a hash of ADMIN_API_SECRET, never the
 * secret itself — Chatwoot sends no signature and no custom header, so the URL
 * is what proves the caller (api/teletel/webhook). Null without the secret.
 */
export function webhookToken(): string | null {
  const secret = process.env["ADMIN_API_SECRET"];
  return secret ? createHash("sha256").update(`teletel-webhook:${secret}`).digest("hex").slice(0, 40) : null;
}
