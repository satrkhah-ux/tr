import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationEvents, conversationThread, teletelGet, listOpenConversations, listTeletelTeams, type OpenConversation } from "@/lib/providers/teletel";
import { classifyInquiry, delayText, timelineFrom, type Place } from "./auto";
import { currentAssignment, employeeFor } from "./assignment";
import { fold, normalizePhone } from "./sheet";
import { logAudit } from "@/lib/data/audit";
import { muradMessageIds } from "@/lib/murad/core";
import { allRows } from "@/lib/data/all-rows";
import { classifyConversationInquiry } from "./request-classification";
import { inferConversationDestination } from "./destination";
import { onClientReturn, recordClosed } from "./lifecycle";

/**
 * «العملاء» phase two (the owner, 2026-10-17: «كل شيء تلقائي، خاصة اسم العميل»):
 * every open WhatsApp conversation in Teletel is a client_leads row, keyed by
 * its Teletel id, with nobody typing anything —
 *
 *  · the client's name and phone as Teletel holds them;
 *  · who received it first and every hand-over after (handoffs, 0099): its
 *    history read from Teletel's «تم إسنادها إلى …» lines and the replies;
 *  · its real date (Teletel's created_at — the sheet never had one);
 *  · «تأخير المحادثة» from its clock; the kind and the place from its labels
 *    and the client's words (auto.ts), only while nobody has set them;
 *  · closed once it is no longer open in Teletel (resolved there);
 *  · the times «العملاء» computes its timing columns from (0098): the
 *    client's first message, our first reply, the first hand-over and that
 *    agent's first reply (from the turns).
 *
 * A sheet row for the same phone is taken over rather than counted twice.
 * Reads the SLA board's copy of the open list (listOpenConversations: kept in
 * the process, refreshed behind it every five minutes) — never a second read.
 */

export type TeletelPullResult = { read: number; added: number; updated: number; merged: number; closed: number; classified: number; error?: string };

/** conversations whose client messages were already read this process (a restart reads them again, a few a run) */
const threadRead = new Map<number, number>();
/** how many threads one run reads: two requests each, so a backlog of 600 is cleared in under an hour of 5-minute runs */
const THREADS_PER_RUN = 40;
/** conversations whose turns are read again, a run — the ones something happened in, latest first */
const TIMELINES_PER_RUN = 15;
// ponytail: ten pages (200 messages) back; a longer conversation's first receiver is the earliest turn those pages hold
const TIMELINE_PAGES = 10;

const iso = (sec: number) => new Date(sec * 1000).toISOString();

type Person = { id: string; arabic_name: string; english_name: string | null };
type Known = {
  id: string;
  phone: string;
  name: string | null;
  inquiry: string | null;
  inquiry_source: string | null;
  destination: string | null;
  destination_source: "client" | "labels" | "manual" | null;
  received_by: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  delay: string | null;
  status: "open" | "closed";
  conversation_state: string | null;
  teletel_conversation_id: number | null;
  first_message_at: string | null;
  first_reply_at: string | null;
  assigned_at: string | null;
  assignee_reply_at: string | null;
  contact_id: number | null;
  timeline_seen_at: number | null;
  auto_routed_at: string | null;
  created_at: string;
  last_visit_at: string | null;
  /** «عرض آلي»: the Basic file Murad made for this conversation */
  draft_id: string | null;
};

/** a real name, not Teletel's stand-in (the phone, or «#123») */
function clientName(c: OpenConversation): string | null {
  const n = c.name.trim();
  if (!n || n.startsWith("#") || normalizePhone(n) === normalizePhone(c.phone)) return null;
  return n;
}

export async function loadPlaces(supabase: SupabaseClient): Promise<Place[]> {
  const [{ data: countries }, { data: cities }] = await Promise.all([
    supabase.from("countries").select("id, arabic_name"),
    supabase.from("cities").select("arabic_name, country_id"),
  ]);
  const countryName = new Map(((countries ?? []) as { id: string; arabic_name: string }[]).map((c) => [c.id, c.arabic_name]));
  return [
    ...[...countryName.values()].map((name) => ({ name, country: name })),
    ...((cities ?? []) as { arabic_name: string; country_id: string | null }[]).map((c) => ({ name: c.arabic_name, country: countryName.get(c.country_id ?? "") ?? "" })),
  ];
}

