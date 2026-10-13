"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyOps } from "@/lib/data/ops-notify";
import { upsertTraveler } from "@/lib/data/operation-travelers";
import { decryptJson, encryptJson, isVaultConfigured } from "@/lib/crypto/secrets";
import { currentCan } from "@/lib/roles/current";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { readMrzFromImage } from "@/lib/providers/mrz-vision";
import { parseTd3, type MrzPassport } from "@/lib/operations/mrz";
import type { TravelerKind } from "@/lib/operations/traveler-dto";
import {
  checkPassportFile,
  clientPassportState,
  DAY_MS,
  latestPending,
  MRZ_READABLE,
  uploadAllowed,
  type ClientPassportState,
  type SubmissionStatus,
} from "@/lib/operations/client-passport";

/**
 * The client's passport uploads (operations order 11, suggestion 6).
 *
 * Client side: the trip token is the only gate (service role, as for /trip
 * itself); an upload lands as a PENDING submission and the client is told only
 * that it arrived — never what was read. Staff side: the operation_travelers
 * gates — operations.write to list/accept/reject, operations.passport (audited
 * first, withheld if the audit fails) to see what was read or open the photo.
 * Accepting saves through upsertTraveler, the existing encrypted path.
 */

const TABLE = "operation_passport_submissions";
const BUCKET = "passports";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

type Fail = { ok: false; error: TranslationKey };
type Sub = { id: string; operation_id: string; traveler_id: string; status: SubmissionStatus; scan_path: string | null; parsed_encrypted: string | null; created_at: string };

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

async function caseFor(token: string): Promise<{ id: string; serial: string } | null> {
  if (!token || token.length < 20) return null;
  const { data } = await db().from("operations").select("id, client_token_revoked_at, offers(serial)").eq("client_token", token).maybeSingle();
  const row = data as unknown as { id: string; client_token_revoked_at: string | null; offers: { serial: string } | { serial: string }[] | null } | null;
  if (!row || row.client_token_revoked_at) return null;
  const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers;
  return { id: row.id, serial: offer?.serial ?? "" };
}

const KIND_AR: Record<TravelerKind, string> = { adult: "بالغ", child: "طفل", infant: "رضيع" };

export type ClientPassportRow = { id: string; label: string; state: ClientPassportState };

/**
 * The trip page's list: «المسافر 1 — <name staff gave>» and whether we have the
 * passport. Null when the link is dead or 0068 is not applied — the section hides.
 */
export async function getClientPassports(token: string): Promise<ClientPassportRow[] | null> {
  try {
    const op = await caseFor(token);
    if (!op) return null;
    const supabase = db();
    const [travRes, subRes] = await Promise.all([
      supabase.from("operation_travelers").select("id, display_name, traveler_kind, passport_encrypted").eq("operation_id", op.id).order("sort", { ascending: true }),
      supabase.from(TABLE).select("traveler_id, status, created_at").eq("operation_id", op.id).order("created_at", { ascending: false }),
    ]);
    if (travRes.error || subRes.error) return null;
    const latest = new Map<string, SubmissionStatus>();
    for (const s of (subRes.data ?? []) as { traveler_id: string; status: SubmissionStatus }[]) {
      if (!latest.has(s.traveler_id)) latest.set(s.traveler_id, s.status);
    }
    return ((travRes.data ?? []) as { id: string; display_name: string; traveler_kind: TravelerKind; passport_encrypted: string | null }[]).map((t, i) => ({
      id: t.id,
      label: `المسافر ${i + 1} — ${t.display_name.trim() || KIND_AR[t.traveler_kind] || ""}`,
      state: clientPassportState(Boolean(t.passport_encrypted), latest.get(t.id) ?? null),
    }));
  } catch {
    return null;
  }
}

const FILE_MESSAGE = {
  empty: "اختر صورة الجواز أولاً.",
  too_large: "حجم الملف أكبر من 8 ميجابايت — صوّر الصفحة مرة أخرى بحجم أصغر.",
  type: "صورة (JPG أو PNG) أو ملف PDF فقط.",
} as const;

