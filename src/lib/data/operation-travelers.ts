"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { decryptJson, encryptJson, isVaultConfigured } from "@/lib/crypto/secrets";
import {
  toTravelerListItem,
  VISA_STATUSES,
  type PassportRead,
  type PassportView,
  type TravelerKind,
  type TravelerListItem,
  type TravelerRow,
  type VisaStatus,
} from "@/lib/operations/traveler-dto";
import { planTravelers } from "@/lib/operations/travelers";
import { parseTd3, type MrzPassport } from "@/lib/operations/mrz";
import { normalizeDraftData } from "@/lib/offer/draft-types";
import { issuedDraftData } from "@/lib/data/issued-draft";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { readMrzFromImage } from "@/lib/providers/mrz-vision";
import { currentCan } from "@/lib/roles/current";

/**
 * Travelers and their passports.
 *
 * `operation_travelers` has RLS enabled and NO policy (migration 0024, the same
 * posture as the credential vault in 0017), so the ordinary user client sees
 * nothing at all. Every read here goes through the SERVICE-ROLE client behind an
 * explicit permission gate — that gate is the access control, and it is the only
 * one, so it is checked on every single function in this file.
 *
 * The passport number, full name and nationality live encrypted in one blob.
 * Only `getTravelerPassport` decrypts, and only after writing an audit row.
 */

const BUCKET = "passports";
/** 0061 — private, no policy, the same posture as `passports`: a visa carries the passport number. */
const VISA_BUCKET = "visas";
/** Short on purpose: a copied URL to a passport scan is what you least want circulating. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type Fail = { ok: false; error: TranslationKey };

async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return await currentCan("operations.write") ? null : "ops.err.forbidden";
}

/** The stricter gate: decrypt identifiers / open a scan. */
async function requirePassport(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return await currentCan("operations.passport") ? null : "ops.err.forbiddenPassport";
}

/** The list view — redacted by construction, never carries ciphertext or paths. */
export async function listTravelers(operationId: string): Promise<TravelerListItem[]> {
  if (await requireOps()) return [];
  try {
    const { data } = await db()
      .from("operation_travelers")
      .select("*")
      .eq("operation_id", operationId)
      .order("sort", { ascending: true });
    return ((data ?? []) as TravelerRow[]).map(toTravelerListItem);
  } catch {
    return [];
  }
}

/**
 * The same redacted list for MANY operations in one query.
 *
 * The board and the dashboard both need every case's travelers at once; asking
 * per operation cost one round-trip per card, which is the difference between a
 * board that opens and a board that crawls once the season fills up.
 */
export async function listTravelersByOperation(
  operationIds: string[],
): Promise<Record<string, TravelerListItem[]>> {
  if (operationIds.length === 0) return {};
  if (await requireOps()) return {};
  try {
    const { data } = await db()
      .from("operation_travelers")
      .select("*")
      .in("operation_id", operationIds)
      .order("sort", { ascending: true });

    const out: Record<string, TravelerListItem[]> = {};
    for (const row of (data ?? []) as (TravelerRow & { operation_id: string })[]) {
      // Group by the parent BEFORE redacting — operation_id is not part of the
      // list item, and it must not become part of it.
      (out[row.operation_id] ??= []).push(toTravelerListItem(row));
    }
    return out;
  } catch {
    return {};
  }
}

