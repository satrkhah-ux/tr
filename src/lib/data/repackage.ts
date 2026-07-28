"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import type { BoardType } from "@/lib/types";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { deriveCityDates } from "@/lib/offer/draft-types";
import { getActiveMarkupRules } from "@/lib/data/markup-rules";
import { computeSell, selectRule } from "@/lib/pricing/markup";
import {
  emptyRepackageData,
  normalizeRepackageData,
  type RepackageData,
} from "@/lib/repackage/repackage-types";
import { validateRepackage } from "@/lib/repackage/repackage-validation";
import { runExtraction, type ExtractionHow, type ExtractionSource } from "@/lib/repackage/extract/extract";
import {
  createOffer,
  publishOffer,
  type OfferHotelInput,
} from "./offers";

/**
 * Repackage server actions — import a supplier PDF, review/edit, re-issue as a
 * Traveliun offer. Mirrors src/lib/data/drafts.ts (jsonb draft + shallow merge),
 * reusing createOffer/publishOffer for the branded, client-safe re-issue.
 * Internal-only: holds supplier cost → all reads/writes require getServerUser.
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const BUCKET = "repackage";

// ---------- CRUD ----------
export type RepackageSummary = {
  id: string;
  title: string | null;
  destination: string | null;
  supplier_name: string | null;
  produced_serial: string | null;
  updated_at: string;
};

export async function listRepackages(): Promise<RepackageSummary[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("repackage_imports")
      .select("id, title, data, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    return ((data ?? []) as { id: string; title: string | null; data: Record<string, unknown>; updated_at: string }[]).map(
      (row) => {
        const d = normalizeRepackageData(row.data);
        return {
          id: row.id,
          title: row.title,
          destination: d.extracted?.destination || d.extracted?.country || null,
          supplier_name: d.source.supplier_name || null,
          produced_serial: d.produced_serial,
          updated_at: row.updated_at,
        };
      },
    );
  } catch {
    return [];
  }
}

export type CreateRepackageResult = { ok: true; id: string } | { ok: false; error: TranslationKey };

export async function createRepackage(): Promise<CreateRepackageResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { data, error } = await supabase
      .from("repackage_imports")
      .insert({ data: emptyRepackageData() as unknown as Record<string, unknown> })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type RepackageRecord = { id: string; data: RepackageData; updated_at: string };

export async function getRepackage(id: string): Promise<RepackageRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("repackage_imports")
      .select("id, data, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; data: Record<string, unknown>; updated_at: string };
    return { id: row.id, data: normalizeRepackageData(row.data), updated_at: row.updated_at };
  } catch {
    return null;
  }
}

export type SaveRepackageResult = { ok: boolean; error?: TranslationKey };

/** Shallow top-level merge of slices into the import's jsonb (mirror drafts). */
export async function saveRepackageStages(id: string, slices: Partial<RepackageData>): Promise<SaveRepackageResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { data: existing } = await supabase.from("repackage_imports").select("data").eq("id", id).maybeSingle();
    if (!existing) return { ok: false, error: "err.loadFailed" };
    const current = normalizeRepackageData((existing as { data: Record<string, unknown> }).data);
    const merged: RepackageData = { ...current, ...slices };
    const title = merged.source.supplier_name || merged.extracted?.destination || merged.extracted?.country || null;
    const { error } = await supabase
      .from("repackage_imports")
      .update({
        data: merged as unknown as Record<string, unknown>,
        title,
        supplier_id: merged.source.supplier_id,
        original_file_path: merged.source.original_file_path,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteRepackage(id: string): Promise<SaveRepackageResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { error } = await supabase.from("repackage_imports").delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- supplier registry ----------
export type RepackageSupplierOption = { id: string; name: string };

/** Known suppliers for the import form's picker (sorted by name). */
export async function listRepackageSuppliers(): Promise<RepackageSupplierOption[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await db();
    const { data } = await supabase.from("suppliers_repackage").select("id, name").order("name").limit(200);
    return ((data ?? []) as RepackageSupplierOption[]).filter((s) => Boolean(s.name));
  } catch {
    return [];
  }
}

async function findOrCreateSupplier(supabase: SupabaseClient, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: found } = await supabase
    .from("suppliers_repackage")
    .select("id")
    .ilike("name", trimmed)
    .maybeSingle();
  if (found) return (found as { id: string }).id;
  const { data: created } = await supabase
    .from("suppliers_repackage")
    .insert({ name: trimmed })
    .select("id")
    .single();
  return created ? (created as { id: string }).id : null;
}

