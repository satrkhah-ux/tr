"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { createDraft } from "./drafts";
import { fold, parseWorkbook, TABS, tabsFromHtml } from "@/lib/ready-offers/parse";
import { DESIGN_BUCKET, DESIGN_MAX_BYTES, DESIGN_TYPES } from "@/lib/ready-offers/design";
import { buildSeed, canStartFrom, type ParsedOffer, type ReadyOfferRecord, type SyncDiff } from "@/lib/ready-offers/types";
import { currentCan } from "@/lib/roles/current";
import { listEntityAudit, logAudit } from "./audit";
import { getPartnerSession, type PartnerSession } from "@/lib/partners/session";
import { partnerPrice, partnerSeed } from "@/lib/partners/pricing";

/**
 * «العروض الجاهزة» — the company's prepared seasonal packages.
 *
 * The owner keeps them in a Google Sheet of two tabs, «العروض السياحية» and
 * «العروض التفصيلية» (parseWorkbook). `previewSync` reads the sheet and reports
 * what would change; `applySync` writes it. An offer that vanishes from the sheet
 * is deleted, with its uploaded design (the owner, 2026-10-19: «يحذف القديم ويبقى
 * الجديد»); one a draft still points at stays, inactive and without its code, so
 * it is hidden everywhere and the draft keeps its source.
 *
 * Which sheet: the link saved on /developer (app_settings ready_offers_sheet),
 * else READY_OFFERS_SHEET_ID, else the owner's sheet of 2026-10-18.
 */

const SHEET_SETTING = "ready_offers_sheet";
const DEFAULT_SHEET = "1qUeTaWBrCeQ_pogVJlG2QwBRftF7yces-mgHuMrC7TE";

const SELECT =
  "id, code, tier, title, country, variant, cities_summary, main_hotels, tours_text, domestic_flight, days, nights, price, currency, includes_text, excludes_text, validity_raw, valid_from, valid_to, design_url, status, active, seed, synced_at, published, problems, price_basis, adults, children, notes";

/** The sheet the sync reads, and where that choice came from. */
export async function readyOffersSheet(): Promise<{ id: string; source: "settings" | "env" | "default" }> {
  try {
    const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("app_settings")
      .select("value")
      .eq("key", SHEET_SETTING)
      .maybeSingle();
    const saved = (data as { value: string } | null)?.value?.trim();
    if (saved) return { id: saved, source: "settings" };
  } catch {
    /* the env or the default still reads */
  }
  const env = process.env.READY_OFFERS_SHEET_ID?.trim();
  return env ? { id: env, source: "env" } : { id: DEFAULT_SHEET, source: "default" };
}

/** A pasted link («…/spreadsheets/d/<id>/edit#gid=…») or the bare id → the id. */
function sheetIdOf(input: string): string | null {
  const t = input.trim();
  const id = t.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1] ?? (/^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null);
  return id;
}

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

async function requireManage(): Promise<string | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("settings.manage")) || (await currentCan("developer.access")) ? null : "ro.err.forbidden";
}

/**
 * A partner's read: 0055 closed ready_offers to their token (each row carries
 * our package price), so the rows come through the service role with the
 * dropped policy's own filter — active, and marked for resale.
 */
function forPartner() {
  return (createSupabaseServiceClient() as unknown as SupabaseClient)
    .from("ready_offers")
    .select(SELECT)
    .eq("active", true)
    .eq("partner_resell", true)
    .eq("published", true);
}

/** A ready offer as a partner sees it: the price at their terms, and no design (it prints ours). */
function partnerView(row: ReadyOfferRecord, partner: PartnerSession): ReadyOfferRecord {
  return {
    ...row,
    price: row.price == null ? null : partnerPrice(Number(row.price), partner.terms),
    design_url: null,
    seed: partnerSeed(row.seed, partner.terms),
  };
}

export async function listReadyOffers(includeInactive = false): Promise<ReadyOfferRecord[]> {
  try {
    const partner = await getPartnerSession();
    if (partner) {
      const { data } = await forPartner().order("price", { ascending: true });
      // an offer the sheet contradicts itself on is ours to correct, never a partner's to sell
      return ((data ?? []) as unknown as ReadyOfferRecord[]).filter((row) => !row.problems?.length).map((row) => partnerView(row, partner));
    }
    const supabase = await db();
    let query = supabase.from("ready_offers").select(SELECT).order("price", { ascending: true });
    query = query.not("code", "is", null);
    if (!includeInactive) query = query.eq("active", true);
    const { data } = await query;
    const rows = (data ?? []) as unknown as ReadyOfferRecord[];
    // «لم يتم النشر»: imported for the ones who publish, never offered to sales
    return (await currentCan("settings.manage")) ? rows : rows.filter((row) => row.published !== false);
  } catch {
    return [];
  }
}

