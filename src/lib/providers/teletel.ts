import "server-only";

/**
 * Teletel customer platform (Chatwoot-compatible API) — lets agents pick a
 * customer from Teletel instead of re-typing name/phone, and suggests a trip
 * destination from the contact's labels/attributes (e.g. «رحلة جورجيا» → جورجيا).
 *
 * SERVER-ONLY: the access token must never reach the browser. Config comes from
 * env (bracket access → read at RUNTIME, works on Netlify/VPS without rebuild):
 *   TELETEL_BASE_URL   e.g. https://chat.teletel.sa  (the platform's browser URL)
 *   TELETEL_API_TOKEN  profile access token
 *   TELETEL_ACCOUNT_ID account number (default "1")
 * All failures degrade to empty results — the generator must keep working
 * (manual entry) when Teletel is down or unconfigured.
 */

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export type TeletelConfig = { baseUrl: string; token: string; accountId: string };

export function getTeletelConfig(): TeletelConfig | null {
  const rawBase = readEnv("TELETEL_BASE_URL");
  const token = readEnv("TELETEL_API_TOKEN");
  if (!rawBase || !token) return null;
  const baseUrl = (rawBase.startsWith("http") ? rawBase : `https://${rawBase}`).replace(/\/+$/, "");
  return { baseUrl, token, accountId: readEnv("TELETEL_ACCOUNT_ID") ?? "1" };
}

export type TeletelContact = {
  id: number;
  name: string;
  phone: string;
  email: string;
  labels: string[];
  attributes: Record<string, unknown>;
};

type RawContact = {
  id?: unknown;
  name?: unknown;
  phone_number?: unknown;
  email?: unknown;
  custom_attributes?: unknown;
  additional_attributes?: unknown;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * One transport for both directions. `body` is what makes it a POST — the
 * signature stays optional so every existing read call is untouched.
 */
async function api<T>(config: TeletelConfig, path: string, body?: unknown, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(`${config.baseUrl}/api/v1/accounts/${config.accountId}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? { api_access_token: config.token }
          : { api_access_token: config.token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** A plain read (GET only) for a caller that needs fields the helpers below leave out — «مُراد» (murad/run.ts). */
export async function teletelGet<T>(path: string): Promise<T | null> {
  const config = getTeletelConfig();
  return config ? api<T>(config, path) : null;
}

/**
 * The most recent conversation with a contact, resolved at send time.
 *
 * Not stored: a conversation id goes stale when an agent resolves and reopens a
 * thread, and a cached wrong id sends a booking update into a closed chat where
 * nobody looks. One 8-second GET is cheaper than that failure.
 */
export async function findTeletelConversation(contactId: number): Promise<number | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  const res = await api<{ payload?: { id?: number }[] } | { id?: number }[]>(
    config,
    `/contacts/${contactId}/conversations`,
  );
  const list = Array.isArray(res) ? res : (res?.payload ?? []);
  const id = list.find((c) => typeof c?.id === "number")?.id;
  return typeof id === "number" ? id : null;
}

/**
 * Send into an EXISTING conversation.
 *
 * Deliberately cannot open a new one: creating a conversation needs a channel
 * `source_id` whose format is provider-specific and unverified here, and
 * guessing it would post into the wrong thread. No conversation → the caller
 * falls back to Telegram or to copy-and-paste, which is honest.
 */
export async function sendTeletelMessage(conversationId: number, content: string): Promise<number | null> {
  const config = getTeletelConfig();
  if (!config || !content.trim()) return null;
  const res = await api<{ id?: number }>(config, `/conversations/${conversationId}/messages`, {
    content,
    message_type: "outgoing",
    private: false,
  });
  return typeof res?.id === "number" ? res.id : null;
}

/** Send a file (the programme's PDF) into an existing conversation, with a caption. */
export async function sendTeletelAttachment(
  conversationId: number,
  caption: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<number | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  try {
    const form = new FormData();
    form.append("content", caption);
    form.append("message_type", "outgoing");
    form.append("private", "false");
    form.append("attachments[]", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    const res = await fetch(`${config.baseUrl}/api/v1/accounts/${config.accountId}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { api_access_token: config.token },
      body: form,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: number };
    return typeof body.id === "number" ? body.id : null;
  } catch {
    return null;
  }
}

let approvedCache: { at: number; names: Map<string, string> } | null = null;

