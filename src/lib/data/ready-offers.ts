"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { createDraft } from "./drafts";
import type { DraftData } from "@/lib/offer/draft-types";
import { parseSheet } from "@/lib/ready-offers/parse";
import { buildSeed, type ParsedOffer, type ReadyOfferRecord, type SyncDiff, type Tier } from "@/lib/ready-offers/types";
import { currentCan } from "@/lib/roles/current";

/**
 * «العروض الجاهزة» — the company's prepared seasonal packages.
 *
 * Marketing maintains them in a Google Sheet (two tabs: economy / premium) and
 * broadcasts them to sales. `previewSync` reads the sheet and reports what would
 * change; `applySync` writes it. Rows that vanish from the sheet are deactivated
 * rather than deleted — a live draft may still point at one.
 */

const SHEET_ID = process.env.READY_OFFERS_SHEET_ID || "1Tq6pXH9hxjD4cuPC-W9YNf4-in9ncn8sP7avhSJHjNM";
const GIDS: Record<Tier, string> = {
  economy: process.env.READY_OFFERS_GID_ECONOMY || "800208440",
  premium: process.env.READY_OFFERS_GID_PREMIUM || "0",
};

const SELECT =
  "id, code, tier, title, country, variant, cities_summary, main_hotels, tours_text, domestic_flight, days, nights, price, currency, includes_text, excludes_text, validity_raw, valid_from, valid_to, design_url, status, active, seed, synced_at";

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

async function requireManage(): Promise<string | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return await currentCan("settings.manage") ? null : "ro.err.forbidden";
}

export async function listReadyOffers(includeInactive = false): Promise<ReadyOfferRecord[]> {
  try {
    const supabase = await db();
    let query = supabase.from("ready_offers").select(SELECT).order("tier").order("price", { ascending: true });
    if (!includeInactive) query = query.eq("active", true);
    const { data } = await query;
    return (data ?? []) as unknown as ReadyOfferRecord[];
  } catch {
    return [];
  }
}

/** Google publishes a 307 to googleusercontent; fetch follows it by default. */
async function fetchTab(tier: Tier): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GIDS[tier]}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`sheet ${tier}: HTTP ${res.status}`);
  const text = await res.text();
  // A permission-denied export returns an HTML sign-in page with HTTP 200.
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`sheet ${tier}: not publicly readable`);
  return text;
}

/** Fields compared to decide whether a stored row is stale. */
const COMPARED = [
  "title", "country", "variant", "cities_summary", "main_hotels", "tours_text",
  "domestic_flight", "days", "nights", "price", "includes_text", "excludes_text",
  "validity_raw", "valid_from", "valid_to", "status",
] as const;

function changedFields(parsed: ParsedOffer, stored: ReadyOfferRecord): string[] {
  const next = toRow(parsed, null) as Record<string, unknown>;
  const prev = stored as unknown as Record<string, unknown>;
  return COMPARED.filter((f) => (next[f] ?? null) !== (prev[f] ?? null));
}

function toRow(offer: ParsedOffer, id: string | null): Record<string, unknown> {
  return {
    code: offer.code,
    tier: offer.tier,
    title: offer.title,
    country: offer.country,
    variant: offer.variant,
    cities_summary: offer.cities_summary,
    main_hotels: offer.main_hotels,
    tours_text: offer.tours_text,
    domestic_flight: offer.domestic_flight,
    days: offer.days,
    nights: offer.nights,
    price: offer.price,
    currency: offer.currency,
    includes_text: offer.includes_text,
    excludes_text: offer.excludes_text,
    validity_raw: offer.validity_raw,
    valid_from: offer.valid_from,
    valid_to: offer.valid_to,
    status: offer.status,
    active: true,
    // the id is the seed's own anchor, so it can only be written once known
    seed: id ? buildSeed(offer, id) : null,
    source_row: offer.source_row,
    synced_at: new Date().toISOString(),
  };
}

async function readSheet(): Promise<{ offers: ParsedOffer[]; errors: SyncDiff["errors"] }> {
  const year = new Date().getUTCFullYear();
  const offers: ParsedOffer[] = [];
  const errors: SyncDiff["errors"] = [];
  for (const tier of ["economy", "premium"] as Tier[]) {
    try {
      const result = parseSheet(await fetchTab(tier), tier, year);
      offers.push(...result.offers);
      errors.push(...result.errors);
    } catch (e) {
      errors.push({ row: 0, tier, reason: e instanceof Error ? e.message : "fetch failed" });
    }
  }
  return { offers, errors };
}