export async function upsertTraveler(input: {
  id?: string;
  /** required on insert; ignored on update. */
  operation_id: string;
  traveler_kind?: TravelerKind;
  sort?: number;
  display_name: string;
  /** Omit to leave the stored passport untouched; pass to replace it. */
  passport?: PassportView | null;
  passport_expiry?: string | null;
  birth_date?: string | null;
  /** clear (0061) — printed on the hotel voucher; also inside the passport blob. */
  nationality?: string | null;
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if ([input.birth_date, input.passport_expiry].some((d) => d && !ISO_DATE.test(d))) {
    return { ok: false, error: "ops.trav.err.date" };
  }

  // encryptJson THROWS when the key is missing (fail-closed, correct). Catch it
  // here so a misconfigured deploy reads as a config error rather than a DB outage.
  let cipher: string | null | undefined;
  if (input.passport !== undefined) {
    if (input.passport === null) {
      cipher = null;
    } else {
      if (!isVaultConfigured()) return { ok: false, error: "ops.err.vault" };
      try {
        cipher = encryptJson(input.passport);
      } catch {
        return { ok: false, error: "ops.err.vault" };
      }
    }
  }

  try {
    const patch: Record<string, unknown> = {
      display_name: input.display_name,
      updated_at: new Date().toISOString(),
    };
    // Only on INSERT — an update must never rewrite the parent, and the edit
    // form has no reason to know the operation id.
    if (!input.id) patch.operation_id = input.operation_id;
    if (input.traveler_kind) patch.traveler_kind = input.traveler_kind;
    if (input.sort != null) patch.sort = input.sort;
    if (input.passport_expiry !== undefined) patch.passport_expiry = input.passport_expiry || null;
    if (input.birth_date !== undefined) patch.birth_date = input.birth_date || null;
    if (input.nationality !== undefined) patch.nationality = input.nationality?.trim().slice(0, 40) || null;
    if (cipher !== undefined) patch.passport_encrypted = cipher;

    // the operation the row really belongs to — an edit never trusts the caller's
    const query = input.id
      ? db().from("operation_travelers").update(patch).eq("id", input.id).select("id, operation_id").single()
      : db().from("operation_travelers").insert(patch).select("id, operation_id").single();

    const { data, error } = await query;
    if (error || !data) return { ok: false, error: "err.saveOfferFailed" };
    const { id, operation_id } = data as { id: string; operation_id: string };

    if (!input.id) {
      await logAudit({ action: "traveler.created", entity: "operation_travelers", entity_id: id, meta: { operation_id } });
    }
    if (cipher !== undefined) {
      await logAudit({
        action: "passport.saved",
        entity: "operation_travelers",
        entity_id: id,
        // NEVER the number itself — only that one was stored.
        meta: { operation_id, cleared: cipher === null },
      });
    }
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteTraveler(id: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id, traveler_kind, passport_encrypted, passport_image_path, visa_file_path")
      .eq("id", id)
      .maybeSingle();
    const row = data as Pick<
      TravelerRow,
      "id" | "operation_id" | "traveler_kind" | "passport_encrypted" | "passport_image_path" | "visa_file_path"
    > | null;
    if (!row) return { ok: false, error: "err.loadFailed" };

    // Recorded BEFORE: whether a passport was on file — never the number.
    await logAudit({
      action: "traveler.deleted",
      entity: "operation_travelers",
      entity_id: id,
      meta: {
        operation_id: row.operation_id,
        kind: row.traveler_kind,
        has_passport: Boolean(row.passport_encrypted),
        has_scan: Boolean(row.passport_image_path),
        has_visa_file: Boolean(row.visa_file_path),
      },
    });

    const { error } = await supabase.from("operation_travelers").delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };

    // The files go with the person: a passport photo nobody points at any more
    // is identity data nobody will ever think to clean up.
    if (row.passport_image_path) await supabase.storage.from(BUCKET).remove([row.passport_image_path]);
    if (row.visa_file_path) await supabase.storage.from(VISA_BUCKET).remove([row.visa_file_path]);
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Decrypt one traveler's passport.
 *
 * The audit row is written FIRST and the data is withheld if it fails. "We can
 * prove who read the passports" and "we think we can" are different claims, and
 * this line is the difference. It costs nothing real — the audit insert and this
 * read share one service client, so a failure means the database is unreachable.
 */
export async function getTravelerPassport(travelerId: string): Promise<PassportRead | Fail> {
  const denied = await requirePassport();
  if (denied) return { ok: false, error: denied };

  try {
    const { data } = await db()
      .from("operation_travelers")
      .select("id, operation_id, passport_encrypted")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string; passport_encrypted: string | null } | null;
    if (!row) return { ok: false, error: "err.loadFailed" };
    if (!row.passport_encrypted) return { state: "none" };

    const logged = await logAudit({
      action: "passport.viewed",
      entity: "operation_travelers",
      entity_id: travelerId,
      meta: { operation_id: row.operation_id },
    });
    if (!logged) return { ok: false, error: "ops.err.auditFailed" };

    // decryptJson returns null for a MISSING KEY and for a TAMPERED blob alike.
    // Telling those apart matters: one is a config error, the other an incident,
    // and neither is "this traveler has no passport on file".
    if (!isVaultConfigured()) return { state: "unavailable", reason: "vault_unconfigured" };
    const passport = decryptJson<PassportView>(row.passport_encrypted);
    if (!passport) {
      await logAudit({
        action: "passport.decrypt_failed",
        entity: "operation_travelers",
        entity_id: travelerId,
        meta: { operation_id: row.operation_id },
      });
      return { state: "unavailable", reason: "undecryptable" };
    }
    return { state: "ok", passport };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Upload a scan into the private bucket. The path never contains a name. */
export async function uploadPassportScan(
  travelerId: string,
  formData: FormData,
): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };

  const file = pickFile(formData);
  if (typeof file === "string") return { ok: false, error: file };

  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string } | null;
    if (!row) return { ok: false, error: "err.loadFailed" };

    const path = await storeFile(supabase, BUCKET, row, file);
    if (!path) return { ok: false, error: "ops.err.uploadFailed" };

    await supabase
      .from("operation_travelers")
      .update({ passport_image_path: path, updated_at: new Date().toISOString() })
      .eq("id", travelerId);

    await logAudit({
      action: "passport.saved",
      entity: "operation_travelers",
      entity_id: travelerId,
      meta: { operation_id: row.operation_id, scan: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** A 5-minute signed URL for the scan. Audited, and withheld if the audit fails. */
export async function getPassportScanUrl(travelerId: string): Promise<{ ok: true; url: string } | Fail> {
  const denied = await requirePassport();
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id, passport_image_path")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string; passport_image_path: string | null } | null;
    if (!row?.passport_image_path) return { ok: false, error: "ops.err.noScan" };

    const logged = await logAudit({
      action: "passport.scan_viewed",
      entity: "operation_travelers",
      entity_id: travelerId,
      meta: { operation_id: row.operation_id },
    });
    if (!logged) return { ok: false, error: "ops.err.auditFailed" };

    const signed = await supabase.storage.from(BUCKET).createSignedUrl(row.passport_image_path, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, error: "ops.err.noScan" };
    return { ok: true, url: signed.data.signedUrl };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

function pickFile(formData: FormData): File | TranslationKey {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return "ops.err.noFile";
  if (file.size > MAX_SCAN_BYTES) return "ops.err.fileTooLarge";
  return file;
}

/** Into a private bucket; returns the object path, or null when the upload failed. */
async function storeFile(
  supabase: SupabaseClient,
  bucket: string,
  row: { id: string; operation_id: string },
  file: File,
): Promise<string | null> {
  // Random leaf: a leaked path must not let anyone enumerate its neighbours,
  // and the filename must not carry the traveler's name.
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${row.operation_id}/${row.id}/${randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await supabase.storage.from(bucket).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: false });
  return up.error ? null : path;
}

/** The company's day — a birth year's century is decided against Riyadh's today, not UTC's. */
function riyadhToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
}

// ---------- travelers from the offer (0061) ----------

type OfferPax = {
  serial: string;
  partner_company_id: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
};

/**
 * One traveler row per person the offer was sold for, the client first, the
 * children with their ages. Only into an EMPTY case — it never adds to a list
 * someone has started.
 *
 * `auto` is the case opening by itself: it claims `operations.travelers_seeded_at`
 * first, so two tabs opening the case together seed once, and a case whose
 * travelers were deleted on purpose is not refilled by the next refresh. The
 * button (auto=false) is the employee asking, and always may.
 */
async function seedFromOffer(operationId: string, auto: boolean): Promise<{ ok: true; added: number } | Fail> {
  try {
    const supabase = db();
    const { count } = await supabase
      .from("operation_travelers")
      .select("id", { count: "exact", head: true })
      .eq("operation_id", operationId);
    if ((count ?? 0) > 0) return { ok: true, added: 0 };

    let claim = supabase.from("operations").update({ travelers_seeded_at: new Date().toISOString() }).eq("id", operationId);
    if (auto) claim = claim.is("travelers_seeded_at", null);
    const { data: claimed } = await claim
      .select("offer_id, offers(serial, partner_company_id, adults, children, infants, customers(arabic_name))")
      .maybeSingle();
    const op = claimed as { offer_id: string; offers: OfferPax | OfferPax[] | null } | null;
    if (!op) return auto ? { ok: true, added: 0 } : { ok: false, error: "ops.err.notFound" };
    const offer = Array.isArray(op.offers) ? (op.offers[0] ?? null) : op.offers;
    const customer = Array.isArray(offer?.customers) ? (offer.customers[0] ?? null) : (offer?.customers ?? null);

    // The draft as ISSUED holds the children's ages and whether visas were sold
    // (issued-draft.ts — never one edited since); an offer without one
    // (imported, repackaged) has only the counts.
    const raw = offer
      ? await issuedDraftData(supabase, { id: op.offer_id, serial: offer.serial, partner_company_id: offer.partner_company_id })
      : null;
    const draft = raw ? normalizeDraftData(raw) : null;

    const plan = planTravelers({
      adults: draft?.trip.adults ?? offer?.adults ?? 1,
      children: draft?.trip.children ?? offer?.children ?? 0,
      infants: draft?.trip.infants ?? offer?.infants ?? 0,
      children_ages: draft?.trip.children_ages ?? [],
      infant_ages: draft?.trip.infant_ages ?? [],
      // the customer record is the name on the case header; the draft's typed name otherwise
      lead_name: customer?.arabic_name?.trim() || draft?.customer.customer_name || "",
      visa_required: Boolean(draft?.scope.visas && draft.visas.some((v) => Number(v.count) > 0)),
    });

    const { error } = await supabase
      .from("operation_travelers")
      .insert(plan.map((p) => ({ operation_id: operationId, ...p })));
    if (error) return { ok: false, error: "err.createFailed" };

    await logAudit({
      action: "traveler.created",
      entity: "operations",
      entity_id: operationId,
      meta: { seeded: plan.length, from: draft ? "draft" : "offer", auto },
    });
    return { ok: true, added: plan.length };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** «أنشئ المسافرين من العرض». */
export async function seedTravelersFromOffer(operationId: string): Promise<{ ok: true; added: number } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  return seedFromOffer(operationId, false);
}

/** The case page's list: a never-seeded empty case fills itself from the offer first. */
export async function listOrSeedTravelers(operationId: string): Promise<TravelerListItem[]> {
  const listed = await listTravelers(operationId);
  if (listed.length > 0 || (await requireOps())) return listed;
  const seeded = await seedFromOffer(operationId, true);
  return seeded.ok && seeded.added > 0 ? listTravelers(operationId) : listed;
}

// ---------- reading the passport from its photo ----------

/** What the vision model is given: a picture, never a PDF. */
const MRZ_IMAGE = /^image\/(jpeg|png|webp|gif)$/;

/**
 * Photo → the passport fields, for the employee to REVIEW. Nothing is saved
 * here except the photo itself, as the scan, when the traveler has none.
 *
 * operations.write, not operations.passport: the answer comes from a picture
 * the employee just handed over — nothing stored is decrypted. Every read is
 * audited, failed ones too, and the result is withheld if the audit cannot be
 * written, like a reveal.
 */
export async function readPassportMrz(
  travelerId: string,
  formData: FormData,
): Promise<{ ok: true; passport: MrzPassport } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!isOpenAIConfigured()) return { ok: false, error: "ops.trav.err.mrzOff" };
  const file = pickFile(formData);
  if (typeof file === "string") return { ok: false, error: file };
  if (!MRZ_IMAGE.test(file.type)) return { ok: false, error: "ops.trav.err.imageOnly" };

  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id, passport_image_path")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string; passport_image_path: string | null } | null;
    if (!row) return { ok: false, error: "err.loadFailed" };

    const read = await readMrzFromImage({
      mime: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    });
    const parsed = read.ok ? parseTd3(read.text, riyadhToday()) : null;

    const logged = await logAudit({
      action: "passport.mrz_read",
      entity: "operation_travelers",
      entity_id: travelerId,
      // field NAMES that failed their check digit — never a value
      meta: { operation_id: row.operation_id, read: parsed?.ok ?? false, failed: parsed?.ok ? parsed.passport.failed : null },
    });
    if (!logged) return { ok: false, error: "ops.err.auditFailed" };
    if (!read.ok && read.error === "request_failed") return { ok: false, error: "ops.trav.err.mrzFailed" };
    if (!parsed?.ok) return { ok: false, error: "ops.trav.err.mrzUnreadable" };

    // the page just read becomes the scan when there is none — no second upload of it
    if (!row.passport_image_path) {
      const path = await storeFile(supabase, BUCKET, row, file);
      if (path) {
        await supabase
          .from("operation_travelers")
          .update({ passport_image_path: path, updated_at: new Date().toISOString() })
          .eq("id", travelerId);
        await logAudit({
          action: "passport.saved",
          entity: "operation_travelers",
          entity_id: travelerId,
          meta: { operation_id: row.operation_id, scan: true },
        });
      }
    }
    return { ok: true, passport: parsed.passport };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- visas ----------

export async function setTravelerVisa(travelerId: string, status: VisaStatus): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  if (!VISA_STATUSES.includes(status)) return { ok: false, error: "err.updateFailed" };
  try {
    const { data, error } = await db()
      .from("operation_travelers")
      .update({ visa_status: status, updated_at: new Date().toISOString() })
      .eq("id", travelerId)
      .select("operation_id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "visa.updated",
      entity: "operation_travelers",
      entity_id: travelerId,
      meta: { operation_id: (data as { operation_id: string }).operation_id, status },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The visa itself (image or PDF) into the private `visas` bucket. */
export async function uploadVisaFile(travelerId: string, formData: FormData): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  const file = pickFile(formData);
  if (typeof file === "string") return { ok: false, error: file };

  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id, visa_file_path")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string; visa_file_path: string | null } | null;
    if (!row) return { ok: false, error: "err.loadFailed" };

    const path = await storeFile(supabase, VISA_BUCKET, row, file);
    if (!path) return { ok: false, error: "ops.err.uploadFailed" };
    await supabase
      .from("operation_travelers")
      .update({ visa_file_path: path, updated_at: new Date().toISOString() })
      .eq("id", travelerId);
    // a replaced visa is not kept around under nobody's name
    if (row.visa_file_path) await supabase.storage.from(VISA_BUCKET).remove([row.visa_file_path]);

    await logAudit({
      action: "visa.updated",
      entity: "operation_travelers",
      entity_id: travelerId,
      meta: { operation_id: row.operation_id, file: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** A 5-minute signed URL to the visa — it carries the passport number, so the passport gate and an audit first. */
export async function getVisaFileUrl(travelerId: string): Promise<{ ok: true; url: string } | Fail> {
  const denied = await requirePassport();
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id, visa_file_path")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string; visa_file_path: string | null } | null;
    if (!row?.visa_file_path) return { ok: false, error: "ops.trav.err.noVisaFile" };

    const logged = await logAudit({
      action: "visa.file_viewed",
      entity: "operation_travelers",
      entity_id: travelerId,
      meta: { operation_id: row.operation_id },
    });
    if (!logged) return { ok: false, error: "ops.err.auditFailed" };

    const signed = await supabase.storage.from(VISA_BUCKET).createSignedUrl(row.visa_file_path, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, error: "ops.trav.err.noVisaFile" };
    return { ok: true, url: signed.data.signedUrl };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
