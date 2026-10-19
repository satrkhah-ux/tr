import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { allRows } from "./all-rows";

/**
 * «رؤية للإعلانات»: the Google Ads account's numbers (0108, posted hourly by
 * the owner's script) for the page to set beside the conversations. Spend is
 * internal: read through the service role, for whoever holds the management
 * dashboard (dashboard.admin) only — everyone else sees the conversations side.
 */
export type AdDay = { day: string; campaign: string; status: string | null; cost: number; clicks: number; impressions: number; conversions: number; final: boolean };
export type AdTop = { label: string; clicks: number };
export type AdsData = {
  currency: string;
  /** the latest post */
  updatedAt: string | null;
  rows: AdDay[];
  /** phase 2 — the last 30 days: where the clicks were, what was searched, the hour */
  countries: AdTop[];
  cities: AdTop[];
  terms: AdTop[];
  hours: number[];
};

const DAYS = 120;

export async function adsData(): Promise<AdsData | null> {
  if (!(await currentCan("dashboard.admin"))) return null;
  try {
    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    const since = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    // every page of each (all-rows.ts): PostgREST stops at a thousand — the tab once showed July and none of this week
    const [stats, locs, terms, hours] = await Promise.all([
      allRows((a, b) => db.from("ad_stats").select("day, campaign, status, cost, clicks, impressions, conversions, final, currency, updated_at").gte("day", since(DAYS)).or("cost.gt.0,clicks.gt.0").order("day").order("campaign").range(a, b)),
      allRows((a, b) => db.from("ad_locations").select("country, city, clicks").gte("day", since(30)).order("day").order("campaign").order("country").order("city").range(a, b)),
      allRows((a, b) => db.from("ad_search_terms").select("term, clicks").gte("day", since(30)).order("day").order("campaign").order("term").range(a, b)),
      allRows((a, b) => db.from("ad_hours").select("hour, clicks").gte("day", since(30)).order("day").order("campaign").order("hour").range(a, b)),
    ]);
    const raw = (stats.data ?? []) as (AdDay & { currency: string | null; updated_at: string })[];
    const sum = (list: { key: string; clicks: number }[]) => {
      const m = new Map<string, number>();
      for (const { key, clicks } of list) if (key) m.set(key, (m.get(key) ?? 0) + Number(clicks));
      return [...m].map(([label, clicks]) => ({ label, clicks })).sort((a, b) => b.clicks - a.clicks).slice(0, 15);
    };
    const loc = (locs.data ?? []) as { country: string; city: string; clicks: number }[];
    const hourly = Array.from({ length: 24 }, () => 0);
    for (const h of (hours.data ?? []) as { hour: number; clicks: number }[]) hourly[h.hour] += Number(h.clicks);
    return {
      currency: raw.find((r) => r.currency)?.currency ?? "USD",
      updatedAt: raw.reduce<string | null>((latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest), null),
      rows: raw.map((r) => ({ day: r.day, campaign: r.campaign, status: r.status, cost: Number(r.cost), clicks: Number(r.clicks), impressions: Number(r.impressions), conversions: Number(r.conversions), final: r.final })),
      countries: sum(loc.filter((l) => !l.city).map((l) => ({ key: l.country, clicks: l.clicks }))),
      cities: sum(loc.filter((l) => l.city).map((l) => ({ key: l.city, clicks: l.clicks }))),
      terms: sum(((terms.data ?? []) as { term: string; clicks: number }[]).map((t) => ({ key: t.term, clicks: t.clicks }))),
      hours: hourly,
    };
  } catch {
    return null;
  }
}