/**
 * The WhatsApp templates on the client inbox and their Meta status
 * (APPROVED / PENDING / REJECTED), by name. Teletel syncs them from Meta; we
 * only read. Cached ten minutes — the morning job asks once per case.
 */
export async function whatsappTemplateStatus(): Promise<Map<string, string> | null> {
  if (approvedCache && Date.now() - approvedCache.at < 10 * 60_000) return approvedCache.names;
  const config = getTeletelConfig();
  if (!config) return null;
  const inbox = await whatsappInbox(config);
  if (!inbox) return null;
  const res = await api<{ message_templates?: { name?: string; status?: string }[] }>(config, `/inboxes/${inbox}`);
  if (!res) return null;
  const names = new Map((res.message_templates ?? []).filter((t) => t.name).map((t) => [t.name as string, String(t.status ?? "")]));
  approvedCache = { at: Date.now(), names };
  return names;
}

/**
 * An approved WhatsApp template — the one way to reach a client whose last
 * message is older than 24 hours (reminders, the programme). `preview` is the
 * text as the client reads it, shown on the thread; a document header carries a
 * PUBLIC file URL that Meta fetches itself.
 */
export async function sendTeletelTemplate(
  conversationId: number,
  template: { name: string; params: string[]; preview: string; document?: { url: string; name: string } },
): Promise<number | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  const body = Object.fromEntries(template.params.map((v, i) => [String(i + 1), v]));
  const res = await api<{ id?: number }>(config, `/conversations/${conversationId}/messages`, {
    content: template.preview,
    message_type: "outgoing",
    private: false,
    template_params: {
      name: template.name,
      category: "UTILITY",
      language: "ar",
      processed_params: {
        body,
        ...(template.document ? { header: { media_url: template.document.url, media_type: "document", media_name: template.document.name } } : {}),
      },
    },
  });
  return typeof res?.id === "number" ? res.id : null;
}

export type TeletelFailure = "token" | "blocked" | "down";

/**
 * Why Teletel refused — asked only after a search already failed.
 *
 * A 401 is the token. A 403 HTML page is the nginx in front of chat.teletel.io
 * refusing THIS server's address before the token is even read (2026-10-11:
 * the same token answered 200 from a PC and 403 from the VPS). Telling the
 * agent «renew the token» for that one sends the team rotating a token that
 * was never the problem.
 */
export async function diagnoseTeletel(): Promise<TeletelFailure> {
  const config = getTeletelConfig();
  if (!config) return "down";
  try {
    const res = await fetch(`${config.baseUrl}/api/v1/accounts/${config.accountId}/contacts/search?q=a`, {
      headers: { api_access_token: config.token },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 401) return "token";
    if (res.status === 403) return (res.headers.get("content-type") ?? "").includes("json") ? "token" : "blocked";
    return "down";
  } catch {
    return "down";
  }
}

/** Find the contact by phone, then their conversation. null when either misses. */
export async function conversationForPhone(phone: string): Promise<number | null> {
  const hits = (await searchTeletelContacts(phone, 3)) ?? [];
  const digits = phone.replace(/\D/g, "").slice(-9);
  const match =
    hits.find((h) => h.phone.replace(/\D/g, "").endsWith(digits)) ?? (digits ? undefined : hits[0]);
  if (!match) return null;
  return findTeletelConversation(match.id);
}

/**
 * Contact search (name / phone / email).
 *
 * Returns NULL when the request failed and [] when it genuinely matched
 * nobody. The difference is the whole point: an expired access token used to
 * come back as zero rows, and the agent was told «لا يوجد عملاء مطابقون» about
 * a customer who was sitting right there in Teletel. One reads as "type them
 * in by hand", the other as "the integration needs a new token".
 */
export async function searchTeletelContacts(query: string, limit = 6): Promise<TeletelContact[] | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  if (!query.trim()) return [];
  const data = await api<{ payload?: RawContact[] }>(
    config,
    `/contacts/search?q=${encodeURIComponent(query.trim())}&sort=-last_activity_at`,
  );
  if (data === null) return null;
  const rows = Array.isArray(data?.payload) ? data.payload : [];
  return rows.slice(0, limit).map((r) => ({
    id: typeof r.id === "number" ? r.id : 0,
    name: typeof r.name === "string" ? r.name : "",
    phone: typeof r.phone_number === "string" ? r.phone_number : "",
    email: typeof r.email === "string" ? r.email : "",
    labels: [],
    attributes: { ...asRecord(r.additional_attributes), ...asRecord(r.custom_attributes) },
  }));
}

