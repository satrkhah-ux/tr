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
async function api<T>(config: TeletelConfig, path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${config.baseUrl}/api/v1/accounts/${config.accountId}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? { api_access_token: config.token }
          : { api_access_token: config.token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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
