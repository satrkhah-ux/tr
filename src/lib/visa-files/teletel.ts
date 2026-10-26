import "server-only";

import { getTeletelConfig, listOpenConversations, searchTeletelContacts, teletelGet } from "@/lib/providers/teletel";
import { db } from "./store";
import { fold, MAX_DOC_BYTES } from "./rules";
import type { TeletelCandidate, TeletelPull } from "./types";

/**
 * What the visa files read from Teletel (the owner: «يسحبونه من تليتيل»): find a conversation, pull the client's
 * facts and attachments, and copy one attachment. Reads only — the one write (the private note on a new file)
 * is addTeletelNote in the action. The attachment's address is looked up HERE from the file's own conversation,
 * never taken from the browser, so a caller cannot make the server fetch an address of his choosing.
 */

type RawAttachment = { id?: number; file_type?: string; extension?: string | null; data_url?: string; file_size?: number };
type RawMessage = { id?: number; created_at?: number; message_type?: number; private?: boolean; attachments?: RawAttachment[] };
type RawConversation = {
  id?: number;
  last_activity_at?: number;
  meta?: { sender?: { id?: number; name?: string | null; phone_number?: string | null }; team?: { name?: string | null } | null; assignee?: { name?: string | null } | null };
};

export type Found = { messageId: number; attachmentId: number; fileName: string; fileType: "image" | "pdf"; at: number; fromClient: boolean; url: string };

const isVisaTeam = (team: string | null) => /فيزا|تأشير|visa/i.test(team ?? "");

/** open conversations by name or phone, then the other conversations of the contacts Teletel finds; the visa team's first */
export async function searchConversations(query: string): Promise<TeletelCandidate[] | null> {
  const q = query.trim();
  const d = q.replace(/\D/g, "");
  const [open, contacts] = await Promise.all([listOpenConversations(), searchTeletelContacts(q, 8)]);
  if (!open && contacts === null) return null;
  const found = new Map<number, TeletelCandidate>();
  for (const c of open?.rows ?? []) {
    if (fold(c.name).includes(fold(q)) || (d.length >= 4 && c.phone.replace(/\D/g, "").includes(d))) {
      found.set(c.id, { conversationId: c.id, contactName: c.name, phone: c.phone || null, lastActivityAt: c.lastActivityAt, team: c.team, assignee: c.assignee });
    }
  }
  const covered = new Set((open?.rows ?? []).map((c) => c.contactId));
  await Promise.all(
    (contacts ?? []).filter((ct) => ct.id && !covered.has(ct.id)).slice(0, 5).map(async (ct) => {
      const res = await teletelGet<{ payload?: RawConversation[] } | RawConversation[]>(`/contacts/${ct.id}/conversations`);
      const rows = (Array.isArray(res) ? res : (res?.payload ?? [])).filter((c) => typeof c.id === "number").sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0)).slice(0, 2);
      for (const c of rows) {
        found.set(c.id as number, { conversationId: c.id as number, contactName: ct.name, phone: ct.phone || null, lastActivityAt: c.last_activity_at ?? 0, team: c.meta?.team?.name ?? null, assignee: c.meta?.assignee?.name ?? null });
      }
    }),
  );
  return [...found.values()].sort((a, b) => Number(isVisaTeam(b.team)) - Number(isVisaTeam(a.team)) || b.lastActivityAt - a.lastActivityAt).slice(0, 12);
}

const nameOf = (a: RawAttachment, id: number) => {
  const last = (a.data_url ?? "").split("?")[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || `attachment-${id}`;
  } catch {
    return last || `attachment-${id}`;
  }
};