/** Labels of one contact (e.g. «رحلة جورجيا», «VIP»). [] on failure. */
export async function getTeletelContactLabels(contactId: number): Promise<string[]> {
  const config = getTeletelConfig();
  if (!config || !contactId) return [];
  const data = await api<{ payload?: unknown[] }>(config, `/contacts/${contactId}/labels`);
  return Array.isArray(data?.payload) ? data.payload.filter((l): l is string => typeof l === "string") : [];
}

// ---------- a client's WhatsApp thread (the owner, 2026-10-15) ----------

/**
 * A phone as WhatsApp knows it: "+9665…". A Saudi «05…» or «5…» number gains
 * its country code; anything else keeps its own digits. Null when too short to
 * be a number.
 */
export function intlPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("05")) d = `966${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("5")) d = `966${d}`;
  return d.length >= 8 ? `+${d}` : null;
}

let whatsappInboxId: number | null | undefined;

/** The WhatsApp inbox clients are written from: TELETEL_WHATSAPP_INBOX_ID, else the account's first WhatsApp inbox. */
async function whatsappInbox(config: TeletelConfig): Promise<number | null> {
  const fixed = Number(readEnv("TELETEL_WHATSAPP_INBOX_ID"));
  if (fixed > 0) return fixed;
  if (whatsappInboxId !== undefined) return whatsappInboxId;
  const res = await api<{ payload?: { id?: number; channel_type?: string }[] }>(config, "/inboxes");
  if (res === null) return null; // not cached: Teletel was unreachable, not empty
  whatsappInboxId = res.payload?.find((i) => i.channel_type === "Channel::Whatsapp")?.id ?? null;
  return whatsappInboxId;
}

export type ClientThread = {
  conversationId: number;
  /**
   * WhatsApp's 24-hour rule: false when the client has not written in the last
   * 24 hours — only an approved template may then reach them.
   */
  canReply: boolean;
};

/**
 * The client's thread on the company WhatsApp: their most recent conversation
 * in that inbox — or, for a number Teletel has never seen, a new contact and a
 * new conversation (its WhatsApp source id is the number's digits). Null when
 * Teletel cannot be reached or refuses.
 */
export async function clientThread(phone: string, name: string): Promise<ClientThread | null> {
  const config = getTeletelConfig();
  const intl = intlPhone(phone);
  if (!config || !intl) return null;
  const inbox = await whatsappInbox(config);
  if (!inbox) return null;
  const digits = intl.slice(1);

  const hits = await searchTeletelContacts(digits.slice(-9), 5);
  if (hits === null) return null;
  let contactId = hits.find((h) => h.phone.replace(/\D/g, "").endsWith(digits.slice(-9)))?.id ?? 0;
  let sourceId: string | null = null;
  if (!contactId) {
    const made = await api<{ payload?: { contact?: { id?: number }; contact_inbox?: { source_id?: string } } }>(config, "/contacts", {
      inbox_id: inbox,
      name: name.trim() || intl,
      phone_number: intl,
    });
    contactId = made?.payload?.contact?.id ?? 0;
    sourceId = made?.payload?.contact_inbox?.source_id ?? null;
    if (!contactId) return null;
  }

  const listed = await api<{ payload?: { id?: number; inbox_id?: number; can_reply?: boolean }[] }>(config, `/contacts/${contactId}/conversations`);
  const current = (listed?.payload ?? []).find((c) => c.inbox_id === inbox && typeof c.id === "number");
  if (current?.id) return { conversationId: current.id, canReply: current.can_reply === true };

  if (!sourceId) {
    const ci = await api<{ source_id?: string }>(config, `/contacts/${contactId}/contact_inboxes`, { inbox_id: inbox, source_id: digits });
    sourceId = ci?.source_id ?? digits;
  }
  const opened = await api<{ id?: number; can_reply?: boolean }>(config, "/conversations", {
    source_id: sourceId,
    inbox_id: inbox,
    contact_id: contactId,
    status: "open",
  });
  return opened?.id ? { conversationId: opened.id, canReply: opened.can_reply === true } : null;
}

/** A note on the thread that only the team sees. */
export async function addTeletelNote(conversationId: number, text: string): Promise<boolean> {
  const config = getTeletelConfig();
  if (!config || !text.trim()) return false;
  const res = await api<{ id?: number }>(config, `/conversations/${conversationId}/messages`, {
    content: text,
    message_type: "outgoing",
    private: true,
  });
  return typeof res?.id === "number";
}

/** Add labels to a thread, keeping the ones it has (the API sets the whole list). */
export async function addTeletelLabels(conversationId: number, labels: string[]): Promise<boolean> {
  const config = getTeletelConfig();
  if (!config || labels.length === 0) return false;
  const now = await api<{ payload?: unknown[] }>(config, `/conversations/${conversationId}/labels`);
  const have = (now?.payload ?? []).filter((l): l is string => typeof l === "string");
  const all = [...new Set([...have, ...labels])];
  if (all.length === have.length) return true;
  return (await api<unknown>(config, `/conversations/${conversationId}/labels`, { labels: all })) !== null;
}

// ---------- SLA: the open conversations and one thread (sla.ts) ----------

/** One open conversation, as the SLA board reads it. Times are unix seconds (0 / null: none). */
export type OpenConversation = {
  id: number;
  inboxId: number;
  contactId: number | null;
  /** «نوع الخدمة» the client picked in the WhatsApp menu (the contact's service_type_list: طيران، فنادق، بكج سياحي، تأشيره) */
  serviceType: string | null;
  name: string;
  phone: string;
  assignee: string | null;
  /** for a note that mentions them — Teletel notifies the one mentioned */
  assigneeId: number | null;
  team: string | null;
  teamId: number | null;
  /** since when the client has waited for our reply — 0 when we spoke last */
  waitingSince: number;
  firstReplyAt: number | null;
  lastActivityAt: number;
  createdAt: number;
  /** inside WhatsApp's 24 hours: a free text reaches them, else only a template */
  canReply: boolean;
  preview: string;
  /** the conversation's Teletel labels («رحلة ماليزيا»…) — «العملاء» classifies by them */
  labels: string[];
};

type RawConversation = {
  id?: number;
  inbox_id?: number;
  can_reply?: boolean;
  waiting_since?: number | null;
  first_reply_created_at?: number | null;
  last_activity_at?: number;
  created_at?: number;
  last_non_activity_message?: { content?: string | null } | null;
  labels?: string[];
  meta?: {
    sender?: { id?: number; name?: string | null; phone_number?: string | null; custom_attributes?: Record<string, unknown> | null };
    assignee?: { id?: number; name?: string | null } | null;
    team?: { id?: number; name?: string | null } | null;
  };
};

type OpenList = { rows: OpenConversation[]; at: number };
let openCache: OpenList | null = null;
let openLoading: Promise<OpenList | null> | null = null;

/**
 * Every OPEN conversation, all pages (25 a page, the API's fixed size) — about
 * twenty-six requests for the 600-odd the company keeps open.
 *
 * Six in flight at a time, twenty seconds each, one more try for a page that
 * failed: measured from the server, Teletel answers one page in under two
 * seconds but all at once in six to eight, and a third of them ran past the
 * old eight-second limit — the live board said «تعذّر الوصول» while the same
 * code worked from a laptop. Six at a time: about ten seconds, none lost.
 *
 * Kept, with the time it was read: an older copy is served at once and
 * refreshed behind it (five minutes), so only the first look of a fresh
 * process — or «تحديث» — waits. Null when Teletel cannot be read (the board
 * says so; it never shows a partial list as the whole).
 */
export async function listOpenConversations(fresh = false): Promise<OpenList | null> {
  if (!fresh && openCache) {
    if (Date.now() - openCache.at > 5 * 60_000 && !openLoading) void loadOpen();
    return openCache;
  }
  return loadOpen();
}

function loadOpen(): Promise<OpenList | null> {
  // one read at a time, whoever asks: the board, its refresh, a manual follow-up
  openLoading ??= readOpen().finally(() => {
    openLoading = null;
  });
  return openLoading;
}

async function readOpen(): Promise<OpenList | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  type Page = { data?: { meta?: { all_count?: number }; payload?: RawConversation[] } };
  const page = async (n: number) =>
    (await api<Page>(config, `/conversations?status=open&assignee_type=all&page=${n}`, undefined, 20_000)) ??
    (await api<Page>(config, `/conversations?status=open&assignee_type=all&page=${n}`, undefined, 20_000));
  const first = await page(1);
  if (!first?.data) return null;
  const raw = [...(first.data.payload ?? [])];
  const pages = Math.ceil((first.data.meta?.all_count ?? raw.length) / Math.max(raw.length, 1));
  const queue = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
  const got: (Page | null)[] = [];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) got.push(await page(n));
    }),
  );
  if (got.some((b) => !b?.data)) return null;
  for (const b of got) raw.push(...(b?.data?.payload ?? []));
  const seen = new Set<number>();
  const rows: OpenConversation[] = [];
  for (const c of raw) {
    if (typeof c.id !== "number" || seen.has(c.id)) continue;
    seen.add(c.id);
    const sender = c.meta?.sender;
    rows.push({
      id: c.id,
      inboxId: c.inbox_id ?? 0,
      contactId: typeof sender?.id === "number" ? sender.id : null,
      serviceType: [sender?.custom_attributes?.["service_type_list"], sender?.custom_attributes?.["service_type"]].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null,
      name: sender?.name?.trim() || sender?.phone_number || `#${c.id}`,
      phone: sender?.phone_number ?? "",
      assignee: c.meta?.assignee?.name ?? null,
      assigneeId: typeof c.meta?.assignee?.id === "number" ? c.meta.assignee.id : null,
      team: c.meta?.team?.name ?? null,
      teamId: typeof c.meta?.team?.id === "number" ? c.meta.team.id : null,
      waitingSince: c.waiting_since ?? 0,
      firstReplyAt: c.first_reply_created_at || null,
      lastActivityAt: c.last_activity_at ?? 0,
      createdAt: c.created_at ?? 0,
      canReply: c.can_reply === true,
      preview: (c.last_non_activity_message?.content ?? "").slice(0, 160),
      labels: Array.isArray(c.labels) ? c.labels : [],
    });
  }
  openCache = { at: Date.now(), rows };
  return openCache;
}

