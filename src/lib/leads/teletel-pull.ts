import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationThread, listOpenConversations, type OpenConversation } from "@/lib/providers/teletel";
import { classifyInquiry, delayText, findPlace, type Place } from "./auto";
import { matchEmployee, normalizePhone } from "./sheet";

/**
 * «العملاء» phase two (the owner, 2026-10-17: «كل شيء تلقائي، خاصة اسم العميل»):
 * every open WhatsApp conversation in Teletel is a client_leads row, keyed by
 * its Teletel id, with nobody typing anything —
 *
 *  · the client's name and phone as Teletel holds them;
 *  · the agent holding it (received_by when it arrives; assigned_to once it
 *    moves to someone else);
 *  · its real date (Teletel's created_at — the sheet never had one);
 *  · «تأخير المحادثة» from its clock; the kind and the place from its labels
 *    and the client's words (auto.ts), only while nobody has set them;
 *  · closed once it is no longer open in Teletel (resolved there).
 *
 * A sheet row for the same phone is taken over rather than counted twice.
 * Reads the SLA board's copy of the open list (listOpenConversations: kept in
 * the process, refreshed behind it every five minutes) — never a second read.
 */

export type TeletelPullResult = { read: number; added: number; updated: number; merged: number; closed: number; classified: number; error?: string };

/** conversations whose client messages were already read this process (a restart reads them again, a few a run) */
const threadRead = new Set<number>();
/** how many threads one run reads: two requests each, so a backlog of 600 is cleared in under an hour of 5-minute runs */
const THREADS_PER_RUN = 40;

type Person = { id: string; arabic_name: string; english_name: string | null };
type Known = {
  id: string;
  phone: string;
  name: string | null;
  inquiry: string | null;
  destination: string | null;
  received_by: string | null;
  assigned_to: string | null;
  delay: string | null;
  status: "open" | "closed";
  teletel_conversation_id: number | null;
};

/** an agent's Teletel name to an employee — by the Arabic name, else the English */
function employeeFor(name: string | null, people: Person[]): string | null {
  if (!name) return null;
  return (
    matchEmployee(name, people) ??
    matchEmployee(
      name,
      people.filter((p) => p.english_name).map((p) => ({ id: p.id, arabic_name: p.english_name as string })),
    )
  );
}

/** a real name, not Teletel's stand-in (the phone, or «#123») */
function clientName(c: OpenConversation): string | null {
  const n = c.name.trim();
  if (!n || n.startsWith("#") || normalizePhone(n) === normalizePhone(c.phone)) return null;
  return n;
}

