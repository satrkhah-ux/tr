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
import { getOfferCover } from "./offer-cover";
import type { CoverStyle } from "@/components/offer-doc/cover-image";
import type { TranslationKey } from "@/lib/i18n";
import { loadPayFile, payLink } from "@/lib/payments/pay-now";
import { showsPayNow } from "@/lib/payments/pay-now-rules";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";

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
  /** the PDF's first page the employee chose («أساسي» / «فني») — read by the link, the PDF and the send */
  cover: CoverStyle;
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
      cover: await getOfferCover(file.serial),
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
  serial: string;
  cover: CoverStyle;
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
      serial: file.serial,
      cover: message.cover,
      blocked,
      updated,
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * «غلاف الملف» — the first page of the client PDF, «أساسي» or «فني», kept on the offer: the client link, its PDF, the
 * WhatsApp send and a re-issue (same serial) all follow it. The labels are for staff only; nothing prints them.
 */
export async function setPdfCover(draftId: string, cover: CoverStyle): Promise<{ ok: true; cover: CoverStyle } | Fail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file)) return file;
    if (file.offer.partner_company_id) return { ok: false, error: "partner" };
    const next: CoverStyle = cover === "designed" ? "designed" : "basic";
    const { error } = await db().from("offers").update({ pdf_cover: next }).eq("id", file.offer.id);
    if (error) return { ok: false, error: "failed" };
    return { ok: true, cover: next };
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
/** The first page of the PDF is the employee's stored choice for the offer (setPdfCover) — «أساسي» (default) or «فني». */
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
    const cover = await getOfferCover(file.serial);
    // what happened on WhatsApp is recorded; the trial gate («off», «not_allowed») sent nothing and records nothing
    if (result === "sent" || result === "template" || result === "window" || result === "no_phone" || result === "unreachable") {
      await logAudit({ action: "offer.client_sent", entity: "offers", entity_id: file.offer.id, meta: { result, version, serial: file.serial, ...(cover === "designed" ? { cover } : {}) } });
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

/**
 * «حذف» — one file or several, from the files list (the owner, 2026-10-17). A
 * draft goes; an issued file goes with its offer (its renders, lines and history
 * cascade) — only while nothing is booked or paid: a file in operations is
 * cancelled from its case, never deleted. Never a partner's file. A salesperson
 * deletes their OWN files only; a colleague's, or one made before its maker was
 * recorded, takes operations or a manager. The audit row (service-only) comes
 * FIRST — the offer's serial and total, and the draft as it was, so a wrong press
 * can be rebuilt — and nothing is deleted when it cannot be written (as
 * deletePayment).
 */
export async function deleteFiles(draftIds: string[]): Promise<{ ok: true; deleted: number; refused: number } | Fail> {
  try {
    const [user, staff, me, ops, admin] = await Promise.all([
      getServerUser(),
      currentCan("offers.write"),
      getCurrentEmployeeId(),
      currentCan("operations.write"),
      currentCan("dashboard.admin"),
    ]);
    if (!user) return { ok: false, error: "session" };
    if (!staff) return { ok: false, error: "forbidden" };
    const ids = [...new Set((draftIds ?? []).map(String))].slice(0, 200);
    if (ids.length === 0) return { ok: false, error: "empty" };
    const may = (owner: string | null) => (owner !== null && owner === me) || ops || admin;

    const { data } = await db().from("offer_drafts").select("id, title, data, created_by, partner_company_id").in("id", ids);
    let deleted = 0;
    for (const d of (data ?? []) as { id: string; title: string | null; data: Record<string, unknown>; created_by: string | null; partner_company_id: string | null }[]) {
      if (d.partner_company_id) continue;
      const serial = typeof d.data.produced_serial === "string" ? d.data.produced_serial : null;
      const record = (offer: { id: string; total: number | null; currency: string | null } | null) =>
        logAudit({
          action: serial ? "offer.deleted" : "draft.deleted",
          entity: "offer_drafts",
          entity_id: d.id,
          meta: { serial, offer_id: offer?.id ?? null, total: offer?.total ?? null, currency: offer?.currency ?? null, title: d.title, draft: d.data },
        });
      if (serial) {
        const { data: o } = await db().from("offers").select("id, employee_id, partner_company_id, total, currency").eq("serial", serial).maybeSingle();
        const offer = o as { id: string; employee_id: string | null; partner_company_id: string | null; total: number | null; currency: string | null } | null;
        if (offer) {
          if (offer.partner_company_id || !may(offer.employee_id)) continue;
          // checked here, not trusted from the list: a booked file is never deleted
          const { data: op } = await db().from("operations").select("id").eq("offer_id", offer.id).maybeSingle();
          if (op) continue;
          if (!(await record(offer))) continue;
          if ((await db().from("offers").delete().eq("id", offer.id)).error) continue;
          if (!(await db().from("offer_drafts").delete().eq("id", d.id)).error) deleted += 1;
          continue;
        }
        if (!may(d.created_by)) continue;
      } else if (!may(d.created_by)) continue;
      if (!(await record(null))) continue;
      if ((await db().from("offer_drafts").delete().eq("id", d.id)).error) continue;
      deleted += 1;
    }
    return { ok: true, deleted, refused: ids.length - deleted };
  } catch {
    return { ok: false, error: "failed" };
  }
}

type PayFail = { ok: false; error: TranslationKey };

/**
 * «رابط الدفع» in Basic (the owner, 2026-10-29): our stable /pay/<serial> — bare when the client pays by
 * MyFatoorah (the PDF's own button), or with a deposit / instalment `amount` signed on the server so the client
 * cannot change it. A file whose way is not MyFatoorah needs an amount: its total carries another way's charge.
 */
export async function basicPayLink(draftId: string, amount?: number | null): Promise<{ ok: true; url: string; amount: number } | PayFail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file) || file.offer.partner_company_id || file.offer.status === "cancelled") return { ok: false, error: "pay.link.forbidden" };
    const loaded = await loadPayFile(file.serial);
    if (!loaded || loaded.file.total == null) return { ok: false, error: "pay.link.forbidden" };
    if (loaded.file.currency !== "SAR") return { ok: false, error: "pay.err.sarOnly" };
    if (amount != null && String(amount) !== "") {
      const value = Math.round(Number(amount) * 100) / 100;
      if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return { ok: false, error: "pay.err.amount" };
      return { ok: true, url: payLink(file.serial, value), amount: value };
    }
    if (!showsPayNow(loaded.file.method)) return { ok: false, error: "pay.link.amountNeeded" };
    return { ok: true, url: payLink(file.serial), amount: Math.max(0, Math.round((loaded.file.total - loaded.file.paid) * 100) / 100) };
  } catch {
    return { ok: false, error: "pay.link.forbidden" };
  }
}