/** the images and PDFs of a conversation (the client's and ours, not internal notes), newest page first, up to `pages` of twenty messages */
export async function conversationFiles(conversationId: number, pages = 4): Promise<Found[] | null> {
  const out: Found[] = [];
  let before: number | null = null;
  for (let page = 0; page < pages; page += 1) {
    const res: { payload?: RawMessage[] } | null = await teletelGet<{ payload?: RawMessage[] }>(`/conversations/${conversationId}/messages${before ? `?before=${before}` : ""}`);
    if (!res) return page === 0 ? null : out;
    const messages = res.payload ?? [];
    if (messages.length === 0) break;
    for (const m of messages) {
      if (typeof m.id !== "number" || m.private || m.message_type === 2) continue;
      for (const a of m.attachments ?? []) {
        if (typeof a.id !== "number" || !a.data_url) continue;
        const pdf = a.file_type === "file" && (a.extension?.toLowerCase() === "pdf" || /\.pdf(\?|$)/i.test(a.data_url));
        if (a.file_type !== "image" && !pdf) continue;
        out.push({ messageId: m.id, attachmentId: a.id, fileName: nameOf(a, a.id), fileType: pdf ? "pdf" : "image", at: m.created_at ?? 0, fromClient: m.message_type === 0, url: a.data_url });
      }
    }
    before = Math.min(...messages.map((m) => m.id ?? Infinity));
  }
  return out;
}

export async function pullConversation(conversationId: number): Promise<TeletelPull | null> {
  const [conv, files, logs, lead] = await Promise.all([
    teletelGet<RawConversation>(`/conversations/${conversationId}`),
    conversationFiles(conversationId),
    db().from("murad_log").select("intake").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(30),
    db().from("client_leads").select("id, name, phone").eq("teletel_conversation_id", conversationId).maybeSingle(),
  ]);
  if (!conv) return null;
  const sender = conv.meta?.sender;
  const flows = ((logs.data ?? []) as { intake: { visa_flow?: { country?: string | null; nationality?: string | null; applicants?: number | null } } | null }[]).map((r) => r.intake?.visa_flow).filter((f) => f);
  const flow = flows.find((f) => f?.country) ?? flows[0] ?? null;
  const row = (lead.data as { id: string; name: string | null; phone: string | null } | null) ?? null;
  return {
    conversationId,
    contactId: typeof sender?.id === "number" ? sender.id : null,
    clientName: sender?.name?.trim() || row?.name?.trim() || "",
    clientPhone: sender?.phone_number || row?.phone || null,
    intake: flow ? { country: flow.country ?? null, nationality: flow.nationality ?? null, applicants: flow.applicants ?? null } : null,
    leadId: row?.id ?? null,
    // field by field: the address of the file stays on the server
    attachments: (files ?? []).map((a) => ({ messageId: a.messageId, attachmentId: a.attachmentId, fileName: a.fileName, fileType: a.fileType, at: a.at ? new Date(a.at * 1000).toISOString() : "", fromClient: a.fromClient })),
  };
}

/** one attachment of the file's own conversation, by message and attachment id */
export async function findAttachment(conversationId: number, messageId: number, attachmentId: number): Promise<Found | null> {
  const files = await conversationFiles(conversationId, 6);
  return files?.find((f) => f.messageId === messageId && f.attachmentId === attachmentId) ?? null;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length")) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Download with the Teletel token — sent only to Teletel's own host (redirects are followed by hand, and the token
 * is dropped on a hop to any other host, e.g. the storage service behind the attachment). https only, size capped.
 */
export async function downloadAttachment(url: string): Promise<{ ok: true; bytes: Uint8Array; contentType: string; size: number } | { ok: false; error: "unavailable" | "too_large" }> {
  const config = getTeletelConfig();
  if (!config) return { ok: false, error: "unavailable" };
  try {
    const home = new URL(config.baseUrl).host;
    let target = new URL(url);
    for (let hop = 0; hop < 4; hop += 1) {
      if (target.protocol !== "https:") return { ok: false, error: "unavailable" };
      const res = await fetch(target, {
        headers: target.host === home ? { api_access_token: config.token } : {},
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        target = new URL(res.headers.get("location") as string, target);
        continue;
      }
      if (!res.ok) return { ok: false, error: "unavailable" };
      const bytes = await readCapped(res, MAX_DOC_BYTES);
      return bytes ? { ok: true, bytes, contentType: res.headers.get("content-type") ?? "", size: bytes.length } : { ok: false, error: "too_large" };
    }
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
