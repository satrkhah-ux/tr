"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan, currentCanOpen } from "@/lib/roles/current";
import { gateOperation } from "@/lib/operations/access";
import { conversationForPhone } from "@/lib/providers/teletel";
import type { FileState } from "@/lib/offer/file-state";
import type { RepackageData } from "@/lib/repackage/repackage-types";
import { buildSupplierOrder } from "@/lib/repackage/supplier-order";
import { packageRef } from "@/lib/repackage/package-line";
import { supplierContact, type CompanySupplier } from "@/lib/repackage/supplier-match";
import { caseAccounts, fileAccounts, type RepackageAccounts } from "@/lib/repackage/accounts";
import { costInSellCurrency } from "@/lib/repackage/offer-input";
import type { FileError } from "./file-status";
import { loadFileStatus } from "./file-status-core";
import { confirmOffer } from "./operations";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { sendBookingRequest } from "./operation-assign";
import { pullBookingsFromOffer } from "./offer-pull";
import { loadCases } from "./operation-money";
import { getRates } from "./rates-actions";
import { loadRepackage, writeRepackageStages } from "./repackage-store";
import { registeredSupplier } from "./repackage-supplier";

/**
 * A repackaged file after it is issued: the client's confirmation, the order to
 * its supplier, and its full accounts (the owner, 2026-10-26).
 *
 *   - «تأكيد الطلب» is Basic's confirmation — the same confirmOffer the kanban
 *     and «العميل أكّد» use, so the case opens in «العمليات» like any file; a
 *     second press finds the case there and confirms nothing again.
 *   - the supplier's order is PREPARED here, reviewed by the employee, and sent
 *     through the existing channel (operation-assign.ts sendBookingRequest —
 *     logged on the case) only from a button; never automatically.
 *   - the accounts read the case's own figures (operation-money.ts).
 *
 * Every export is callable from any signed-in browser: each one checks on the
 * server — repackage.write for the file, offers.write for acting on it, and, as
 * on Basic's file, only its own employee, operations or a manager act.
 */

export type OrderError = FileError | "notConfirmed" | "noCost";
type Fail = { ok: false; error: OrderError };

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

type Issued = {
  id: string;
  data: RepackageData;
  serial: string;
  offer: { id: string; status: string; employee_id: string | null; partner_company_id: string | null };
  mine: boolean;
};

/** The file's offer — Basic's issuedFile (file-status.ts), by the repackage's id. */
async function issuedRepackage(id: string, act: boolean): Promise<Issued | Fail> {
  const [user, staff, record, me] = await Promise.all([getServerUser(), currentCan("offers.write"), loadRepackage(id), getCurrentEmployeeId()]);
  if (!user) return { ok: false, error: "session" };
  if (!staff) return { ok: false, error: "forbidden" };
  if (!record) return { ok: false, error: "notFound" };
  const serial = record.data.produced_serial;
  if (!serial) return { ok: false, error: "notIssued" };
  const { data } = await service().from("offers").select("id, status, employee_id, partner_company_id").eq("serial", serial).maybeSingle();
  const offer = data as Issued["offer"] | null;
  if (!offer) return { ok: false, error: "notFound" };
  const mine = !offer.employee_id || offer.employee_id === me;
  if (act && !mine) {
    const [ops, admin] = await Promise.all([currentCan("operations.write"), currentCan("dashboard.admin")]);
    if (!ops && !admin) return { ok: false, error: "forbidden" };
  }
  return { id, data: record.data, serial, offer, mine };
}
const failed = (r: Issued | Fail): r is Fail => "ok" in r;