// ---------- import + extract ----------
export type ImportResult =
  | { ok: true; autoAdvance: boolean; ocrUnavailable: boolean; how: ExtractionHow; summary: string }
  | { ok: false; error: TranslationKey };

/** How big a fetched page or uploaded file may be before we refuse it. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * Turn a public web page into readable text. Suppliers often send a link to a
 * hosted brochure rather than the file, and a link to a PDF or an image is
 * handled as that file — the URL is just another envelope.
 */
async function fetchUrlSource(raw: string): Promise<ExtractionSource | null> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // Only public web addresses; never let a pasted link reach an internal host.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(url.hostname)) return null;

  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SOURCE_BYTES) return null;

  if (type.includes("pdf")) return { kind: "pdf", bytes: buf };
  if (type.startsWith("image/")) return { kind: "image", bytes: buf };
  // strip the markup: script/style out, tags to spaces, entities decoded
  const text = buf
    .toString("utf8")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length > 0 ? { kind: "text", text } : null;
}

/**
 * Import a supplier package from whatever the supplier actually sent — a PDF, a
 * picture, a pasted message, or a link — run the extraction engine over it, and
 * persist the fields with their per-field confidence.
 *
 * The original file is kept in a private bucket for internal audit; its path
 * never appears on client output. Returns autoAdvance=true when confidence is
 * HIGH (→ skip /review, go straight to /edit).
 */