export type TeletelTeam = { id: number; name: string };
let teamsCache: { at: number; teams: TeletelTeam[] } | null = null;

/** The account's teams («قسم المبيعات»، «متابعة المبيعات»…) — what an SLA rule may move a conversation to. Kept ten minutes. */
export async function listTeletelTeams(): Promise<TeletelTeam[]> {
  if (teamsCache && Date.now() - teamsCache.at < 10 * 60_000) return teamsCache.teams;
  const config = getTeletelConfig();
  if (!config) return [];
  const res = await api<{ id?: number; name?: string }[]>(config, "/teams");
  if (!Array.isArray(res)) return teamsCache?.teams ?? [];
  const teams = res.filter((t) => typeof t.id === "number" && t.name).map((t) => ({ id: t.id as number, name: (t.name as string).trim() }));
  teamsCache = { at: Date.now(), teams };
  return teams;
}

/**
 * Hand a conversation to a team — the SLA move «ينقل إلى فريق في Teletel».
 * Teletel drops the agent when they are not in that team (tried 2026-10-18 on
 * the owner's test conversation: «احمد القدسي» → none), so it lands in the
 * team's queue unassigned unless the team auto-assigns.
 */
export async function assignTeletelTeam(conversationId: number, teamId: number): Promise<boolean> {
  const config = getTeletelConfig();
  if (!config) return false;
  return (await api<unknown>(config, `/conversations/${conversationId}/assignments`, { team_id: teamId })) !== null;
}