async function caseOf(offerId: string): Promise<{ id: string } | null> {
  const { data } = await service().from("operations").select("id").eq("offer_id", offerId).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

// ---------------- where the file stands ----------------

export type RepackageFileView = {
  ok: true;
  serial: string;
  /** the version the client has now; null when it cannot be read. */
  version: number | null;
  state: FileState;
  operationId: string | null;
  /** the viewer may open the case page. */
  canOpenCase: boolean;
  /** this employee may confirm / order (their own file, or operations / a manager). */
  canAct: boolean;
};

/** «صدر · النسخة n» and the state — what the preview stage and its confirm button read. */
export async function getRepackageFile(id: string): Promise<RepackageFileView | Fail> {
  try {
    const file = await issuedRepackage(id, false);
    if (failed(file)) return file;
    const [detail, ops, admin, opensOps] = await Promise.all([loadFileStatus(file.serial), currentCan("operations.write"), currentCan("dashboard.admin"), currentCanOpen("/operations")]);
    if (!detail) return { ok: false, error: "notFound" };
    return {
      ok: true,
      serial: file.serial,
      version: detail.version,
      state: detail.state,
      operationId: detail.operation?.id ?? null,
      canOpenCase: Boolean(detail.operation) && opensOps,
      canAct: file.mine || ops || admin,
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * «تأكيد الطلب» — the client said yes. Basic's confirmation (confirmOffer: the
 * kanban's and «العميل أكّد»'s): the case opens in «العمليات» with the file's
 * bookings and the supplier's package line. Never twice: a file whose case is
 * already open answers with it and confirms nothing. A cancelled offer is not
 * confirmed back to life.
 */
export async function confirmRepackageOrder(
  id: string,
  channel: "whatsapp" | "phone" | "office",
): Promise<{ ok: true; operationId: string; canOpen: boolean; already: boolean } | Fail> {
  try {
    const file = await issuedRepackage(id, true);
    if (failed(file)) return file;
    if (file.offer.status === "cancelled") return { ok: false, error: "cancelled" };
    const canOpen = await currentCanOpen("/operations");
    const open = await caseOf(file.offer.id);
    if (open) return { ok: true, operationId: open.id, canOpen, already: true };
    const ch = channel === "phone" || channel === "office" ? channel : "whatsapp";
    const result = await confirmOffer({ offer_id: file.offer.id, channel: ch });
    if (!result.ok) return { ok: false, error: "failed" };
    return { ok: true, operationId: result.id, canOpen, already: false };
  } catch {
    return { ok: false, error: "failed" };
  }
}

// ---------------- the supplier's order ----------------

export type SupplierChoice = { id: string; name: string };

export type SupplierOrderDraft = {
  ok: true;
  /** the supplier as the registry holds it; `registered` false → no company_suppliers row matches its name. */
  supplier: { name: string; registered: boolean; reachable: boolean };
  to_label: string;
  to_phone: string | null;
  to_email: string | null;
  subject: string;
  body: string;
  canSendWhatsapp: boolean;
  /** when it was last sent (request_sent_at of the package line), null if never. */
  sentAt: string | null;
  /** registered suppliers to choose from when the match is missing or has no contact. */
  choices: SupplierChoice[];
};

type LineRow = { id: string; request_status: string | null; request_sent_at: string | null; assignee_kind: string | null };

/** The package line of the case — made by the pull when the case opened; a case opened before that gets it now. */
async function packageLineOf(operationId: string, offerId: string): Promise<LineRow | null> {
  const read = async () => {
    const { data } = await service()
      .from("operation_bookings")
      .select("id, request_status, request_sent_at, assignee_kind")
      .eq("operation_id", operationId)
      .eq("origin_ref", packageRef(offerId))
      .maybeSingle();
    return (data as LineRow | null) ?? null;
  };
  return (await read()) ?? ((await pullBookingsFromOffer(operationId)).ok ? await read() : null);
}

/**
 * The order message for the supplier, PREPARED — returned for the employee to
 * read, edit and send; nothing leaves here. After the confirmation only: the
 * order is for a package the client took. Carries every detail the supplier
 * needs and what we pay it, never what the client pays or what we earn
 * (buildSupplierOrder). A supplier with no registered contact still gets the
 * message — to copy and send by hand — and the employee is offered the contact
 * form once (saveSupplierContact).
 */
export async function prepareSupplierOrder(id: string): Promise<SupplierOrderDraft | Fail> {
  try {
    const file = await issuedRepackage(id, true);
    if (failed(file)) return file;
    if (file.offer.status === "cancelled") return { ok: false, error: "cancelled" };
    const op = await caseOf(file.offer.id);
    if (!op) return { ok: false, error: "notConfirmed" };
    const cost = file.data.extracted?.supplier_total;
    if (cost == null || !(cost > 0)) return { ok: false, error: "noCost" };
    const line = await packageLineOf(op.id, file.offer.id);
    if (!line) return { ok: false, error: "failed" };

    const db = service();
    const supplier = await registeredSupplier(db, file.data);
    const contact = supplier ? supplierContact(supplier) : null;
    const { data: trs } = await db.from("operation_travelers").select("display_name, traveler_kind").eq("operation_id", op.id).order("sort", { ascending: true });
    const travelers = ((trs ?? []) as { display_name: string; traveler_kind: "adult" | "child" | "infant" }[]).map((t) => ({ name: t.display_name, kind: t.traveler_kind }));

    const { subject, body } = buildSupplierOrder({
      lang: supplier?.request_lang ?? "ar",
      reference: file.serial,
      contact: contact?.person ?? null,
      data: file.data,
      travelers,
    });
    const to_phone = contact?.phone ?? null;
    const reachable = Boolean(contact?.reachable);
    const choices = reachable
      ? []
      : (((await db.from("company_suppliers").select("id, arabic_name").neq("status", "Disabled").order("arabic_name").limit(500)).data ?? []) as { id: string; arabic_name: string }[]).map((s) => ({
          id: s.id,
          name: s.arabic_name,
        }));
    return {
      ok: true,
      supplier: { name: file.data.source.supplier_name.trim() || supplier?.arabic_name || "", registered: Boolean(supplier), reachable },
      to_label: supplier?.arabic_name ?? (file.data.source.supplier_name.trim() || "المورّد"),
      to_phone,
      to_email: contact?.email ?? null,
      subject,
      body,
      canSendWhatsapp: to_phone ? (await conversationForPhone(to_phone)) !== null : false,
      sentAt: line.request_status === "sent" ? line.request_sent_at : null,
      choices,
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * «احفظ جهة الاتصال» — the supplier's contact, typed or chosen ONCE and kept on
 * the supplier (company_suppliers), so every later order finds it. A registered
 * supplier gets only what it lacks (a saved number is never overwritten); a new
 * one is made under the name the import carried. The file is linked to it, and the
 * package line is handed to it unless the clerk already gave the line to someone.
 */
export async function saveSupplierContact(
  id: string,
  input: { supplier_id?: string | null; contact_name?: string; phone?: string; email?: string; lang?: "ar" | "en" },
): Promise<{ ok: true; supplierId: string } | Fail> {
  try {
    const file = await issuedRepackage(id, true);
    if (failed(file)) return file;
    const op = await caseOf(file.offer.id);
    if (!op) return { ok: false, error: "notConfirmed" };
    const db = service();
    const text = (v: string | undefined, max: number) => String(v ?? "").trim().slice(0, max);
    const given = {
      contact_name: text(input.contact_name, 120),
      phone: text(input.phone, 40),
      email: text(input.email, 120),
    };

    let target: CompanySupplier | null = null;
    if (input.supplier_id) {
      const { data } = await db.from("company_suppliers").select("id, arabic_name, english_name, contact_name, mobile, whatsapp, email, request_lang, status").eq("id", input.supplier_id).maybeSingle();
      target = (data as CompanySupplier | null) ?? null;
      if (!target) return { ok: false, error: "notFound" };
    } else {
      target = await registeredSupplier(db, file.data);
    }

    let supplierId: string;
    if (target) {
      // fill what is empty, overwrite nothing
      const fill: Record<string, string> = {};
      if (given.contact_name && !target.contact_name?.trim()) fill.contact_name = given.contact_name;
      if (given.phone && !target.mobile?.trim() && !target.whatsapp?.trim()) {
        fill.mobile = given.phone;
        fill.whatsapp = given.phone;
      }
      if (given.email && !target.email?.trim()) fill.email = given.email;
      if (input.lang === "en" && target.request_lang !== "en" && Object.keys(fill).length > 0) fill.request_lang = "en";
      if (Object.keys(fill).length > 0) {
        const { error } = await db.from("company_suppliers").update(fill).eq("id", target.id);
        if (error) return { ok: false, error: "failed" };
      }
      supplierId = target.id;
    } else {
      const name = file.data.source.supplier_name.trim().slice(0, 120);
      if (name.length < 2) return { ok: false, error: "empty" };
      const latin = /[A-Za-z]/.test(name) && !/[؀-ۿ]/.test(name);
      const { data, error } = await db
        .from("company_suppliers")
        .insert({
          arabic_name: name,
          english_name: latin ? name : null,
          contact_name: given.contact_name || null,
          mobile: given.phone || null,
          whatsapp: given.phone || null,
          email: given.email || null,
          request_lang: input.lang === "en" ? "en" : "ar",
        })
        .select("id")
        .single();
      if (error || !data) return { ok: false, error: "failed" };
      supplierId = (data as { id: string }).id;
      await logAudit({ action: "booking.created", entity: "company_suppliers", entity_id: supplierId, meta: { from: "repackage", repackage_id: id } });
    }

    await writeRepackageStages(id, { source: { ...file.data.source, company_supplier_id: supplierId } });
    // the package line follows its supplier — only while it is still open and nobody else holds it
    await db
      .from("operation_bookings")
      .update({ assignee_kind: "supplier", assignee_supplier_id: supplierId })
      .eq("operation_id", op.id)
      .eq("origin_ref", packageRef(file.offer.id))
      .in("status", ["pending", "prebooked", "in_flight", "failed"])
      .eq("assignee_kind", "ops");
    return { ok: true, supplierId };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * «أرسل الطلب» — the text the employee reviewed (and may have edited) goes to
 * the supplier through the case's own channel (sendBookingRequest: WhatsApp, or
 * «manual» when they sent it themselves), is logged on the case, and marks the
 * package line requested. Only from this button.
 */
export async function sendSupplierOrder(
  id: string,
  input: { channel: "whatsapp" | "manual"; to_label: string; to_phone: string | null; body: string },
): Promise<{ ok: true } | Fail> {
  try {
    const file = await issuedRepackage(id, true);
    if (failed(file)) return file;
    if (file.offer.status === "cancelled") return { ok: false, error: "cancelled" };
    const op = await caseOf(file.offer.id);
    if (!op) return { ok: false, error: "notConfirmed" };
    const line = await packageLineOf(op.id, file.offer.id);
    if (!line) return { ok: false, error: "failed" };
    const body = String(input.body ?? "").trim().slice(0, 6000);
    if (!body) return { ok: false, error: "empty" };
    const sent = await sendBookingRequest({
      booking_id: line.id,
      operation_id: op.id,
      channel: input.channel === "manual" ? "manual" : "whatsapp",
      to_label: String(input.to_label ?? "").slice(0, 120),
      to_phone: input.to_phone,
      body,
    });
    return sent.ok ? { ok: true } : { ok: false, error: sent.error === "err.forbidden" || sent.error === "ops.err.forbidden" ? "forbidden" : "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}

// ---------------- the accounts ----------------

export type RepackageAccountsView = RepackageAccounts & {
  /** the case exists: the figures are its own, payments included; else the file's prices. */
  hasCase: boolean;
  operationId: string | null;
};

/**
 * The file's full accounts — sell, the supplier's cost, profit, what the client
 * paid and still owes, what we paid the supplier and still owe it. Cost and
 * profit, so pricing.internal and the case's own gate; null for anyone else
 * (never a partner, never the client).
 */
export async function getRepackageAccounts(id: string): Promise<RepackageAccountsView | null> {
  try {
    const file = await issuedRepackage(id, false);
    if (failed(file)) return null;
    if (!(await currentCan("pricing.internal"))) return null;
    const op = await caseOf(file.offer.id);
    if (op) {
      if (await gateOperation(op.id)) return null;
      const [c] = await loadCases(service(), op.id);
      return c ? { ...caseAccounts(c), hasCase: true, operationId: op.id } : null;
    }
    const pkg = file.data.extracted;
    const cost = pkg ? costInSellCurrency(pkg.supplier_total, pkg.supplier_currency, file.data.final_currency, (await getRates()).sarPer) : null;
    return { ...fileAccounts(file.data, cost?.ok ? cost.amount : null), hasCase: false, operationId: null };
  } catch {
    return null;
  }
}
