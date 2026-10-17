/**
 * «لوحتي» — the numbers of ONE account's own files.
 *
 * Pure: no React, no Supabase, and "this month" is computed from a date the
 * caller passes (the server's, in Riyadh), so a file issued at 01:30 on the 1st
 * counts in the company's month, not in the browser's. The rows arrive already
 * filtered to the signed-in employee (data/my-dashboard.ts) and carry SELL
 * totals only — nothing here can surface a cost.
 */

import { catalogSkel, normAr } from "@/lib/catalog/norm";
import type { StageKey } from "@/lib/offer/draft-types";
import type { OfferStatus } from "@/lib/types";

export type MyOperation = { id: string; clientStatus: string; executionStatus: string; live: boolean };

export type MyOffer = {
  id: string;
  serial: string;
  customerId: string | null;
  client: string | null;
  phone: string | null;
  /** as typed on the offer — a country, a city, or «تبليسي +باتومي» */
  destination: string | null;
  /** the destination resolved to a country (countryResolver) — what «أكثر الدول» counts */
  country: string | null;
  cities: string[];
  start: string | null;
  end: string | null;
  /** the sell total in its own currency */
  total: number | null;
  currency: string | null;
  /** the same sell total in riyals, so an average across currencies means something */
  totalSar: number;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
  operation: MyOperation | null;
};

export type MyDraft = {
  id: string;
  title: string | null;
  client: string | null;
  phone: string | null;
  country: string | null;
  cities: string[];
  start: string | null;
  end: string | null;
  total: number | null;
  currency: string | null;
  /** the steps still stopping the issue, in the form's order — empty: ready to issue */
  missing: StageKey[];
  updatedAt: string;
};

export type MyClient = {
  id: string;
  name: string | null;
  phone: string | null;
  offers: number;
  confirmed: number;
  firstAt: string;
  lastAt: string;
  countries: string[];
};

export type Count = { label: string; value: number };

/** What /dashboard hands «لوحتي» — loaded on the server by data/my-dashboard.ts. */
export type MyDashboard =
  | { ok: true; offers: MyOffer[]; drafts: MyDraft[]; clients: MyClient[]; stats: MyStats }
  | { ok: false; reason: "forbidden" | "noEmployee" | "error" };

export type MyStats = {
  issued: number;
  issuedThisMonth: number;
  incomplete: number;
  confirmed: number;
  /** confirmed files whose operation is still running (not travelled, not cancelled) */
  openOperations: number;
  clients: number;
  newClientsThisMonth: number;
  /** confirmed ÷ issued, 0–100 */
  conversion: number;
  /** mean sell value in riyals over the priced offers; null with none */
  avgSar: number | null;
  topCountries: Count[];
  topCities: Count[];
  /** the last 12 months, oldest first, zeros included — a gap is information */
  monthly: { month: string; value: number }[];
};

/** The month (YYYY-MM) a timestamp falls in, in Riyadh. */
export function riyadhMonth(at: string): string {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).slice(0, 7);
}

/** `n` months ending with `month`, oldest first. */
export function lastMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7));
}

/**
 * A client confirmed this file. Confirming writes both the operation and the
 * offer's status in one step (operations.ts recordConfirmation); either is enough.
 */
export function isConfirmed(o: Pick<MyOffer, "operation" | "status">): boolean {
  return o.operation !== null || o.status === "confirmed";
}

/**
 * Offers name their destination however the agent typed it: «ماليزيا», but also
 * «كوالالمبور» or «تايلند». Counting the raw text would split one country into
 * several bars. The catalogue answers it: a country by its name, a city by the
 * country it belongs to — folded (alef forms, ta marbuta) and, failing that, by
 * consonant skeleton («تايلند» = «تايلاند»). Unknown text stays as typed.
 */
export function countryResolver(countries: string[], cities: { name: string; country: string | null }[]) {
  const byName = new Map<string, string>();
  const bySkel = new Map<string, string>();
  const add = (name: string, country: string) => {
    const key = normAr(name);
    if (key && !byName.has(key)) byName.set(key, country);
    const skel = catalogSkel(name);
    // a two-letter skeleton matches too much to be evidence
    if (skel.length >= 3 && !bySkel.has(skel)) bySkel.set(skel, country);
  };
  for (const c of countries) add(c, c);
  for (const c of cities) if (c.country) add(c.name, c.country);
  const find = (v: string) => byName.get(normAr(v)) ?? bySkel.get(catalogSkel(v)) ?? null;

  return (o: { destination: string | null; cities: string[] }): string | null => {
    const typed = o.destination?.trim() || null;
    if (typed) {
      const hit = find(typed);
      if (hit) return hit;
    }
    for (const city of o.cities) {
      const hit = find(city);
      if (hit) return hit;
    }
    return typed;
  };
}

/** Most frequent first; spellings folded together, the first one seen is the label. */
function top(values: string[], limit: number): Count[] {
  const by = new Map<string, Count>();
  for (const v of values) {
    const key = normAr(v);
    if (!key) continue;
    const cur = by.get(key);
    if (cur) cur.value += 1;
    else by.set(key, { label: v.trim(), value: 1 });
  }
  return [...by.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ar")).slice(0, limit);
}

/** One row per client across my offers, the latest first. Offers with no client are not a client. */
export function clientsOf(offers: MyOffer[]): MyClient[] {
  const by = new Map<string, MyClient>();
  for (const o of offers) {
    if (!o.customerId) continue;
    const c = by.get(o.customerId);
    if (!c) {
      by.set(o.customerId, {
        id: o.customerId,
        name: o.client,
        phone: o.phone,
        offers: 1,
        confirmed: isConfirmed(o) ? 1 : 0,
        firstAt: o.createdAt,
        lastAt: o.createdAt,
        countries: o.country ? [o.country] : [],
      });
      continue;
    }
    c.offers += 1;
    if (isConfirmed(o)) c.confirmed += 1;
    if (o.createdAt < c.firstAt) c.firstAt = o.createdAt;
    if (o.createdAt > c.lastAt) c.lastAt = o.createdAt;
    if (o.country && !c.countries.includes(o.country)) c.countries.push(o.country);
  }
  return [...by.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function summarizeMine(offers: MyOffer[], drafts: number, today: string): MyStats {
  const month = today.slice(0, 7);
  const confirmed = offers.filter(isConfirmed);
  const clients = clientsOf(offers);
  const priced = offers.filter((o) => o.totalSar > 0);

  const perMonth = new Map<string, number>();
  for (const o of offers) {
    const m = riyadhMonth(o.createdAt);
    perMonth.set(m, (perMonth.get(m) ?? 0) + 1);
  }

  return {
    issued: offers.length,
    issuedThisMonth: perMonth.get(month) ?? 0,
    incomplete: drafts,
    confirmed: confirmed.length,
    openOperations: confirmed.filter((o) => o.operation?.live).length,
    clients: clients.length,
    newClientsThisMonth: clients.filter((c) => riyadhMonth(c.firstAt) === month).length,
    conversion: offers.length > 0 ? Math.round((confirmed.length / offers.length) * 100) : 0,
    avgSar: priced.length > 0 ? priced.reduce((s, o) => s + o.totalSar, 0) / priced.length : null,
    topCountries: top(offers.map((o) => o.country ?? ""), 8),
    // a city visited twice in one trip («بانكوك / فوكيت / بانكوك») is one trip there
    topCities: top(offers.flatMap((o) => [...new Map(o.cities.map((c) => [normAr(c), c])).values()]), 8),
    monthly: lastMonths(month, 12).map((m) => ({ month: m, value: perMonth.get(m) ?? 0 })),
  };
}