/** One passport photo from the client. Never touches the traveller's verified passport. */
export async function submitClientPassport(token: string, travelerId: string, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, message: FILE_MESSAGE.empty };
  const problem = checkPassportFile(file);
  if (problem) return { ok: false, message: FILE_MESSAGE[problem] };

  try {
    const op = await caseFor(token);
    if (!op) return { ok: false, message: "الرابط غير صالح." };
    const supabase = db();

    // the traveller must be on THIS link's case — a token never reaches another file
    const { data: trav } = await supabase.from("operation_travelers").select("id").eq("id", travelerId).eq("operation_id", op.id).maybeSingle();
    if (!trav) return { ok: false, message: "الرابط غير صالح." };

    const now = new Date();
    const { data: recent, error: recentErr } = await supabase
      .from(TABLE)
      .select("created_at")
      .eq("traveler_id", travelerId)
      .gte("created_at", new Date(now.getTime() - DAY_MS).toISOString());
    if (recentErr) return { ok: false, message: "تعذّر الرفع. حاولوا مرة أخرى." };
    if (!uploadAllowed(((recent ?? []) as { created_at: string }[]).map((r) => r.created_at), now)) {
      return { ok: false, message: "وصلتنا صور كافية لهذا المسافر اليوم. حاولوا غداً أو تواصلوا معنا." };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // random leaf, no name in the path — the operation_travelers convention
    const ext = file.type === "application/pdf" ? "pdf" : (file.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
    const path = `${op.id}/${travelerId}/client-${randomUUID()}.${ext}`;
    const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
    if (up.error) return { ok: false, message: "تعذّر الرفع. حاولوا مرة أخرى." };

    // read it when we can; a photo we cannot read is still a photo staff can
    let parsed: MrzPassport | null = null;
    if (isOpenAIConfigured() && MRZ_READABLE.test(file.type)) {
      const read = await readMrzFromImage({ mime: file.type, base64: Buffer.from(bytes).toString("base64") });
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
      const res = read.ok ? parseTd3(read.text, today) : null;
      if (res?.ok) parsed = res.passport;
    }
    let cipher: string | null = null;
    if (parsed && isVaultConfigured()) {
      try {
        cipher = encryptJson(parsed);
      } catch {
        cipher = null;
      }
    }

    const { data: inserted, error } = await supabase
      .from(TABLE)
      .insert({ operation_id: op.id, traveler_id: travelerId, scan_path: path, parsed_encrypted: cipher })
      .select("id")
      .single();
    if (error || !inserted) {
      await supabase.storage.from(BUCKET).remove([path]);
      return { ok: false, message: "تعذّر الرفع. حاولوا مرة أخرى." };
    }
    const id = (inserted as { id: string }).id;

    // the newest photo is the one to review — older pending ones go, files and all
    await supersede(supabase, travelerId, id);

    await logAudit({
      action: "passport.client_uploaded",
      entity: "operation_travelers",
      entity_id: travelerId,
      // field NAMES that failed their check digit — never a value
      meta: { operation_id: op.id, submission: id, read: Boolean(parsed), failed: parsed?.failed ?? null },
      actor: { id: null, label: "client" },
    });
    await notifyOps(`🛂 العميل رفع صورة جواز للمراجعة — ${op.serial}`, `/operations/${op.id}`);
    return { ok: true, message: "تم الاستلام" };
  } catch {
    return { ok: false, message: "تعذّر الرفع. حاولوا مرة أخرى." };
  }
}

/** Older pending uploads of the traveller — out of review, and their photos deleted (identity data nobody points at). */
async function supersede(supabase: SupabaseClient, travelerId: string, keepId: string) {
  const { data } = await supabase.from(TABLE).select("id, scan_path").eq("traveler_id", travelerId).eq("status", "pending").neq("id", keepId);
  const rows = (data ?? []) as { id: string; scan_path: string | null }[];
  if (rows.length === 0) return;
  await supabase
    .from(TABLE)
    .update({ status: "superseded", scan_path: null, parsed_encrypted: null, reviewed_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));
  const paths = rows.map((r) => r.scan_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
}

// ---------- staff ----------

async function requireOps(): Promise<TranslationKey | null> {
  if (!(await getServerUser())) return "err.session";
  return (await currentCan("operations.write")) ? null : "ops.err.forbidden";
}

async function requirePassport(): Promise<TranslationKey | null> {
  if (!(await getServerUser())) return "err.session";
  return (await currentCan("operations.passport")) ? null : "ops.err.forbiddenPassport";
}

async function loadSub(id: string): Promise<Sub | null> {
  const { data } = await db().from(TABLE).select("id, operation_id, traveler_id, status, scan_path, parsed_encrypted, created_at").eq("id", id).maybeSingle();
  return (data as Sub | null) ?? null;
}

export type PendingClientPassport = { id: string; created_at: string; read: boolean };

/** The newest pending upload per traveller of a case — no ciphertext, no path. */
export async function listClientPassports(operationId: string): Promise<Record<string, PendingClientPassport>> {
  if (await requireOps()) return {};
  try {
    const { data } = await db().from(TABLE).select("id, traveler_id, status, parsed_encrypted, created_at").eq("operation_id", operationId).eq("status", "pending");
    const latest = latestPending((data ?? []) as (Pick<Sub, "id" | "traveler_id" | "status" | "created_at" | "parsed_encrypted">)[]);
    const out: Record<string, PendingClientPassport> = {};
    for (const [travelerId, s] of Object.entries(latest)) out[travelerId] = { id: s.id, created_at: s.created_at, read: Boolean(s.parsed_encrypted) };
    return out;
  } catch {
    return {};
  }
}

/** What the reader made of the client's photo, for the employee to compare and save. Audited first. */
export async function reviewClientPassport(submissionId: string): Promise<{ ok: true; passport: MrzPassport | null } | Fail> {
  const denied = await requirePassport();
  if (denied) return { ok: false, error: denied };
  try {
    const sub = await loadSub(submissionId);
    if (!sub || sub.status !== "pending") return { ok: false, error: "err.loadFailed" };
    if (!sub.parsed_encrypted) return { ok: true, passport: null };
    const logged = await logAudit({
      action: "passport.viewed",
      entity: "operation_travelers",
      entity_id: sub.traveler_id,
      meta: { operation_id: sub.operation_id, client_submission: sub.id },
    });
    if (!logged) return { ok: false, error: "ops.err.auditFailed" };
    if (!isVaultConfigured()) return { ok: false, error: "ops.passport.unavailable" };
    const passport = decryptJson<MrzPassport>(sub.parsed_encrypted);
    return passport ? { ok: true, passport } : { ok: false, error: "ops.passport.unavailable" };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** A 5-minute signed URL to the client's photo — the passport gate and an audit first, like any scan. */
export async function clientPassportScanUrl(submissionId: string): Promise<{ ok: true; url: string } | Fail> {
  const denied = await requirePassport();
  if (denied) return { ok: false, error: denied };
  try {
    const sub = await loadSub(submissionId);
    if (!sub?.scan_path) return { ok: false, error: "ops.err.noScan" };
    const logged = await logAudit({
      action: "passport.scan_viewed",
      entity: "operation_travelers",
      entity_id: sub.traveler_id,
      meta: { operation_id: sub.operation_id, client_submission: sub.id },
    });
    if (!logged) return { ok: false, error: "ops.err.auditFailed" };
    const signed = await db().storage.from(BUCKET).createSignedUrl(sub.scan_path, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, error: "ops.err.noScan" };
    return { ok: true, url: signed.data.signedUrl };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Accept: the employee's reviewed fields are saved through upsertTraveler (the
 * encrypted path, its own audit), onto the submission's traveller — never one
 * the form names — and the client's photo becomes the traveller's scan.
 */
export async function acceptClientPassport(
  submissionId: string,
  input: Omit<Parameters<typeof upsertTraveler>[0], "id" | "operation_id">,
): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const sub = await loadSub(submissionId);
    if (!sub || sub.status !== "pending") return { ok: false, error: "err.loadFailed" };
    const saved = await upsertTraveler({ ...input, id: sub.traveler_id, operation_id: sub.operation_id });
    if (!saved.ok) return saved;

    const supabase = db();
    if (sub.scan_path) {
      const { data: trav } = await supabase.from("operation_travelers").select("passport_image_path").eq("id", sub.traveler_id).maybeSingle();
      const old = (trav as { passport_image_path: string | null } | null)?.passport_image_path ?? null;
      await supabase.from("operation_travelers").update({ passport_image_path: sub.scan_path, updated_at: new Date().toISOString() }).eq("id", sub.traveler_id);
      // the new passport replaced the old one; its photo does not stay behind under nobody's name
      if (old && old !== sub.scan_path) await supabase.storage.from(BUCKET).remove([old]);
    }
    await supabase.from(TABLE).update({ status: "accepted", parsed_encrypted: null, reviewed_at: new Date().toISOString() }).eq("id", sub.id);
    await logAudit({
      action: "passport.client_reviewed",
      entity: "operation_travelers",
      entity_id: sub.traveler_id,
      meta: { operation_id: sub.operation_id, submission: sub.id, decision: "accepted" },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Reject: the photo and what was read from it are deleted; the client is asked for another. */
export async function rejectClientPassport(submissionId: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const sub = await loadSub(submissionId);
    if (!sub || sub.status !== "pending") return { ok: false, error: "err.loadFailed" };
    const supabase = db();
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "rejected", scan_path: null, parsed_encrypted: null, reviewed_at: new Date().toISOString() })
      .eq("id", sub.id);
    if (error) return { ok: false, error: "err.updateFailed" };
    if (sub.scan_path) await supabase.storage.from(BUCKET).remove([sub.scan_path]);
    await logAudit({
      action: "passport.client_reviewed",
      entity: "operation_travelers",
      entity_id: sub.traveler_id,
      meta: { operation_id: sub.operation_id, submission: sub.id, decision: "rejected" },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