/** «أرسل رابط الدفع» — the text the employee reviewed, into the client's Teletel conversation; never automatic. */
export async function sendBasicPayLink(draftId: string, body: string): Promise<{ ok: true } | PayFail> {
  try {
    const file = await issuedFile(draftId, true);
    if (failed(file) || file.offer.partner_company_id || file.offer.status === "cancelled") return { ok: false, error: "pay.link.forbidden" };
    const text = String(body ?? "").trim().slice(0, MAX_BODY);
    if (!text.includes("/pay/")) return { ok: false, error: "pay.link.failed" };
    const { data } = await db().from("offers").select("employee_id, partner_company_id, customers(arabic_name, mobile)").eq("id", file.offer.id).maybeSingle();
    const row = data as { employee_id: string | null; partner_company_id: string | null; customers: unknown } | null;
    const customer = (Array.isArray(row?.customers) ? row?.customers[0] : row?.customers) as { arabic_name: string | null; mobile: string | null } | null;
    // the same gate the programme's send keeps (trial modes, a partner's client)
    if (!row || (await clientWhatsappAllowed({ employee_id: row.employee_id, partner_company_id: row.partner_company_id, customer }))) return { ok: false, error: "pay.link.failed" };
    const conversationId = customer?.mobile ? await conversationForPhone(customer.mobile) : null;
    const sent = conversationId ? await sendTeletelMessage(conversationId, text) : null;
    if (sent === null) return { ok: false, error: "pay.link.failed" };
    await logAudit({ action: "payment_link.sent", entity: "offers", entity_id: file.offer.id, meta: { serial: file.serial, from: "basic" } });
    return { ok: true };
  } catch {
    return { ok: false, error: "pay.link.failed" };
  }
}
