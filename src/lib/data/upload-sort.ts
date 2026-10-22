"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { gateOperation, gateRow } from "@/lib/operations/access";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { readMoneyPaper, type MoneyPaper } from "@/lib/flights/ticket-ai";
import { MAX_TICKET_BYTES } from "@/lib/flights/ticket-parse";
import { amountIn, matchSupplier, supplierInText } from "@/lib/operations/wizard/upload-all";
import { caseBookings, sortBytes, staysOn, type PlacedStay, type SortedPaper } from "./paper-core";

/**
 * «ارفع كل الملفات» — one file → which paper it is, and its words for the
 * step's own reader (readBookingTicket / readHotelConfirmation take `text`, so
 * a photo is transcribed once). A PDF's text layer is sorted by its words; a
 * photo or a scan by one kind-only look (classifyPaper) — a passport is never
 * transcribed here: the MRZ reader reads it, audited, and gets a PDF's first
 * page as a picture. Nothing is stored or logged.
 */

export type { SortedPaper } from "./paper-core";

export async function sortPaper(operationId: string, formData: FormData): Promise<{ ok: true; paper: SortedPaper } | { ok: false; error: TranslationKey }> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "wz.up.err.empty" };
  if (file.size > MAX_TICKET_BYTES) return { ok: false, error: "wz.up.err.tooLarge" };
  try {
    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    return await sortBytes(Buffer.from(await file.arrayBuffer()), await caseBookings(db, operationId));
  } catch {
    return { ok: false, error: "wz.up.err.unreadable" };
  }
}

export type MoneyRead = MoneyPaper & {
  /** an invoice: what the booking costs on file, and who supplies it — beside what the paper says */
  cost: { amount: number | null; currency: string | null } | null;
  onFile: { id: string; name: string } | null;
  /** the issuer among our suppliers (matchSupplier); null with an issuer — offered as a new one */
  supplier: { id: string; name: string } | null;
};

/**
 * A money paper's figures (the owner, 2026-10-23): the model's reading where it
 * is on, the total and currency by amountIn where it is not or left them out.
 * An invoice is cost: pricing.internal, and it comes back with the booking's
 * cost and supplier on file and the issuer among our suppliers. A client's
 * slip is the case's own.
 */
