import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { resolvePlace } from "@/lib/leads/places";
import type { Place } from "@/lib/leads/auto";
import { ttlCache } from "@/lib/ttl-cache";
import { alertText, normalizeConfig, positionOf, riyadhDay, SCREENS_SETTING, tickerText, tickerWidth, topCountries, type ScreensConfig } from "./config";

/**
 * «الشاشات» — what a screen reads, every few seconds, with no login (the owner,
 * 2026-10-19: pkg.traveliun.com/1 just opens). So it carries only what is safe
 * to show anyone in the office window: the ads, the destinations asked for and
 * their kind — never a name, a phone or a count per client. One answer is built
 * for all the screens and kept two seconds; the ticker is counted every three
 * minutes; the catalogue's places every ten.
 */
export type ScreenState = {
  now: number;
  build: string;
  screens: number;
  position: number;
  slotMs: number;
  ads: { src: string; name: string }[];
  /** the band: its words, their room, its speed, how often it comes up, and the extra pass when the words changed */
  ticker: { text: string; width: number; speed: number; periodMs: number; bumpAt: number } | null;
  events: { at: number; text: string; src: string | null }[];
  /** while the TVs are set up: on every load, one pass and then this alert, on that screen only — never stored, never counted */
  demo: { text: string; src: string | null } | null;
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

/** today's and yesterday's conversations by destination (the ticker) */
async function ticker(now: number, speed: number, periodMs: number): Promise<{ band: ScreenState["ticker"]; top: string | null }> {
  const { text, top } = await memo(slow, "ticker", async () => {
    const since = new Date(riyadhDay(now) - 86_400_000).toISOString();
    const [{ data }, list] = await Promise.all([
      db().from("client_leads").select("destination, created_at, last_visit_at").or(`created_at.gte.${since},last_visit_at.gte.${since}`).limit(1000),
      places(),
    ]);
    const leads = ((data ?? []) as { destination: string | null; created_at: string; last_visit_at: string | null }[]).flatMap((l) => {
      const country = countryOf(l.destination, list);
      if (!country) return [];
      const days = [l.created_at, l.last_visit_at].filter((d): d is string => Boolean(d)).map((d) => riyadhDay(Date.parse(d)));
      return [{ country, days }];
    });
    return { text: tickerText(leads, now) ?? "", top: topCountries(leads, riyadhDay(now))[0] ?? null };
  });
  if (lastWords === null) lastWords = text;
  else if (text !== lastWords) {
    lastWords = text;
    if (now - bumpAt >= 120_000) bumpAt = now + 5_000;
  }
  return { band: text ? { text, width: tickerWidth(text), speed, periodMs, bumpAt } : null, top };
}

async function shared(now: number): Promise<Shared> {
  return memo(cache, "shared", async () => {
    const cfg = await readScreensConfig();
    const ads = cfg.ads.filter((a) => a.active).map((a) => ({ src: `/screen/ad/${a.id}.jpg`, name: a.name }));
    const [list, tick, { data: rows }] = await Promise.all([
      places(),
      ticker(now, cfg.tickerSpeed, cfg.tickerEveryMin * 60_000),
      db()
        .from("office_screen_events")
        .select("kind, destination, test, at")
        .gte("at", new Date(now - 60_000).toISOString())
        .lte("at", new Date(now + 600_000).toISOString())
        .order("at"),
    ]);
    const adCountry = ads.map((a) => countryOf(a.name, list));
    const events = ((rows ?? []) as { kind: string; destination: string; test: boolean; at: string }[]).flatMap((e) => {
      if (!e.test && !cfg.kinds.includes(e.kind)) return [];
      const country = countryOf(e.destination, list);
      if (!country) return [];
      const ad = ads[adCountry.indexOf(country)];
      return [{ at: Date.parse(e.at), text: alertText(e.kind, country, e.test), src: ad?.src ?? null }];
    });
    const demoCountry = tick.top ?? "تركيا";
    const demo = now < Date.parse(cfg.demoUntil) ? { text: alertText("بكج", demoCountry, false), src: ads[adCountry.indexOf(demoCountry)]?.src ?? null } : null;
    return { cfg, build: String(process.env.NEXT_DEPLOYMENT_ID || ""), screens: cfg.screens, slotMs: cfg.slotSec * 1000, ads, ticker: tick.band, events, demo };
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