/**
 * The sheet's tabs, name → gid, from its public page. The tabs are read by
 * name: the owner may reorder or add tabs. Null when the sheet is not public
 * (Google answers a sign-in page instead).
 */
async function sheetTabs(sheetId: string): Promise<{ name: string; gid: string }[] | null> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, { cache: "no-store" });
  if (!res.ok) return null;
  const tabs = tabsFromHtml(await res.text());
  return tabs.length ? tabs : null;
}

/**
 * One tab as CSV, by gid — the export, not gviz: gviz types a column by its
 * majority and drops the cells that differ («5,285.40 يورو …» in a price
 * column of numbers), the very cells the owner needs to see.
 */
async function fetchTab(sheetId: string, gid: string, name: string): Promise<string> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`«${name}»: HTTP ${res.status}`);
  const text = await res.text();
  // A permission-denied export returns an HTML sign-in page with HTTP 200.
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`«${name}»: not publicly readable`);
  return text;
}

type SheetRead = {
  sheetId: string;
  offers: ParsedOffer[];
  errors: SyncDiff["errors"];
  /** every tab the sheet has, and the rows of the two read */
  tabs: string[];
  rows: { summary: number | null; detail: number | null };
};

async function readSheet(): Promise<SheetRead> {
  const { id: sheetId } = await readyOffersSheet();
  const empty = { sheetId, offers: [], tabs: [], rows: { summary: null, detail: null } };
  const tabs = await sheetTabs(sheetId);
  if (!tabs) return { ...empty, errors: [{ row: 0, tab: "—", reason: "الورقة غير عامة أو الرابط غير صحيح" }] };
  const tabOf = (name: string) => tabs.find((t) => fold(t.name) === fold(name));
  const summary = tabOf(TABS.summary);
  const detail = tabOf(TABS.detail);
  const names = tabs.map((t) => t.name);
  if (!summary) return { ...empty, tabs: names, errors: [{ row: 0, tab: TABS.summary, reason: `لا يوجد تبويب «${TABS.summary}»` }] };
  try {
    const [sCsv, dCsv] = await Promise.all([fetchTab(sheetId, summary.gid, summary.name), detail ? fetchTab(sheetId, detail.gid, detail.name) : Promise.resolve("")]);
    const { offers, errors } = parseWorkbook(sCsv, dCsv, new Date().getUTCFullYear());
    if (!detail) errors.unshift({ row: 0, tab: TABS.detail, reason: `لا يوجد تبويب «${TABS.detail}» — تُستورد بيانات الملخّص وحدها` });
    const count = (csv: string) => Math.max(csv.split(/\r?\n/).filter((l) => l.replace(/[,"\s]/g, "")).length - 1, 0);
    return { sheetId, offers, errors, tabs: names, rows: { summary: count(sCsv), detail: detail ? count(dCsv) : null } };
  } catch (e) {
    return { ...empty, tabs: names, errors: [{ row: 0, tab: "—", reason: e instanceof Error ? e.message : "fetch failed" }] };
  }
}

/** Fields compared to decide whether a stored row is stale. */
const COMPARED = [
  "title", "country", "variant", "cities_summary", "main_hotels", "tours_text",
  "domestic_flight", "days", "nights", "price", "includes_text", "excludes_text",
  "validity_raw", "valid_from", "valid_to", "status", "published", "problems",
  "price_basis", "adults", "children", "notes",
] as const;

function changedFields(parsed: ParsedOffer, stored: ReadyOfferRecord): string[] {
  const next = toRow(parsed, null) as Record<string, unknown>;
  const prev = stored as unknown as Record<string, unknown>;
  // a price comes back from numeric as a string, and the problems as an array
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (a != null && b != null && Number(a) === Number(b));
  return COMPARED.filter((f) => !same(next[f], prev[f]));
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
    published: offer.published,
    problems: offer.problems,
    price_basis: offer.price_basis || null,
    adults: offer.adults,
    children: offer.children,
    notes: offer.notes || null,
    active: true,
    // the id is the seed's own anchor, so it can only be written once known
    seed: id ? buildSeed(offer, id) : null,
    source_row: offer.source_row,
    synced_at: new Date().toISOString(),
  };
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
      added: [], changed: [], removed: [], unchanged: 0, errors,
      warnings: offers
        .filter((o) => o.warnings.length)
        .map((o) => ({ code: o.code, title: o.title, notes: o.warnings })),
      problems: offers
        .filter((o) => o.problems.length)
        .map((o) => ({ code: o.code, title: o.title, reasons: o.problems })),
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
      if (row.code && !seen.has(row.code)) {
        diff.removed.push({ code: row.code, title: row.title });
      }
    }
    return { ok: true, diff };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "err.db" };
  }
}