export async function pullTeletel(supabase: SupabaseClient): Promise<TeletelPullResult> {
  const result: TeletelPullResult = { read: 0, added: 0, updated: 0, merged: 0, closed: 0, classified: 0 };
  const list = await listOpenConversations();
  if (!list) return { ...result, error: "teletel" };
  const open = list.rows.filter((c) => normalizePhone(c.phone).length >= 7);
  result.read = open.length;
  const nowSec = Math.floor(Date.now() / 1000);

  const [{ data: people }, places, { data: known }] = await Promise.all([
    supabase.from("employees").select("id, arabic_name, english_name").eq("status", "Active"),
    loadPlaces(supabase),
    // ponytail: every Teletel row and every unmatched sheet row, a page at a time (PostgREST stops at a thousand); a date window when it grows past tens of thousands
    allRows((a, b) =>
      supabase
        .from("client_leads")
        .select("id, phone, name, inquiry, inquiry_source, destination, destination_source, received_by, assigned_to, assigned_to_name, delay, status, conversation_state, teletel_conversation_id, first_message_at, first_reply_at, assigned_at, assignee_reply_at, contact_id, timeline_seen_at, auto_routed_at, created_at, last_visit_at, draft_id")
        .or("teletel_conversation_id.not.is.null,and(source.eq.sheet,teletel_conversation_id.is.null)")
        .order("id")
        .range(a, b),
    ),
  ]);
  const team = (people ?? []) as Person[];
  const rows = (known ?? []) as Known[];
  const byConversation = new Map(rows.filter((r) => r.teletel_conversation_id).map((r) => [Number(r.teletel_conversation_id), r]));
  const sheetByPhone = new Map(rows.filter((r) => !r.teletel_conversation_id).map((r) => [r.phone, r]));

  const fresh: Record<string, unknown>[] = [];
  const updates: [string, Record<string, unknown>][] = [];
  // what each conversation is classified as after this run — the ones still vague get their thread read below
  const vague: { c: OpenConversation; inquiry: string | null; destination: string | null; mutableDestination: boolean; visitAt: number }[] = [];
  // something happened since their turns were last read: read them again
  const timelines: OpenConversation[] = [];
  // seen closed, open again: the client came back (or a colleague reopened it) — the webhook usually saw it first
  const reopened: OpenConversation[] = [];
  for (const c of open) {
    const phone = normalizePhone(c.phone);
    const holder = employeeFor(c.assignee, team);
    // where it stands for «الشاشات» and /m (lifecycle.ts): the client waiting on us, or we spoke last
    const live = { ...currentAssignment(c, team), delay: delayText(c, nowSec) || null, status: "open" as const, conversation_state: c.waitingSince > 0 ? "waiting" : "open" };
    const had = byConversation.get(c.id) ?? sheetByPhone.get(phone);
    if (had) {
      if (!had.teletel_conversation_id) {
        sheetByPhone.delete(phone);
        result.merged += 1;
      }
      const patch: Record<string, unknown> = { ...live, teletel_conversation_id: c.id };
      // what nobody has set yet: the name above all, then the kind and the place
      if (!had.name && clientName(c)) patch.name = clientName(c);
      // the service the client picked in the WhatsApp menu outranks a guess: it also settles an unclear request
      const picked = classifyInquiry([c.serviceType ?? ""], "");
      if ((had.inquiry_source !== "manual" || had.inquiry === "طلب غير واضح") && (!had.inquiry || had.inquiry === "طلب غير واضح")) {
        patch.inquiry = picked || classifyInquiry(c.labels, "") || had.inquiry;
        patch.inquiry_source = "auto";
      }
      // Neither staff previews nor stale labels establish a travel destination.
      // until its turns are read, the one holding it stands in as the receiver
      if (!had.received_by && holder && had.timeline_seen_at == null) patch.received_by = holder;
      if (Number(had.timeline_seen_at) !== c.lastActivityAt) timelines.push(c);
      // the client came back (0104): the conversation had been closed, or they wrote over a day after the visit before
      const visitStart = Date.parse(had.last_visit_at ?? had.created_at) / 1000;
      if (had.status === "closed") reopened.push(c);
      if (c.waitingSince > 0 && c.waitingSince > visitStart && (had.status === "closed" || c.waitingSince - visitStart > 86_400)) {
        patch.last_visit_at = iso(c.waitingSince);
      }
      // the clock's own times, written once
      if (!had.first_message_at && c.createdAt) patch.first_message_at = iso(c.createdAt);
      if (!had.first_reply_at && c.firstReplyAt) patch.first_reply_at = iso(c.firstReplyAt);
      if (!had.contact_id && c.contactId) patch.contact_id = c.contactId;
      if (!had.teletel_conversation_id && c.createdAt) patch.created_at = new Date(c.createdAt * 1000).toISOString();
      // only what changed: most of the 600 open conversations change nothing between two runs
      const changed = Object.entries(patch).filter(([k, v]) => (had as Record<string, unknown>)[k] !== v && !(k === "teletel_conversation_id" && Number(had.teletel_conversation_id) === v));
      if (changed.length) updates.push([had.id, { ...Object.fromEntries(changed), updated_at: new Date().toISOString() }]);
      const inquiry = (patch.inquiry as string | null | undefined) ?? had.inquiry;
      const destination = (patch.destination as string | null | undefined) ?? had.destination;
      const mutableDestination = had.destination_source !== "manual" && (!had.destination || had.destination_source === "client" || had.destination_source === "labels");
      if (had.inquiry_source !== "manual" || !inquiry || inquiry === "طلب غير واضح" || mutableDestination) vague.push({ c, inquiry, destination, mutableDestination, visitAt: Date.parse(String(patch.last_visit_at ?? had.last_visit_at ?? had.created_at)) / 1000 });
    } else {
      fresh.push({
        ...live,
        phone,
        name: clientName(c),
        inquiry: classifyInquiry([c.serviceType ?? "", ...c.labels], "") || null,
        inquiry_source: "auto",
        destination: null,
        destination_source: "client",
        received_by: holder,
        received_by_name: c.assignee,
        source: "teletel",
        teletel_conversation_id: c.id,
        created_at: new Date((c.createdAt || nowSec) * 1000).toISOString(),
        first_message_at: c.createdAt ? iso(c.createdAt) : null,
        first_reply_at: c.firstReplyAt ? iso(c.firstReplyAt) : null,
        contact_id: c.contactId,
      });
      timelines.push(c);
      const row = fresh[fresh.length - 1] as { inquiry: string | null; destination: string | null };
      vague.push({ c, inquiry: row.inquiry, destination: row.destination, mutableDestination: true, visitAt: c.createdAt });
    }
  }
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.all(updates.slice(i, i + 10).map(([id, patch]) => {
      const query = supabase.from("client_leads").update(patch).eq("id", id);
      return patch.inquiry_source ? query.or("inquiry_source.is.null,inquiry_source.neq.manual,inquiry.eq.طلب غير واضح") : query;
    }));
  }
  result.updated = updates.length;
  for (const c of reopened) await onClientReturn(c.id, c.waitingSince || nowSec, c.waitingSince > 0);
  if (fresh.length) {
    // two pulls at once add each conversation once
    const { error } = await supabase.from("client_leads").upsert(fresh, { onConflict: "teletel_conversation_id", ignoreDuplicates: true });
    if (error) return { ...result, error: error.message };
    result.added = fresh.length;
  }

  // the list's preview is the LAST message — often ours. What the client wrote decides:
  // their own messages in the thread, newest conversations first, a few a run.
  const toRead = vague.filter((v) => threadRead.get(v.c.id) !== v.c.lastActivityAt).sort((a, b) => b.c.createdAt - a.c.createdAt).slice(0, THREADS_PER_RUN);
  for (let i = 0; i < toRead.length; i += 5) {
    await Promise.all(
      toRead.slice(i, i + 5).map(async ({ c, inquiry, destination, mutableDestination, visitAt }) => {
        const thread = await conversationThread(c.id, 50, c.createdAt);
        if (!thread?.historyComplete) return;
        threadRead.set(c.id, c.lastActivityAt);
        const patch: Record<string, unknown> = {};
        const visitInference = inferConversationDestination(thread.messages.filter((m) => m.at >= visitAt), places);
        const inference = visitInference.evidenceId !== null ? visitInference : inferConversationDestination(thread.messages, places);
        const kind = classifyConversationInquiry(thread.messages, places, visitAt, [c.serviceType ?? "", ...c.labels], byConversation.get(c.id)?.destination_source === "manual" ? destination : null);
        const origin = byConversation.get(c.id)?.inquiry_source;
        if ((origin !== "manual" || inquiry === "طلب غير واضح") && kind && kind !== inquiry) { patch.inquiry = kind; patch.inquiry_source = "auto"; }
        const place = inference.destination;
        if (mutableDestination && (place !== destination || byConversation.get(c.id)?.destination_source !== "client")) {
          patch.destination = place;
          patch.destination_source = "client";
        }
        if (!Object.keys(patch).length) return;
        let update = supabase.from("client_leads").update({ ...patch, updated_at: new Date().toISOString() }).eq("teletel_conversation_id", c.id);
        if (patch.inquiry_source) update = update.or("inquiry_source.is.null,inquiry_source.neq.manual,inquiry.eq.طلب غير واضح");
        if (patch.destination_source) {
          update = update.or("destination_source.is.null,destination_source.in.(client,labels)");
          update = destination ? update.eq("destination", destination) : update.is("destination", null);
        }
        const { error } = await update;
        if (error) { threadRead.delete(c.id); return; }
        result.classified += 1;
      }),
    );
  }

  // the turns (the owner, 2026-10-18): who received it first, how long each agent took to answer and to
  // hand it on — read from the history whenever something happened, the latest first
  const toTrace = timelines.sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, TIMELINES_PER_RUN);
  if (toTrace.length) {
    const teams = new Set((await listTeletelTeams()).map((t) => fold(t.name)));
    const isTeam = (name: string) => name.trim().startsWith("قسم") || teams.has(fold(name));
    // Murad's and the reception's replies are sent as the API token's user: no one's turn
    const { data: ours } = await supabase.from("murad_log").select("reply_message_id, intake").in("conversation_id", toTrace.map((c) => c.id));
    const ignore = muradMessageIds((ours ?? []) as { reply_message_id: number | null; intake: unknown }[]);
    for (let i = 0; i < toTrace.length; i += 5) {
      await Promise.all(
        toTrace.slice(i, i + 5).map(async (c) => {
          const events = await conversationEvents(c.id, TIMELINE_PAGES);
          if (!events) return;
          const stages = timelineFrom(events, c.createdAt, isTeam, ignore);
          const [first, second] = stages;
          const patch: Record<string, unknown> = { handoffs: stages, timeline_seen_at: c.lastActivityAt };
          // «الموظف المستلم» is the first to receive it, never whoever holds it now
          if (first) Object.assign(patch, { received_by: employeeFor(first.agent, team), received_by_name: first.agent });
          const routedAt = byConversation.get(c.id)?.auto_routed_at;
          // handed over by «المستقبل الآلي» the moment it came: that is the hand-over, and the first colleague to answer receives it
          if (routedAt) {
            const answer = stages.find((s) => s.reply && s.reply >= Date.parse(routedAt) / 1000);
            if (answer?.reply) patch.assignee_reply_at = iso(answer.reply);
            const owner = answer ? employeeFor(answer.agent, team) : null;
            const draftId = byConversation.get(c.id)?.draft_id;
            if (owner && draftId) await claimAutoFile(supabase, draftId, owner, answer!.agent);
          } else if (second) {
            Object.assign(patch, { assigned_at: iso(second.from), assignee_reply_at: second.reply ? iso(second.reply) : null });
            // Historical handovers supply timing only; ownership comes from the live provider snapshot.
          }
          await supabase.from("client_leads").update(patch).eq("teletel_conversation_id", c.id);
        }),
      );
    }
  }

  // resolved in Teletel: no longer in the (complete) open list
  const stillOpen = new Set(open.map((c) => c.id));
  const gone = rows.filter((r) => r.teletel_conversation_id && r.status === "open" && !stillOpen.has(Number(r.teletel_conversation_id)));
  for (let i = 0; i < gone.length; i += 5) {
    await Promise.all(gone.slice(i, i + 5).map(async (lead) => {
      // A handover may have happened just before closure, between two pulls.
      const current = await teletelGet<{ inbox_id?: number; status?: string; meta?: { assignee?: { id?: number; name?: string }; team?: { name?: string } } }>(`/conversations/${lead.teletel_conversation_id}`);
      const assignment = current?.meta ? currentAssignment({ assignee: current.meta.assignee?.name ?? null, team: current.meta.team?.name ?? null }, team) : {};
      await supabase.from("client_leads").update({ ...assignment, status: "closed", delay: null, updated_at: new Date().toISOString() }).eq("id", lead.id);
      // who closed it, kept (lifecycle.ts): when the client writes again it goes back to them, or to intake — resolved
      // only (a snoozed one leaves the open list too)
      if (current?.status === "resolved") await recordClosed(Number(lead.teletel_conversation_id), current?.meta?.assignee?.id ?? null, current?.inbox_id ?? null);
    }));
  }
  result.closed = gone.length;
  return result;
}

/**
 * Murad's «عرض آلي» becomes the file of the first colleague to answer the
 * client after him — their «ملفاتي», their commission, their name on the
 * offer — with «استلمه من مُراد» in its history (the evaluator, 2026-10-19).
 * Once: only a file and an offer still nobody's are taken; a partner's never.
 */
async function claimAutoFile(supabase: SupabaseClient, draftId: string, employeeId: string, name: string): Promise<void> {
  const { data } = await supabase
    .from("offer_drafts")
    .update({ created_by: employeeId })
    .eq("id", draftId)
    .is("created_by", null)
    .is("partner_company_id", null)
    .select("data")
    .maybeSingle();
  const serial = (data as { data: { produced_serial?: string | null } } | null)?.data?.produced_serial;
  if (!serial) return;
  const { data: offer } = await supabase.from("offers").update({ employee_id: employeeId }).eq("serial", serial).is("employee_id", null).select("id").maybeSingle();
  const offerId = (offer as { id: string } | null)?.id;
  if (offerId) await logAudit({ action: "offer.claimed", entity: "offers", entity_id: offerId, meta: { serial, from: "murad" }, actor: { id: employeeId, label: name } });
}
