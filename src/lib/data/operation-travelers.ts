"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { can } from "@/lib/roles/roles";
import { decryptJson, encryptJson, isVaultConfigured } from "@/lib/crypto/secrets";
import {
  toTravelerListItem,
  type PassportRead,
  type PassportView,
  type TravelerKind,
  type TravelerListItem,
  type TravelerRow,
} from "@/lib/operations/traveler-dto";

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
/** Short on purpose: a copied URL to a passport scan is what you least want circulating. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type Fail = { ok: false; error: TranslationKey };

async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return can(await getCurrentRole(), "operations.write") ? null : "ops.err.forbidden";
}

/** The stricter gate: decrypt identifiers / open a scan. */
async function requirePassport(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return can(await getCurrentRole(), "operations.passport") ? null : "ops.err.forbiddenPassport";
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
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };

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
    if (input.passport_expiry !== undefined) patch.passport_expiry = input.passport_expiry;
    if (cipher !== undefined) patch.passport_encrypted = cipher;

    const query = input.id
      ? db().from("operation_travelers").update(patch).eq("id", input.id).select("id").single()
      : db().from("operation_travelers").insert(patch).select("id").single();

    const { data, error } = await query;
    if (error || !data) return { ok: false, error: "err.saveOfferFailed" };
    const id = (data as { id: string }).id;

    if (cipher !== undefined) {
      await logAudit({
        action: "passport.saved",
        entity: "operation_travelers",
        entity_id: id,
        // NEVER the number itself — only that one was stored.
        meta: { operation_id: input.operation_id, cleared: cipher === null },
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
    const { error } = await db().from("operation_travelers").delete().eq("id", id);
    return error ? { ok: false, error: "err.deleteFailed" } : { ok: true };
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

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ops.err.noFile" };
  if (file.size > MAX_SCAN_BYTES) return { ok: false, error: "ops.err.fileTooLarge" };

  try {
    const supabase = db();
    const { data } = await supabase
      .from("operation_travelers")
      .select("id, operation_id")
      .eq("id", travelerId)
      .maybeSingle();
    const row = data as { id: string; operation_id: string } | null;
    if (!row) return { ok: false, error: "err.loadFailed" };

    // Random leaf: a leaked path must not let anyone enumerate its neighbours,
    // and the filename must not carry the traveler's name.
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${row.operation_id}/${row.id}/${randomUUID()}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (up.error) return { ok: false, error: "ops.err.uploadFailed" };

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
