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

async function api<T>(config: TeletelConfig, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${config.baseUrl}/api/v1/accounts/${config.accountId}${path}`, {
      headers: { api_access_token: config.token },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Contact search (name / phone / email). Returns [] on any failure. */
export async function searchTeletelContacts(query: string, limit = 6): Promise<TeletelContact[]> {
  const config = getTeletelConfig();
  if (!config || !query.trim()) return [];
  const data = await api<{ payload?: RawContact[] }>(
    config,
    `/contacts/search?q=${encodeURIComponent(query.trim())}&sort=-last_activity_at`,
  );
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