/** The conversation read by us (the agent's «last seen») — WhatsApp's blue ticks where Teletel passes them on. */
export async function markTeletelSeen(conversationId: number): Promise<boolean> {
  const config = getTeletelConfig();
  return config ? (await api<unknown>(config, `/conversations/${conversationId}/update_last_seen`, {})) !== null : false;
}

/** «يكتب…» on or off, where the channel shows it. */
export async function setTeletelTyping(conversationId: number, on: boolean): Promise<boolean> {
  const config = getTeletelConfig();
  return config ? (await api<unknown>(config, `/conversations/${conversationId}/toggle_typing_status`, { typing_status: on ? "on" : "off" })) !== null : false;
}

export type ConversationEvent = { id: number; at: number; kind: "client" | "agent" | "activity"; text: string; sender: string | null; isPrivate: boolean };

/**
 * A thread with its activity lines («تم إسنادها إلى X بواسطة Y») — who held a
 * conversation and when they answered. `pages` reads that many pages back
 * from the latest (twenty messages each), oldest first.
 */
export async function conversationEvents(conversationId: number, pages = 1): Promise<ConversationEvent[] | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  type Raw = { id?: number; created_at?: number; content?: string | null; message_type?: number; private?: boolean; sender?: { name?: string | null } | null };
  const list = await api<{ payload?: Raw[] }>(config, `/conversations/${conversationId}/messages`);
  if (!list) return null;
  let raw = list.payload ?? [];
  for (let page = 1; page < pages && raw.length; page += 1) {
    const oldest = Math.min(...raw.map((m) => m.id ?? Infinity));
    const older = await api<{ payload?: Raw[] }>(config, `/conversations/${conversationId}/messages?before=${oldest}`);
    if (!older?.payload?.length) break;
    raw = [...older.payload, ...raw];
  }
  return raw.map((m) => ({
    id: m.id ?? 0,
    at: m.created_at ?? 0,
    kind: m.message_type === 0 ? "client" : m.message_type === 2 ? "activity" : "agent",
    text: m.content?.trim() ?? "",
    sender: m.sender?.name ?? null,
    isPrivate: m.private === true,
  }));
}

