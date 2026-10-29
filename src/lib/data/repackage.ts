"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getActiveMarkupRules } from "@/lib/data/markup-rules";
import { computeSell, selectRule } from "@/lib/pricing/markup";
import { normAr } from "@/lib/catalog/norm";
import { offerChanges, type OfferChange } from "@/lib/offer/version-diff";
import {
  emptyRepackageData,
  hasCustomer,
  impliedDeparture,
  normalizeRepackageData,
  type RepackageCustomer,
  type RepackageData,
} from "@/lib/repackage/repackage-types";
import { validateRepackage } from "@/lib/repackage/repackage-validation";
import { repackageOfferInput } from "@/lib/repackage/offer-input";
import { runExtraction, type ExtractionHow, type ExtractionSource } from "@/lib/repackage/extract/extract";
import { getPublishedClientOffer, publishOffer } from "./offers";
import { insertOffer, replaceOffer } from "./offer-insert";
import { customerFor } from "./customer-row";
import { getRates } from "./rates-actions";
import { reissueLocked } from "./issued-draft";
import { pullBookingsFromOffer } from "./offer-pull";
import { logAudit } from "./audit";
import { loadRepackage, repackageDb, writeRepackageStages, type RepackageRecord } from "./repackage-store";
import { fetchPublic } from "@/lib/repackage/fetch-public";

/**
 * Repackage server actions — import a supplier PDF, review/edit, re-issue as a
 * Traveliun offer. Mirrors src/lib/data/drafts.ts (jsonb draft + shallow merge),
 * reusing insertOffer/publishOffer for the branded, client-safe re-issue.
 * Internal-only: an import IS the supplier's price, so 0047 closed the table and
 * its bucket to every session. Every read and write goes through db(), and db()
 * is the gate: repackage.write, then the service role. Every caller sits inside
 * a try, so a refusal reads as the action's ordinary failure.
 */

const db = repackageDb;

const BUCKET = "repackage";

// ---------- CRUD ----------
export type RepackageSummary = {
  id: string;
  title: string | null;
  destination: string | null;
  /** the client it is for — null until one is linked. */
  customer_name: string | null;
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
          customer_name: d.customer.customer_name.trim() || d.customer.customer_phone.trim() || null,
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

/**
 * A new repackage. The client is asked for up front (the same picker Basic uses)
 * so the file is theirs from the first screen; starting without one is allowed —
 * it is linked later, and the issue waits for it (validateRepackage).
 */
export async function createRepackage(customer?: Partial<RepackageCustomer>): Promise<CreateRepackageResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const start: RepackageData = {
      ...emptyRepackageData(),
      customer: {
        customer_name: String(customer?.customer_name ?? "").trim().slice(0, 120),
        customer_phone: String(customer?.customer_phone ?? "").trim().slice(0, 40),
      },
    };
    const { data, error } = await supabase
      .from("repackage_imports")
      .insert({ data: start as unknown as Record<string, unknown> })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}


export async function getRepackage(id: string): Promise<RepackageRecord | null> {
  return loadRepackage(id);
}

export type SaveRepackageResult = { ok: boolean; error?: TranslationKey };

/**
 * Shallow top-level merge of slices into the import's jsonb (mirror drafts).
 * What an issue wrote is the server's: produceRepackageOffer names the serial,
 * the order screen links the supplier — a browser naming either could point
 * this file's next «إصدار نسخة محدّثة» at an offer it never issued.
 */
