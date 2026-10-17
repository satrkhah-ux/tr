"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan, currentCanOpen } from "@/lib/roles/current";
import { canCancelFile, lastSentVersion, type FileState, type TimelineEntry } from "@/lib/offer/file-state";
import { loadDraft } from "./draft-store";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { setOfferStatus } from "./offer-status";
import { confirmOffer } from "./operations";
import { clientWhatsappAllowed, offerMessage, sendOfferToClient, type ClientSendResult } from "./client-whatsapp";
import { loadFileStatus } from "./file-status-core";

/**
 * Basic's file status and its three actions (the owner, 2026-10-17):
 *   - «أرسل إلى العميل عبر واتساب» — the issued programme goes to the client
 *     only from this button, after the employee reviewed it; every send (or
 *     «أرسلته يدوياً») is recorded, so «أُرسل للعميل» is true and dated;
 *   - «العميل أكّد» — the client's confirmation opens the file's operation;
 *   - «إلغاء الملف» — before anything is booked or paid.
 *
 * Every export is callable from any signed-in browser: each one checks on the
 * server. Staff only (offers.write); a colleague's file can be read, but only
 * its own employee, operations or a manager act on it.
 */

export type FileError = "session" | "forbidden" | "notFound" | "notIssued" | "partner" | "cancelled" | "inOperations" | "already" | "empty" | "failed";
type Fail = { ok: false; error: FileError };

type Issued = {
  serial: string;
  offer: { id: string; status: string; employee_id: string | null; partner_company_id: string | null };
  mine: boolean;
};

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function issuedFile(draftId: string, act: boolean): Promise<Issued | Fail> {
  // the independent reads side by side — this gate opens every status panel
  const [user, staff, record, me] = await Promise.all([getServerUser(), currentCan("offers.write"), loadDraft(draftId), getCurrentEmployeeId()]);
  if (!user) return { ok: false, error: "session" };
  // a partner's own screen is the partner portal; Basic's status is staff's
  if (!staff) return { ok: false, error: "forbidden" };
  if (!record) return { ok: false, error: "notFound" };
  const serial = record.data.produced_serial;
  if (!serial) return { ok: false, error: "notIssued" };
  const { data } = await db().from("offers").select("id, status, employee_id, partner_company_id").eq("serial", serial).maybeSingle();
  const offer = data as Issued["offer"] | null;
  if (!offer) return { ok: false, error: "notFound" };
  const mine = !offer.employee_id || offer.employee_id === me;
  if (act && !mine) {
    const [ops, admin] = await Promise.all([currentCan("operations.write"), currentCan("dashboard.admin")]);
    if (!ops && !admin) return { ok: false, error: "forbidden" };
  }
  return { serial, offer, mine };
}
const failed = (r: Issued | Fail): r is Fail => "ok" in r;

export type FileStatusView = {
  ok: true;
  state: FileState;
  stale: boolean;
  serial: string;
  version: number | null;
  sentVersion: number | null;
  operationId: string | null;
  canOpenCase: boolean;
  cancel: ReturnType<typeof canCancelFile>;
  /** this employee may send, confirm and cancel (their own file, or operations / a manager). */
  canAct: boolean;
  /** a partner company's file: its client is theirs — no send from here. */
  partner: boolean;
  timeline: TimelineEntry[];
};