export async function importFromPdf(id: string, formData: FormData): Promise<ImportResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };

    const supplierName = String(formData.get("supplier") ?? "").trim();
    const pastedText = String(formData.get("text") ?? "").trim();
    const pastedUrl = String(formData.get("url") ?? "").trim();
    const file = formData.get("file");
    const hasFile = file instanceof File && file.size > 0;

    let source: ExtractionSource | null = null;
    let bytes: Buffer | null = null;
    let contentType = "application/octet-stream";
    let sourceName = "";

    if (hasFile) {
      if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: "rp.err.tooLarge" };
      bytes = Buffer.from(await file.arrayBuffer());
      contentType = file.type || "application/octet-stream";
      sourceName = file.name;
      const isPdf = contentType.includes("pdf") || /\.pdf$/i.test(file.name);
      const isImage = contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
      if (!isPdf && !isImage) return { ok: false, error: "rp.err.notSupported" };
      source = isPdf ? { kind: "pdf", bytes } : { kind: "image", bytes };
    } else if (pastedText.length > 0) {
      source = { kind: "text", text: pastedText };
      sourceName = "pasted.txt";
    } else if (pastedUrl.length > 0) {
      try {
        source = await fetchUrlSource(pastedUrl);
      } catch {
        source = null;
      }
      if (!source) return { ok: false, error: "rp.err.badUrl" };
      if (source.kind !== "text") {
        bytes = source.bytes;
        contentType = source.kind === "pdf" ? "application/pdf" : "image/png";
      }
      sourceName = pastedUrl.slice(-80);
    }
    if (!source) return { ok: false, error: "rp.err.noFileUpload" };

    const supabase = await db();

    // keep the original for internal audit; text/link imports have no file
    let originalPath: string | null = null;
    if (bytes) {
      const safeName = (sourceName || "source").replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (!upErr) originalPath = path;
    }

    const supplierId = await findOrCreateSupplier(supabase, supplierName);

    // run the extraction engine (model over text/pictures, parser as fallback)
    let extraction;
    try {
      extraction = await runExtraction(source);
    } catch {
      return { ok: false, error: "rp.err.extractFailed" };
    }

    const record = await getRepackage(id);
    const base = record?.data ?? emptyRepackageData();
    const pkg = extraction.extracted;
    const nextData: RepackageData = {
      ...base,
      source: {
        supplier_name: supplierName,
        supplier_id: supplierId,
        original_file_path: originalPath,
        pdf_kind: extraction.pdf_kind,
        ocr_used: extraction.ocr_used,
        ocr_unavailable: extraction.ocr_unavailable,
        imported_at: new Date().toISOString(),
        how: extraction.how,
        summary: extraction.summary,
      },
      extracted: pkg,
      confidence: extraction.confidence,
      reviewed: [],
      final_total: null,
      final_currency: pkg.supplier_currency,
      markup_applied: false,
      before: {
        supplier_total: pkg.supplier_total,
        supplier_currency: pkg.supplier_currency,
        includes: [...pkg.includes],
        excludes: [...pkg.excludes],
        terms: [...pkg.terms],
      },
      produced_serial: null,
    };

    const saved = await saveRepackageStages(id, nextData);
    if (!saved.ok) return { ok: false, error: saved.error ?? "err.db" };

    const validation = validateRepackage(nextData);
    return {
      ok: true,
      autoAdvance: validation.reviewClear,
      ocrUnavailable: extraction.ocr_unavailable,
      how: extraction.how,
      summary: extraction.summary,
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Short-lived signed URL to the original supplier file (staff review only). */
export async function getOriginalFileUrl(id: string): Promise<string | null> {
  try {
    const user = await getServerUser();
    if (!user) return null;
    const record = await getRepackage(id);
    const path = record?.data.source.original_file_path;
    if (!path) return null;
    const supabase = await db();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// ---------- markup suggestion (buy → sell) ----------
export type SellSuggestion =
  | { ok: true; sell: number; profit: number; margin_pct: number | null; blocked: boolean }
  | { ok: false; error: TranslationKey };

/** Apply the best-matching saved markup rule to the supplier cost → sell price. */
export async function suggestSellPrice(id: string): Promise<SellSuggestion> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await getRepackage(id);
    if (!record?.data.extracted) return { ok: false, error: "err.loadFailed" };
    const pkg = record.data.extracted;
    if (pkg.supplier_total == null) return { ok: false, error: "rp.err.noSupplierPrice" };

    const rules = await getActiveMarkupRules();
    const rule = selectRule(rules, {
      country: pkg.country || null,
      city: pkg.cities[0]?.city_name ?? null,
      supplier_id: record.data.source.supplier_id,
      stars: null,
      date: pkg.arrival_date,
      customer_type: null,
    });
    if (!rule) return { ok: false, error: "rp.err.noMarkupRule" };

    const comp = computeSell(pkg.supplier_total, rule, {});
    // compute-only — the edit stage persists final_total via patch/auto-save.
    return { ok: true, sell: comp.sell, profit: comp.profit, margin_pct: comp.margin_pct, blocked: comp.blocks.length > 0 };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- produce the re-issued offer ----------
export type ProduceResult = { ok: true; serial: string } | { ok: false; error: TranslationKey };

const BOARD_LABEL: Record<BoardType, string> = {
  RO: "غرفة فقط",
  BB: "شامل الإفطار",
  HB: "نصف إقامة",
  FB: "إقامة كاملة",
  AI: "شامل كليًا",
};

function asBoard(raw: string): BoardType | null {
  return raw === "RO" || raw === "BB" || raw === "HB" || raw === "FB" || raw === "AI" ? raw : null;
}

/** Validate → map RepackageData onto a Traveliun offer → create + publish it. */
export async function produceRepackageOffer(id: string): Promise<ProduceResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await getRepackage(id);
    if (!record || !record.data.extracted) return { ok: false, error: "err.loadFailed" };
    const data = record.data;
    const pkg = record.data.extracted;

    // Re-run the confidence gate + price floor server-side (never trust the client).
    const validation = validateRepackage(data);
    if (!validation.ok) return { ok: false, error: "rp.err.blockingLeft" };

    const nights = pkg.trip_nights ?? pkg.cities.reduce((s, c) => s + (c.nights ?? 0), 0);
    const days = nights > 0 ? nights + 1 : 0;

    const cities = deriveCityDates(
      pkg.arrival_date,
      pkg.cities.map((c) => ({ city_name: c.city_name, nights: c.nights ?? 1, check_in: null, check_out: null })),
    );
    // Pair hotels to cities: prefer city_name match, else positional.
    const hotelFor = (cityName: string, index: number) =>
      pkg.hotels.find((h) => h.city_name && h.city_name === cityName) ?? pkg.hotels[index] ?? null;

    const hotels: OfferHotelInput[] = cities.flatMap((c, i) => {
      const h = hotelFor(c.city_name, i);
      if (!h) return [];
      return [{
        hotel_id: null,
        hotel_name: h.hotel_name || null,
        room_type_id: null,
        rooms_count: 1,
        board_type: asBoard(h.board),
        check_in: c.check_in,
        check_out: c.check_out,
        nights: c.nights,
        // package priced as a whole (buy_total on pricings) → no per-line cost.
        buy_price: null,
        buy_currency: null,
        sell_price: null,
        sell_currency: null,
        // IP-SAFE: carry facts only. No supplier name / logo / photos lifted from
        // the PDF — supplier provenance stays as an opaque id on the offer row.
        cancellation_policy: null,
        excluded_surcharges: [],
        valid_until: null,
        supplier_id: null,
        supplier_name: null,
        rate_key: null,
        net_base: null,
        net_source_currency: null,
        fx_rate: null,
        fx_date: null,
        ref_sell_base: null,
        markup_amount: null,
        markup_pct: null,
        image_url: null,
        facilities: [],
        content_star_rating: null,
        room_type_name: h.room_type || null,
      }];
    });

    const transferIncludes = pkg.transfers.map((t) => `المواصلات: ${t}`);
    const visaIncludes = pkg.visas.map((v) => `تأشيرة: ${v}`);

    const result = await createOffer({
      customer_id: null,
      employee_id: null,
      destination: pkg.destination || pkg.country,
      duration: nights > 0 ? `${days} أيام / ${nights} ليالي` : null,
      offer_date: pkg.arrival_date,
      adults: pkg.adults,
      children: pkg.children,
      infants: pkg.infants,
      total: data.final_total,          // our SELL
      buy_total: pkg.supplier_total,    // supplier COST (internal — pricings only)
      currency: data.final_currency,
      cities: cities.map((c, i) => {
        const h = hotelFor(c.city_name, i);
        return {
          city_name: c.city_name,
          hotel_name: h?.hotel_name || null,
          room_type: h?.room_type || null,
          nights: c.nights,
          check_in: c.check_in,
          check_out: c.check_out,
          meals: h?.board ? (BOARD_LABEL[asBoard(h.board) ?? "RO"] ?? null) : null,
        };
      }),
      flights: pkg.flights.map((f) => ({
        carrier: f.airline || null,
        from_airport: f.from_airport || null,
        to_airport: f.to_airport || null,
        flight_date: f.departure_at ? f.departure_at.slice(0, 10) : null,
        passengers: pkg.adults + pkg.children,
        baggage: null,
        airline: f.airline || null,
        flight_no: f.flight_no || null,
        departure_at: f.departure_at,
        arrival_at: f.arrival_at,
        cabin_class: null,
        baggage_allowance: null,
        leg_order: null,
      })),
      services: [
        ...pkg.includes.map((label) => ({ label, kind: "include" as const })),
        ...transferIncludes.map((label) => ({ label, kind: "include" as const })),
        ...visaIncludes.map((label) => ({ label, kind: "include" as const })),
        ...pkg.excludes.map((label) => ({ label, kind: "exclude" as const })),
      ],
      terms: pkg.terms,
      hotels,
      source_kind: "repackaged",
      source_supplier_id: data.source.supplier_id,
      source_import_id: id,
    });

    if (!result.ok) return { ok: false, error: result.error };
    await saveRepackageStages(id, { produced_serial: result.serial });
    await publishOffer(result.serial);
    return { ok: true, serial: result.serial };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
