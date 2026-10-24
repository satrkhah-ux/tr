import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { resolvePlace } from "@/lib/leads/places";
import type { Place } from "@/lib/leads/auto";
import { ttlCache } from "@/lib/ttl-cache";
import { displayName, serviceLine, normalizeConfig, positionOf, riyadhDay, SCREENS_SETTING, tickerText, tickerWidth, countryRanking, type ScreensConfig } from "./config";
import { landmarkFor } from "./landmarks";

/**
 * «الشاشات» — what a screen reads, every few seconds, with no login (the owner,
 * 2026-10-19: pkg.traveliun.com/1 just opens). So it carries only what is safe
 * to show anyone in the office window: the ads, the destinations asked for and
 * their kind and the owner's requested short display name — never a phone
 * or other customer details. One answer is built
 * for all the screens and kept two seconds; the ticker is counted every three
 * minutes; the catalogue's places every ten.
 */
export type ScreenState = {
  countries: string[];
  countryStats?: { country: string; count: number }[];
  now: number;
  build: string;
  screens: number;
  position: number;
  slotMs: number;
  ads: { src: string; name: string }[];
  /** the band: its words, their room, its speed, how often it comes up, and the extra pass when the words changed */
  ticker: { text: string; width: number; speed: number; periodMs: number; bumpAt: number } | null;
  /** «بكج إلى تركيا» and the client's recorded name, three words at most (never a phone), «تجربة» when it is one */
  events: { id: string; at: number; country: string; line: string; name: string | null; test: boolean; src: string | null; walkIn?: boolean }[];
  /** while the TVs are set up: on every load, one pass and then this alert, on that screen only — never stored, never counted */
  demo: { country: string; line: string; name: string; src: string | null } | null;
};

type Shared = Omit<ScreenState, "now" | "position"> & { cfg: ScreensConfig };

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const cache = ttlCache<string, unknown>(2_000, 20);
const slow = ttlCache<string, unknown>(180_000, 20);

async function memo<T>(c: typeof cache, key: string, make: () => Promise<T>): Promise<T> {
  const hit = c.get(key) as T | undefined;
  if (hit !== undefined) return hit;
  const value = await make();
  c.set(key, value);
  return value;
}

export async function readScreensConfig(): Promise<ScreensConfig> {
  const { data } = await db().from("app_settings").select("value").eq("key", SCREENS_SETTING).maybeSingle();
  try {
    return normalizeConfig(JSON.parse((data as { value?: string } | null)?.value ?? "{}"));
  } catch {
    return normalizeConfig(null);
  }
}

const places = () => memo(slow, "places", () => loadPlaces(db()).catch((): Place[] => []));

const countryOf = (text: string | null | undefined, list: Place[]) => {
  const r = resolvePlace(text, list);
  return r.kind === "destination" ? r.country : null;
};

// «عند الخبر»: when the words change the band runs once more, from a moment every screen shares
// (5 s ahead: each has polled by then), at most once in two minutes
let lastWords: string | null = null;
let bumpAt = 0;

/**
 * The countries we actually sell: those with an active offer in «العروض الجاهزة»,
 * in the leads' own spelling. Null when it cannot be read, or nothing is on sale —
 * then nothing is filtered rather than the screens going blank.
 */
async function soldCountries(list: Place[]): Promise<Set<string> | null> {
  const { data, error } = await db().from("ready_offers").select("country").eq("active", true);
  if (error) return null;
  const sold = new Set(((data ?? []) as { country: string | null }[]).map((r) => countryOf(r.country, list)).filter((c): c is string => Boolean(c)));
  return sold.size ? sold : null;
}

/**
 * today's and yesterday's conversations by destination (the ticker and «الأكثر طلباً اليوم») —
 * only countries we have a package for (the user, 2026-10-24: a client in the office saw
 * «المانيا» on the screen and we had nothing for Germany)
 */
async function ticker(now: number, speed: number, periodMs: number): Promise<{ band: ScreenState["ticker"]; top: string | null; countries: string[]; stats: NonNullable<ScreenState["countryStats"]> }> {
  const { text, top, countries, stats } = await memo(slow, `ticker:${riyadhDay(now)}`, async () => {
    const since = new Date(riyadhDay(now) - 86_400_000).toISOString();
    const data: { destination: string | null; created_at: string; last_visit_at: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await db().from("client_leads").select("destination, created_at, last_visit_at").or(`created_at.gte.${since},last_visit_at.gte.${since}`).order("id").range(from, from + 999);
      if (page.error) throw new Error("screen countries unavailable");
      data.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < 1000) break;
    }
    const list = await places();
    const sold = await soldCountries(list);
    const leads = ((data ?? []) as { destination: string | null; created_at: string; last_visit_at: string | null }[]).flatMap((l) => {
      const country = countryOf(l.destination, list);
      if (!country || (sold && !sold.has(country))) return [];
      const days = [l.created_at, l.last_visit_at].filter((d): d is string => Boolean(d)).map((d) => riyadhDay(Date.parse(d)));
      return [{ country, days }];
    });
    const stats = countryRanking(leads, riyadhDay(now));
    const countries = stats.map((r) => r.country);
    return { text: tickerText(leads, now) ?? "", top: countries[0] ?? null, countries, stats };
  });
  if (lastWords === null) lastWords = text;
  else if (text !== lastWords) {
    lastWords = text;
    if (now - bumpAt >= 120_000) bumpAt = now + 5_000;
  }
  return { band: text ? { text, width: tickerWidth(text), speed, periodMs, bumpAt } : null, top, countries, stats };
}