export async function readMoney(
  operationId: string,
  input: { kind: "hotel_invoice" | "ticket_invoice" | "payment"; text: string; booking_id?: string; paper?: MoneyPaper },
): Promise<{ ok: true; read: MoneyRead } | { ok: false; error: TranslationKey }> {
  const invoice = input.kind !== "payment";
  const denied =
    (await gateOperation(operationId)) ??
    (invoice ? ((await currentCan("pricing.internal")) ? (input.booking_id ? await gateRow("operation_bookings", input.booking_id) : null) : "err.forbidden") : null);
  if (denied) return { ok: false, error: denied };
  try {
    const regex = amountIn(input.text);
    let paper: MoneyPaper = { issuer: "", hotel: "", amount: null, currency: "", date: "", reference: "", method: "", paid: false, sender: "" };
    // the figures the uploader already read off the file (sortPaper) — the browser's word, cut to shape
    if (input.paper) paper = givenMoney(input.paper, paper);
    else if (isOpenAIConfigured()) paper = await readMoneyPaper(input.text).catch(() => paper);
    paper = { ...paper, amount: paper.amount ?? regex.amount, currency: paper.currency || regex.currency || "" };
    if (!invoice) return { ok: true, read: { ...paper, cost: null, onFile: null, supplier: null } };

    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    const [{ data: suppliers }, { data: booking }] = await Promise.all([
      db.from("company_suppliers").select("id, arabic_name, english_name").neq("status", "Disabled"),
      input.booking_id
        ? db.from("operation_bookings").select("operation_id, quoted_net, net_charged, currency, assignee_supplier_id").eq("id", input.booking_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const list = (suppliers ?? []) as { id: string; arabic_name: string; english_name: string | null }[];
    const row = booking as { operation_id: string; quoted_net: number | null; net_charged: number | null; currency: string | null; assignee_supplier_id: string | null } | null;
    if (row && row.operation_id !== operationId) return { ok: false, error: "ops.err.notFound" };
    const own = row?.assignee_supplier_id ? list.find((s) => s.id === row.assignee_supplier_id) : null;
    const hit = paper.issuer ? matchSupplier(paper.issuer, list) : null;
    return {
      ok: true,
      read: {
        ...paper,
        cost: row ? { amount: row.net_charged ?? row.quoted_net, currency: row.currency } : null,
        onFile: own ? { id: own.id, name: own.arabic_name } : null,
        supplier: hit ? { id: hit.id, name: hit.arabic_name } : null,
      },
    };
  } catch {
    return { ok: false, error: "wz.up.err.unreadable" };
  }
}

function givenMoney(raw: MoneyPaper, blank: MoneyPaper): MoneyPaper {
  const str = (v: unknown, n = 120) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const amount = typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount > 0 ? Math.round(raw.amount * 100) / 100 : null;
  const method = ["transfer", "cash", "pos", "link"].includes(raw.method) ? raw.method : "";
  return {
    ...blank,
    issuer: str(raw.issuer),
    hotel: str(raw.hotel),
    amount,
    currency: /^[A-Z]{3}$/.test(str(raw.currency)) ? str(raw.currency) : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.date)) ? str(raw.date) : "",
    reference: str(raw.reference),
    method,
    paid: raw.paid === true,
    sender: str(raw.sender),
  };
}

export type PaperSupplier = { onFile: { id: string; name: string } | null; supplier: { id: string; name: string } | null };

/**
 * The supplier an airline's or a hotel supplier's paper names, beside the one
 * the booking has (the owner, 2026-10-23: «الموردين يتم تسجيلهم وفق
 * الفواتير») — offered on the line, set only when the employee approves it.
 */
export async function paperSupplier(operationId: string, bookingId: string, text: string): Promise<PaperSupplier> {
  const none: PaperSupplier = { onFile: null, supplier: null };
  if (!text.trim() || (await gateOperation(operationId)) || (await gateRow("operation_bookings", bookingId))) return none;
  try {
    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    const [{ data: suppliers }, { data: booking }] = await Promise.all([
      db.from("company_suppliers").select("id, arabic_name, english_name").neq("status", "Disabled"),
      db.from("operation_bookings").select("operation_id, assignee_supplier_id").eq("id", bookingId).maybeSingle(),
    ]);
    const list = (suppliers ?? []) as { id: string; arabic_name: string; english_name: string | null }[];
    const row = booking as { operation_id: string; assignee_supplier_id: string | null } | null;
    if (!row || row.operation_id !== operationId) return none;
    const own = row.assignee_supplier_id ? list.find((s) => s.id === row.assignee_supplier_id) : null;
    const hit = supplierInText(text, list);
    return { onFile: own ? { id: own.id, name: own.arabic_name } : null, supplier: hit ? { id: hit.id, name: hit.arabic_name } : null };
  } catch {
    return none;
  }
}

export type { PlacedStay } from "./paper-core";

/**
 * Each stay on a hotel paper, placed (the owner's samples, 2026-10-23): an
 * outside paper read whole by the model, ours by the parser; each stay put on
 * its booking by the hotel's name — the booking's title and its catalogue
 * names — then its day (paper-core.ts staysOn). A stay of a hotel the file does
 * not have comes back `other`, never on the file's only hotel.
 */
export async function hotelsOnPaper(operationId: string, text: string): Promise<{ issuer: string; stays: PlacedStay[] }> {
  const none = { issuer: "", stays: [] as PlacedStay[] };
  if (!text.trim() || (await gateOperation(operationId))) return none;
  try {
    return await staysOn(createSupabaseServiceClient() as unknown as SupabaseClient, operationId, text);
  } catch {
    return none;
  }
}