export type ThreadMessage = { id: number; at: number; text: string; fromClient: boolean; sender: string | null; isPrivate: boolean };

/**
 * A thread's latest messages, oldest first (the API's last page; `pages` more
 * than one reads further back, «العملاء» reading what the client wrote) —
 * activity lines left out.
 */
export async function conversationThread(conversationId: number, pages = 1, since?: number): Promise<{ messages: ThreadMessage[]; canReply: boolean; historyComplete: boolean } | null> {
  const config = getTeletelConfig();
  if (!config) return null;
  type Raw = { id?: number; created_at?: number; content?: string | null; message_type?: number; private?: boolean; sender?: { name?: string | null } | null; attachments?: unknown[] };
  const [list, conv] = await Promise.all([
    api<{ payload?: Raw[] }>(config, `/conversations/${conversationId}/messages`),
    api<{ can_reply?: boolean }>(config, `/conversations/${conversationId}`),
  ]);
  if (!list) return null;
  let raw = list.payload ?? [];
  let historyComplete = raw.length === 0 || (since !== undefined && raw.some((m) => (m.created_at ?? Infinity) <= since));
  for (let page = 1; page < pages && raw.length; page += 1) {
    if (since !== undefined && historyComplete) break;
    const oldest = Math.min(...raw.map((m) => m.id ?? Infinity));
    const older = await api<{ payload?: Raw[] }>(config, `/conversations/${conversationId}/messages?before=${oldest}`);
    if (!older) return null;
    if (!older.payload?.length) { historyComplete = true; break; }
    raw = [...older.payload, ...raw];
    if (since !== undefined && raw.some((m) => (m.created_at ?? Infinity) <= since)) historyComplete = true;
  }
  const messages = raw
    .filter((m) => typeof m.id === "number" && m.message_type !== 2)
    .map((m) => ({
      id: m.id as number,
      at: m.created_at ?? 0,
      text: m.content?.trim() || (m.attachments?.length ? "📎" : ""),
      fromClient: m.message_type === 0,
      sender: m.sender?.name ?? null,
      isPrivate: m.private === true,
    }));
  return { messages, canReply: conv?.can_reply === true, historyComplete };
}

// ---------- pure destination inference (unit-tested) ----------

/** «رحلة جورجيا» / «برنامج تركيا» / «بكج دبي» → the destination word(s). */
const TRIP_PREFIX = /^(?:رحلة|برنامج|بكج|باقة)\s+(.+)$/;

/** Attribute keys whose plain value IS a destination/classification. */
const DEST_KEYS = /^(destination|country|category|الوجهة|الدولة|التصنيف|الفئة)$/i;

/**
 * Derive destination suggestions from a contact's labels + attributes.
 * Never invents: only explicit trip-prefixed texts or destination-named fields.
 */
export function inferDestinations(labels: string[], attributes: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const s = v.trim();
    if (s && s.length <= 40 && !out.includes(s)) out.push(s);
  };
  const fromText = (text: string) => {
    const m = text.trim().match(TRIP_PREFIX);
    if (m) push(m[1]);
  };

  for (const label of labels) fromText(label);
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (DEST_KEYS.test(key.trim())) {
      const m = value.trim().match(TRIP_PREFIX);
      push(m ? m[1] : value);
    } else {
      fromText(value);
    }
  }
  return out.slice(0, 4);
}

/** Assign a configured handoff, optionally to a named Teletel agent. */
export async function assignMuradHandoff(conversationId: number, teamId: number | null, agentId: number | null): Promise<boolean> {
  const config = getTeletelConfig();
  if (!config || (!teamId && !agentId)) return false;
  return (await api<unknown>(config, `/conversations/${conversationId}/assignments`, { team_id: teamId, assignee_id: agentId })) !== null;
}