export type ApplyResult =
  | { ok: true; inserted: number; updated: number; deleted: number }
  | { ok: false; error: string };

/** Re-reads the sheet server-side (never trusts a client-supplied payload). */
export async function applySync(): Promise<ApplyResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const { offers, sheetId, errors } = await readSheet();
    if (!offers.length) return { ok: false, error: errors[0]?.reason ?? "err.db" };
    // written past RLS only after requireManage: the table's own policy lets any staff write
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
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

    const seen = new Set(offers.map((o) => o.code));
    const gone = stored.filter((r) => r.code && !seen.has(r.code));
    const pointed = await draftsPointAt(supabase, gone.map((r) => r.id));
    const doomed = gone.filter((r) => !pointed.has(r.id));
    if (doomed.length) {
      const { error } = await supabase.from("ready_offers").delete().in("id", doomed.map((r) => r.id));
      if (error) return { ok: false, error: "err.db" };
      await removeDesigns(supabase, doomed, stored.filter((r) => !doomed.includes(r)));
    }
    // a draft still names it as its source: kept, but inactive and without a code — out of every list
    for (const row of gone.filter((r) => pointed.has(r.id))) {
      await supabase.from("ready_offers").update({ active: false, code: null }).eq("id", row.id);
    }
    await logAudit({
      action: "data.updated",
      entity: "ready_offers",
      entity_id: "sync",
      meta: { sheet: sheetId, inserted, updated, deleted: doomed.length, kept_for_drafts: gone.length - doomed.length, problems: offers.filter((o) => o.problems.length).length },
    });
    return { ok: true, inserted, updated, deleted: doomed.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "err.db" };
  }
}

/** the ready offers a draft's data still names as its source (source.ready_offer_id) */
async function draftsPointAt(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from("offer_drafts").select("ref:data->source->>ready_offer_id").in("data->source->>ready_offer_id", ids);
  // unsure → keep them all: a wrong delete cannot be undone, a kept row only waits for the next sync
  if (error) return new Set(ids);
  return new Set(((data ?? []) as { ref: string | null }[]).map((r) => r.ref).filter((r): r is string => Boolean(r)));
}