export async function saveRepackageStages(id: string, slices: Partial<RepackageData>): Promise<SaveRepackageResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const sent = { ...slices };
    delete sent.produced_serial;
    if (sent.source) {
      const stored = await loadRepackage(id);
      if (!stored) return { ok: false, error: "err.loadFailed" };
      sent.source = { ...sent.source, company_supplier_id: stored.data.source.company_supplier_id };
    }
    return await writeRepackageStages(id, sent);
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
  // Only public web addresses, every redirect hop re-checked, body capped while
  // it streams — never let a pasted link reach an internal host (fetch-public.ts).
  const res = await fetchPublic(raw.trim(), MAX_SOURCE_BYTES);
  if (!res) return null;
  const type = res.contentType;
  const buf = res.bytes;

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
    // The gate comes before anything is read or fetched: a link is a request
    // our server makes, so nobody without repackage.write may make it.
    const supabase = await db();

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
    // The client is ours, not the supplier's: the one the file was started for
    // (or linked since) stays, and the supplier's file only fills an empty
    // client with whoever it names. A missing departure is the arrival + the
    // nights, as the generator derives it.
    const read = extraction.extracted;
    const pkg = {
      ...read,
      departure_date: impliedDeparture(read),
    };
    const customer = hasCustomer(base.customer)
      ? base.customer
      : { customer_name: read.customer_name, customer_phone: read.customer_phone };
    // the registered supplier it was linked to stays while the supplier is the same one
    const sameSupplier = normAr(base.source.supplier_name) === normAr(supplierName);
    const nextData: RepackageData = {
      ...base,
      customer,
      source: {
        supplier_name: supplierName,
        supplier_id: supplierId,
        company_supplier_id: sameSupplier ? base.source.company_supplier_id : null,
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
      // an issued file stays that offer: the next «إصدار» is its next version, not a second offer
      produced_serial: base.produced_serial,
    };

    const saved = await writeRepackageStages(id, nextData);
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
export type ProduceResult =
  | {
      ok: true;
      serial: string;
      /** a re-issue only: the version it published and «ما تغيّر» against the one before. */
      version?: number;
      changes?: OfferChange[];
    }
  | { ok: false; error: TranslationKey };

/**
 * Validate → map RepackageData onto a Traveliun offer → create + publish it.
 *
 * On a file that already issued an offer this is «إصدار نسخة محدّثة», exactly as
 * Basic's: the SAME offer (serial) re-filled from the corrected file
 * (replaceOffer) and published as its next version — never a second offer.
 * Nothing goes to the client from here (the employee sends it, offer-send), and
 * the gates are Basic's: offers.write, and a cancelled file is not issued again.
 */
export async function produceRepackageOffer(id: string): Promise<ProduceResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await getRepackage(id);
    if (!record || !record.data.extracted) return { ok: false, error: "err.loadFailed" };
    const data = record.data;

    const reissue = data.produced_serial;
    if (
      reissue &&
      (!(await currentCan("offers.write")) || (await reissueLocked(createSupabaseServiceClient() as unknown as SupabaseClient, reissue)))
    ) {
      return { ok: false, error: "pg.err.issuedLocked" };
    }

    // Re-run the confidence gate + price floor server-side (never trust the client).
    const validation = validateRepackage(data);
    if (!validation.ok) return { ok: false, error: "rp.err.blockingLeft" };

    const built = repackageOfferInput(data, {
      // the client the file is for: found by name and phone, else created — the offer is filed under them
      customerId: await customerFor(data.customer, true),
      importId: id,
      rates: await getRates(),
    });
    if (!built.ok) return { ok: false, error: built.error === "missingRates" ? "pg.err.missingRates" : "err.loadFailed" };

    // the version the client has now, for «ما تغيّر» after the re-issue
    const before = reissue ? await getPublishedClientOffer(reissue) : null;
    const result = reissue ? await replaceOffer(reissue, built.input) : await insertOffer(built.input);
    if (!result.ok) return { ok: false, error: result.error };

    await writeRepackageStages(id, { produced_serial: result.serial });
    const published = await publishOffer(result.serial, Boolean(reissue));
    if (!reissue) return { ok: true, serial: result.serial };

    if (!published.ok) return { ok: false, error: published.error };
    const after = await getPublishedClientOffer(result.serial);
    const changes = before && after ? offerChanges(before.offer, after.offer) : [];
    await logAudit({
      action: "offer.reissued",
      entity: "offers",
      entity_id: result.id,
      meta: { serial: result.serial, version: published.version, repackage_id: id, changes },
    });
    // a confirmed file's case books from the newest issue: what it adds is pulled, and the supplier's
    // package line follows its cost (offer-pull.ts). Best-effort — the issue stands either way.
    try {
      const { data: cases } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
        .from("operations")
        .select("id")
        .eq("offer_id", result.id);
      for (const c of (cases ?? []) as { id: string }[]) await pullBookingsFromOffer(c.id);
    } catch {
      /* the case pulls again from its own page */
    }
    return { ok: true, serial: result.serial, version: published.version, changes };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