/** «الأكثر طلباً اليوم»: today's countries by conversations, with each one's local photo — the screens' own count */
export async function topCountriesToday(): Promise<{ country: string; count: number; src: string }[]> {
  const { stats } = await ticker(Date.now(), SCREENS_DEFAULT_SPEED, 600_000);
  return stats.map((r) => ({ ...r, src: landmarkFor(r.country) }));
}
const SCREENS_DEFAULT_SPEED = 110;

async function shared(now: number): Promise<Shared> {
  return memo(cache, "shared", async () => {
    const cfg = await readScreensConfig();
    const ads = cfg.ads.filter((a) => a.active).map((a) => ({ src: `/screen/ad/${a.id}.jpg`, name: a.name }));
    const [list, tick, { data: rows }] = await Promise.all([
      places(),
      ticker(now, cfg.tickerSpeed, cfg.tickerEveryMin * 60_000),
      db()
        .from("office_screen_events")
        .select("id, lead_id, draft_id, name, kind, destination, test, at")
        .gte("at", new Date(now - 300_000).toISOString())
        .lte("at", new Date(now + 600_000).toISOString())
        .order("at"),
    ]);
    const evs = (rows ?? []) as { id: number; lead_id: string | null; draft_id: string | null; name: string | null; kind: string; destination: string; test: boolean; at: string }[];
    // the client's name as recorded on «العملاء», three words at most (displayName) — never anything else about them
    const ids = [...new Set(evs.map((e) => e.lead_id).filter((id): id is string => Boolean(id)))];
    const { data: named } = ids.length ? await db().from("client_leads").select("id, name").in("id", ids) : { data: [] };
    const nameOf = new Map(((named ?? []) as { id: string; name: string | null }[]).map((l) => [l.id, displayName(l.name)]));
    const events = evs.flatMap((e) => {
      // a walk-in is the agent's own announcement, whatever kinds the settings let alert
      if (!e.test && !e.draft_id && !cfg.kinds.includes(e.kind)) return [];
      const country = countryOf(e.destination, list);
      if (!country) return [];
      return [{ id: String(e.id), at: Date.parse(e.at), country, line: serviceLine(e.kind, country), name: e.draft_id ? displayName(e.name) : e.lead_id ? (nameOf.get(e.lead_id) ?? null) : null, test: e.test, src: landmarkFor(country), ...(e.draft_id ? { walkIn: true } : {}) }];
    });
    const demoCountry = tick.top ?? "تركيا";
    const demo = now < Date.parse(cfg.demoUntil) ? { country: demoCountry, line: serviceLine("بكج", demoCountry), name: "أحمد العتيبي", src: landmarkFor(demoCountry) } : null;
    return { cfg, build: String(process.env.NEXT_DEPLOYMENT_ID || ""), screens: cfg.screens, slotMs: cfg.slotSec * 1000, ads, countries: tick.countries, countryStats: tick.stats, ticker: tick.band, events, demo };
  });
}

/** screen n's state, or null when the office has no screen n */
export async function screenState(n: number): Promise<ScreenState | null> {
  const now = Date.now();
  const s = await shared(now);
  const position = positionOf(s.cfg, n);
  if (position < 0) return null;
  const { cfg: _cfg, ...rest } = s;
  void _cfg;
  return { ...rest, now: Date.now(), position };
}

/** «جرّب الإشعار»: a test event, marked «تجربة» on the screens, never a request */
export async function insertTestEvent(destination: string): Promise<boolean> {
  const { data: at } = await db().rpc("office_screen_next_at");
  const { error } = await db().from("office_screen_events").insert({ kind: "بكج", destination, test: true, at: at ?? new Date().toISOString() });
  cache.clear();
  return !error;
}

/** «عميلنا محمد طلب بكج إلى جورجيا»: a client in the office, once per file; false when it was already shown or failed */
export async function insertWalkInEvent(draftId: string, name: string, destination: string): Promise<boolean> {
  const { data: at } = await db().rpc("office_screen_next_at");
  const { error } = await db().from("office_screen_events").insert({ draft_id: draftId, name: displayName(name), kind: "بكج", destination, at: at ?? new Date().toISOString() });
  cache.clear();
  return !error;
}

export function forgetScreens(): void {
  cache.clear();
}

/** a screen polls every 4 s; an office of TVs behind one address is far below this */
const hits = new Map<string, { n: number; since: number }>();
export function allowScreenRequest(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, since: now });
    return true;
  }
  h.n += 1;
  return h.n <= 300;
}