export type PreviewResult = { ok: true; diff: SyncDiff } | { ok: false; error: string };

/** Read-only: fetches both tabs and reports what applySync would change. */
export async function previewSync(): Promise<PreviewResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const { offers, errors } = await readSheet();
    if (!offers.length) {
      return { ok: false, error: errors[0]?.reason ?? "err.db" };
    }
    const supabase = await db();
    const { data } = await supabase.from("ready_offers").select(SELECT);
    const stored = (data ?? []) as unknown as ReadyOfferRecord[];
    const byCode = new Map(stored.filter((r) => r.code).map((r) => [r.code as string, r]));
    const seen = new Set(offers.map((o) => o.code));

    const diff: SyncDiff = {
      added: [], changed: [], deactivated: [], unchanged: 0, errors,
      warnings: offers
        .filter((o) => o.warnings.length)
        .map((o) => ({ code: o.code, title: o.title, notes: o.warnings })),
    };
    for (const offer of offers) {
      const existing = byCode.get(offer.code);
      if (!existing) {
        diff.added.push(offer);
        continue;
      }
      const fields = changedFields(offer, existing);
      if (fields.length || !existing.active) diff.changed.push({ offer, fields });
      else diff.unchanged += 1;
    }
    for (const row of stored) {
      if (row.code && row.active && !seen.has(row.code)) {
        diff.deactivated.push({ code: row.code, title: row.title });
      }
    }
    return { ok: true, diff };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "err.db" };
  }
}

export type ApplyResult =
  | { ok: true; inserted: number; updated: number; deactivated: number }
  | { ok: false; error: string };

/** Re-reads the sheet server-side (never trusts a client-supplied payload). */
export async function applySync(): Promise<ApplyResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const { offers } = await readSheet();
    if (!offers.length) return { ok: false, error: "err.db" };
    const supabase = await db();
    const { data } = await supabase.from("ready_offers").select("id, code, design_url");
    const stored = (data ?? []) as { id: string; code: string | null; design_url: string | null }[];
    const byCode = new Map(stored.filter((r) => r.code).map((r) => [r.code as string, r]));

    let inserted = 0;
    let updated = 0;
    for (const offer of offers) {
      const existing = byCode.get(offer.code);
      if (existing) {
        const row = toRow(offer, existing.id);
        // a design link typed into the system survives a sync whose sheet cell is empty
        if (offer.design_url) row.design_url = offer.design_url;
        const { error } = await supabase.from("ready_offers").update(row).eq("id", existing.id);
        if (!error) updated += 1;
      } else {
        // the seed anchors on the row's own id, so the id is minted here rather
        // than left to the column default — one insert instead of insert+update
        const id = randomUUID();
        const { error } = await supabase
          .from("ready_offers")
          .insert({ ...toRow(offer, id), id, design_url: offer.design_url });
        if (!error) inserted += 1;
      }
    }

    const seen = offers.map((o) => o.code);
    const gone = stored.filter((r) => r.code && !seen.includes(r.code));
    for (const row of gone) {
      await supabase.from("ready_offers").update({ active: false }).eq("id", row.id);
    }
    return { ok: true, inserted, updated, deactivated: gone.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "err.db" };
  }
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

export async function setDesignUrl(id: string, url: string): Promise<SimpleResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  const trimmed = url.trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return { ok: false, error: "ro.err.badUrl" };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("ready_offers")
      .update({ design_url: trimmed || null })
      .eq("id", id);
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function setReadyOfferActive(id: string, active: boolean): Promise<SimpleResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase.from("ready_offers").update({ active }).eq("id", id);
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type StartDraftResult = { ok: true; id: string } | { ok: false; error: string };

/** Create a package-generator draft pre-filled from a ready offer. */
export async function startDraftFromReadyOffer(id: string): Promise<StartDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { data } = await supabase
      .from("ready_offers")
      .select("id, seed, status, active")
      .eq("id", id)
      .maybeSingle();
    const row = data as { id: string; seed: Record<string, unknown> | null; status: string | null; active: boolean } | null;
    if (!row || !row.active) return { ok: false, error: "ro.err.notFound" };
    if (row.status === "coming_soon") return { ok: false, error: "ro.err.comingSoon" };
    if (!row.seed) return { ok: false, error: "ro.err.noSeed" };
    return createDraft(row.seed as Partial<DraftData>);
  } catch {
    return { ok: false, error: "err.db" };
  }
}