/** The file's state and history, for the editor's chip and panel. */
export async function getFileStatus(draftId: string): Promise<FileStatusView | Fail> {
  try {
    const file = await issuedFile(draftId, false);
    if (failed(file)) return file;
    const [detail, ops, admin, opensOps] = await Promise.all([loadFileStatus(file.serial), currentCan("operations.write"), currentCan("dashboard.admin"), currentCanOpen("/operations")]);
    if (!detail) return { ok: false, error: "notFound" };
    const manager = ops || admin;
    return {
      ok: true,
      state: detail.state,
      stale: detail.stale,
      serial: file.serial,
      version: detail.version,
      sentVersion: detail.sentVersion,
      operationId: detail.operation?.id ?? null,
      canOpenCase: Boolean(detail.operation) && opensOps,
      cancel: canCancelFile({ partner: Boolean(file.offer.partner_company_id), hasCase: Boolean(detail.operation), state: detail.state }),
      canAct: file.mine || manager,
      partner: Boolean(file.offer.partner_company_id),
      timeline: detail.timeline.slice(0, 40),
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export type OfferMessageDraft = {
  ok: true;
  body: string;
  toName: string;
  toPhone: string;
  link: string;
  pdf: string;
  /** why the system cannot send it itself now (the trial gate, no phone) — «أرسلته يدوياً» stays open */
  blocked: ClientSendResult | null;
  updated: boolean;
};

/** The programme's message, prepared for the employee to read and edit before sending. */
export async function prepareOfferMessage(draftId: string): Promise<OfferMessageDraft | Fail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file)) return file;
    if (file.offer.partner_company_id) return { ok: false, error: "partner" };
    if (file.offer.status === "cancelled") return { ok: false, error: "cancelled" };
    const updated = await newerThanSent(file.offer.id);
    const message = await offerMessage(file.serial, updated);
    if (!message) return { ok: false, error: "notFound" };
    const phone = message.client.customer?.mobile?.trim() ?? "";
    const blocked = phone ? await clientWhatsappAllowed(message.client) : "no_phone";
    return {
      ok: true,
      body: message.text,
      toName: message.client.customer?.arabic_name?.trim() ?? "",
      toPhone: phone,
      link: message.link,
      pdf: message.pdf,
      blocked,
      updated,
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}

async function sentAudits(offerId: string) {
  const { data } = await db().from("audit_logs").select("action, meta").eq("entity", "offers").eq("entity_id", offerId).eq("action", "offer.client_sent");
  return (data ?? []) as { action: string; meta: Record<string, unknown> | null }[];
}

async function latestVersion(offerId: string): Promise<number | null> {
  const { data } = await db().from("offer_renders").select("version").eq("offer_id", offerId).eq("variant", "client");
  return Math.max(0, ...((data ?? []) as { version: number }[]).map((r) => r.version)) || null;
}

/** «تم تحديث ملفك» only when the client had a version and this one is newer — a resend of the same says «تم إعداد». */
async function newerThanSent(offerId: string): Promise<boolean> {
  const [sent, latest] = await Promise.all([sentAudits(offerId).then(lastSentVersion), latestVersion(offerId)]);
  return sent != null && (latest ?? 0) > sent;
}

const MAX_BODY = 4000;

/**
 * «أرسل إلى العميل عبر واتساب» — the text as the employee left it — or
 * «أرسلته يدوياً» (`manual`: they sent it from their own phone). Recorded either
 * way with the version it carried; a note left outside WhatsApp's 24 hours is
 * recorded as that, never as sent.
 */
export async function sendOfferMessage(draftId: string, body: string, manual = false): Promise<{ ok: true; result: ClientSendResult | "manual"; at: string } | Fail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file)) return file;
    if (file.offer.partner_company_id) return { ok: false, error: "partner" };
    if (file.offer.status === "cancelled") return { ok: false, error: "cancelled" };
    const text = String(body ?? "").trim().slice(0, MAX_BODY);
    if (!manual && !text) return { ok: false, error: "empty" };
    const version = await latestVersion(file.offer.id);
    const at = new Date().toISOString();
    if (manual) {
      await logAudit({ action: "offer.client_sent", entity: "offers", entity_id: file.offer.id, meta: { result: "manual", version, serial: file.serial } });
      return { ok: true, result: "manual", at };
    }
    const updated = await newerThanSent(file.offer.id);
    const result = await sendOfferToClient(file.serial, updated, text);
    // what happened on WhatsApp is recorded; the trial gate («off», «not_allowed») sent nothing and records nothing
    if (result === "sent" || result === "template" || result === "window" || result === "no_phone" || result === "unreachable") {
      await logAudit({ action: "offer.client_sent", entity: "offers", entity_id: file.offer.id, meta: { result, version, serial: file.serial } });
    }
    return { ok: true, result, at };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * «العميل أكّد» from Basic — the kanban's confirmation (confirmOffer), from the
 * file itself. A cancelled offer is not confirmed back to life.
 */
export async function confirmFromBasic(draftId: string, channel: "whatsapp" | "phone" | "office"): Promise<{ ok: true; operationId: string; canOpen: boolean } | Fail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file)) return file;
    if (file.offer.status === "cancelled") return { ok: false, error: "cancelled" };
    const ch = channel === "phone" || channel === "office" ? channel : "whatsapp";
    const result = await confirmOffer({ offer_id: file.offer.id, channel: ch });
    if (!result.ok) return { ok: false, error: "failed" };
    return { ok: true, operationId: result.id, canOpen: await currentCanOpen("/operations") };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** «إلغاء الملف» — its own employee (or operations / a manager), before operations hold it. */
export async function cancelFile(draftId: string, reason: string): Promise<{ ok: true } | Fail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file)) return file;
    const note = String(reason ?? "").trim().slice(0, 300);
    if (!note) return { ok: false, error: "empty" };
    const { data: op } = await db().from("operations").select("id").eq("offer_id", file.offer.id).maybeSingle();
    const verdict = canCancelFile({
      partner: Boolean(file.offer.partner_company_id),
      hasCase: Boolean(op),
      state: file.offer.status === "cancelled" ? "cancelled" : "issued",
    });
    if (verdict !== "ok") return { ok: false, error: verdict };
    await setOfferStatus(db(), file.offer.id, "cancelled", note);
    await logAudit({ action: "offer.cancelled", entity: "offers", entity_id: file.offer.id, meta: { serial: file.serial, reason: note } });
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}