async function loadPlaces(supabase: SupabaseClient): Promise<Place[]> {
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
    // ponytail: every Teletel row and every unmatched sheet row in one read; a date window when it grows past tens of thousands
    supabase
      .from("client_leads")
      .select("id, phone, name, inquiry, destination, received_by, assigned_to, delay, status, teletel_conversation_id")
      .or("teletel_conversation_id.not.is.null,and(source.eq.sheet,teletel_conversation_id.is.null)")
      .limit(20000),
  ]);
  const team = (people ?? []) as Person[];
  const rows = (known ?? []) as Known[];
  const byConversation = new Map(rows.filter((r) => r.teletel_conversation_id).map((r) => [Number(r.teletel_conversation_id), r]));
  const sheetByPhone = new Map(rows.filter((r) => !r.teletel_conversation_id).map((r) => [r.phone, r]));

  const fresh: Record<string, unknown>[] = [];
  const updates: [string, Record<string, unknown>][] = [];
  // what each conversation is classified as after this run — the ones still vague get their thread read below
  const vague: { c: OpenConversation; inquiry: string | null; destination: string | null }[] = [];
  for (const c of open) {
    const phone = normalizePhone(c.phone);
    const holder = employeeFor(c.assignee, team);
    const live = { delay: delayText(c, nowSec) || null, status: "open" as const };
    const had = byConversation.get(c.id) ?? sheetByPhone.get(phone);
    if (had) {
      if (!had.teletel_conversation_id) {
        sheetByPhone.delete(phone);
        result.merged += 1;
      }
      const patch: Record<string, unknown> = { ...live, teletel_conversation_id: c.id };
      // what nobody has set yet: the name above all, then the kind and the place
      if (!had.name && clientName(c)) patch.name = clientName(c);
      if (!had.inquiry) patch.inquiry = classifyInquiry(c.labels, c.preview) || null;
      if (!had.destination) patch.destination = findPlace(c.labels, c.preview, places) || null;
      if (!had.received_by && holder) patch.received_by = holder;
      // moved to someone else in Teletel: that is the hand-over
      if (had.received_by && holder && holder !== had.received_by) patch.assigned_to = holder;
      if (!had.teletel_conversation_id && c.createdAt) patch.created_at = new Date(c.createdAt * 1000).toISOString();
      // only what changed: most of the 600 open conversations change nothing between two runs
      const changed = Object.entries(patch).filter(([k, v]) => (had as Record<string, unknown>)[k] !== v && !(k === "teletel_conversation_id" && Number(had.teletel_conversation_id) === v));
      if (changed.length) updates.push([had.id, { ...Object.fromEntries(changed), updated_at: new Date().toISOString() }]);
      const inquiry = (patch.inquiry as string | null | undefined) ?? had.inquiry;
      const destination = (patch.destination as string | null | undefined) ?? had.destination;
      if (!inquiry || inquiry === "يستفسر" || !destination) vague.push({ c, inquiry, destination });
    } else {
      fresh.push({
        ...live,
        phone,
        name: clientName(c),
        inquiry: classifyInquiry(c.labels, c.preview) || null,
        destination: findPlace(c.labels, c.preview, places) || null,
        received_by: holder,
        received_by_name: c.assignee,
        source: "teletel",
        teletel_conversation_id: c.id,
        created_at: new Date((c.createdAt || nowSec) * 1000).toISOString(),
      });
      const row = fresh[fresh.length - 1] as { inquiry: string | null; destination: string | null };
      if (!row.inquiry || row.inquiry === "يستفسر" || !row.destination) vague.push({ c, inquiry: row.inquiry, destination: row.destination });
    }
  }
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.all(updates.slice(i, i + 10).map(([id, patch]) => supabase.from("client_leads").update(patch).eq("id", id)));
  }
  result.updated = updates.length;
  if (fresh.length) {
    // two pulls at once add each conversation once
    const { error } = await supabase.from("client_leads").upsert(fresh, { onConflict: "teletel_conversation_id", ignoreDuplicates: true });
    if (error) return { ...result, error: error.message };
    result.added = fresh.length;
  }

  // the list's preview is the LAST message — often ours. What the client wrote decides:
  // their own messages in the thread, newest conversations first, a few a run.
  const toRead = vague.filter((v) => !threadRead.has(v.c.id)).sort((a, b) => b.c.createdAt - a.c.createdAt).slice(0, THREADS_PER_RUN);
  for (let i = 0; i < toRead.length; i += 5) {
    await Promise.all(
      toRead.slice(i, i + 5).map(async ({ c, inquiry, destination }) => {
        const thread = await conversationThread(c.id);
        if (!thread) return;
        threadRead.add(c.id);
        const said = thread.messages.filter((m) => m.fromClient && !m.isPrivate).map((m) => m.text).join(" ");
        const patch: Record<string, unknown> = {};
        const kind = classifyInquiry(c.labels, said);
        if ((!inquiry || inquiry === "يستفسر") && kind && kind !== inquiry) patch.inquiry = kind;
        const place = destination ? "" : findPlace(c.labels, said, places);
        if (place) patch.destination = place;
        if (!Object.keys(patch).length) return;
        await supabase.from("client_leads").update({ ...patch, updated_at: new Date().toISOString() }).eq("teletel_conversation_id", c.id);
        result.classified += 1;
      }),
    );
  }

  // resolved in Teletel: no longer in the (complete) open list
  const stillOpen = new Set(open.map((c) => c.id));
  const gone = rows.filter((r) => r.teletel_conversation_id && r.status === "open" && !stillOpen.has(Number(r.teletel_conversation_id))).map((r) => r.id);
  if (gone.length) {
    await supabase.from("client_leads").update({ status: "closed", delay: null, updated_at: new Date().toISOString() }).in("id", gone);
    result.closed = gone.length;
  }
  return result;
}