/** a deleted offer's uploaded design goes with it, unless another offer shows the same file */
async function removeDesigns(supabase: SupabaseClient, deleted: { design_url: string | null }[], remaining: { design_url: string | null }[]): Promise<void> {
  const marker = `/object/public/${DESIGN_BUCKET}/`;
  const inUse = new Set(remaining.map((r) => r.design_url));
  const paths = deleted
    .map((r) => r.design_url)
    .filter((u): u is string => Boolean(u && u.includes(marker) && !inUse.has(u)))
    .map((u) => decodeURIComponent(u.slice(u.indexOf(marker) + marker.length).split("?")[0]));
  if (paths.length) await supabase.storage.from(DESIGN_BUCKET).remove(paths);
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

export async function setDesignUrl(id: string, url: string): Promise<SimpleResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  const trimmed = url.trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return { ok: false, error: "ro.err.badUrl" };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { error } = await supabase
      .from("ready_offers")
      .update({ design_url: trimmed || null })
      .eq("id", id);
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * «إضافة صورة التصميم» — an image file for the card (the owner, 2026-10-19): jpg, png or
 * webp up to 5 MB, into the public bucket `ready-designs` (made on first use — the designs
 * are marketing, partners see them too), and the card's design link set to it.
 */
export async function uploadDesign(id: string, form: FormData): Promise<SimpleResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ro.err.badImage" };
  if (!(DESIGN_TYPES as readonly string[]).includes(file.type) || file.size > DESIGN_MAX_BYTES) return { ok: false, error: "ro.err.badImage" };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const bucket = await supabase.storage.getBucket(DESIGN_BUCKET);
    if (bucket.error) {
      await supabase.storage.createBucket(DESIGN_BUCKET, { public: true, fileSizeLimit: DESIGN_MAX_BYTES, allowedMimeTypes: [...DESIGN_TYPES] });
    }
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${id}/${Date.now()}.${ext}`;
    const up = await supabase.storage.from(DESIGN_BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (up.error) return { ok: false, error: "err.db" };
    const url = supabase.storage.from(DESIGN_BUCKET).getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.from("ready_offers").update({ design_url: url }).eq("id", id);
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function setReadyOfferActive(id: string, active: boolean): Promise<SimpleResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
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
    // a partner's file starts at their price, never ours
    const partner = await getPartnerSession();
    const { data } = partner
      ? await forPartner().eq("id", id).maybeSingle()
      : await (await db()).from("ready_offers").select("id, seed, status, active, published, problems").eq("id", id).maybeSingle();
    const row = data as (Pick<ReadyOfferRecord, "id" | "seed" | "active" | "published" | "problems"> & { status: ReadyOfferRecord["status"] }) | null;
    if (!row || !row.active) return { ok: false, error: "ro.err.notFound" };
    if (row.status === "coming_soon") return { ok: false, error: "ro.err.comingSoon" };
    // the sheet contradicts itself, or it is not published: no price goes to a client from it
    if (row.problems?.length) return { ok: false, error: "ro.err.hasProblems" };
    if (!canStartFrom(row)) return { ok: false, error: "ro.err.unpublished" };
    if (!row.seed) return { ok: false, error: "ro.err.noSeed" };
    return createDraft((partner ? partnerSeed(row.seed, partner.terms) : row.seed) ?? undefined);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- /developer: the sheet's link, a check, the last sync ----------

export type SheetCheck =
  | { ok: true; sheetId: string; tabs: string[]; found: { summary: boolean; detail: boolean }; rows: SheetRead["rows"]; offers: number; problems: number; errors: SyncDiff["errors"] }
  | { ok: false; error: string };

/** «تحقق»: is the sheet public, which tabs it has, how many rows the two hold and parse to. Writes nothing. */
export async function checkReadyOffersSheet(): Promise<SheetCheck> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  const read = await readSheet();
  const has = (name: string) => read.tabs.some((t) => fold(t) === fold(name));
  return {
    ok: true,
    sheetId: read.sheetId,
    tabs: read.tabs,
    found: { summary: has(TABS.summary), detail: has(TABS.detail) },
    rows: read.rows,
    offers: read.offers.length,
    problems: read.offers.filter((o) => o.problems.length).length,
    errors: read.errors,
  };
}

export type SetSheetResult = { ok: true; sheetId: string } | { ok: false; error: string };

/** The sheet the sync reads from now on — the full link pasted, the id kept. Audited. */
export async function setReadyOffersSheet(link: string): Promise<SetSheetResult> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  const id = sheetIdOf(link);
  if (!id) return { ok: false, error: "ro.err.badSheet" };
  try {
    const before = await readyOffersSheet();
    const { error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("app_settings")
      .upsert({ key: SHEET_SETTING, value: id, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: SHEET_SETTING, meta: { from: before.id, to: id } });
    return { ok: true, sheetId: id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ReadyOffersPanelData = {
  sheetId: string;
  source: "settings" | "env" | "default";
  lastSync: { at: string; by: string | null; inserted: number; updated: number; deleted: number } | null;
  problems: number;
  unpublished: number;
};

/** What /developer shows beside the link: the last sync (when, by whom) and the live offers «بها خطأ». */
export async function readyOffersPanel(): Promise<ReadyOffersPanelData> {
  const empty: ReadyOffersPanelData = { sheetId: "", source: "default", lastSync: null, problems: 0, unpublished: 0 };
  // a server action anyone signed in could call: the panel's figures are the managers'
  if (await requireManage()) return empty;
  const [sheet, log] = await Promise.all([readyOffersSheet(), listEntityAudit("ready_offers", "sync", 1)]);
  let problems = 0;
  let unpublished = 0;
  try {
    const { data } = await (await db()).from("ready_offers").select("problems, published").eq("active", true);
    for (const row of (data ?? []) as Pick<ReadyOfferRecord, "problems" | "published">[]) {
      if (row.problems?.length) problems += 1;
      if (row.published === false) unpublished += 1;
    }
  } catch {
    /* the counts stay 0 */
  }
  const last = log[0];
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    sheetId: sheet.id,
    source: sheet.source,
    lastSync: last ? { at: last.created_at, by: last.actor_email, inserted: n(last.meta.inserted), updated: n(last.meta.updated), deleted: n(last.meta.deleted ?? last.meta.deactivated) } : null,
    problems,
    unpublished,
  };
}
