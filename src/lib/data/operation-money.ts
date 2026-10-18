import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { gateManager, gateOperation } from "@/lib/operations/access";
import { defaultSchedule, paidTotal, riyadhDate, type Installment } from "@/lib/operations/payments";
import { bookingCost } from "@/lib/operations/supplier-request";
import {
  caseProfit,
  cashflowBuckets,
  clientDue,
  expectedCost,
  groupProfit,
  lineBuy,
  openInvoices,
  stillOwed,
  supplierDueDate,
  type CaseBooking,
  type CaseFacts,
  type CaseProfit,
  type CashBucket,
  type CashItem,
  type Money,
  type PricingLine,
  type ProfitRow,
} from "@/lib/operations/money";

/**
 * The money views of operations order 11 (items 7 and 8): a case's profit, the
 * profitability report, and the weekly cash flow.
 *
 * Every figure here is cost or profit, so: pricing.internal is checked FIRST,
 * then the SERVICE client reads — 0047/0063 close offer_pricing_items, pricings
 * and supplier_payments to every session. Server-only (not "use server"): only
 * server pages call these, so none of it is an endpoint a browser can reach.
 * The arithmetic is in lib/operations/money.ts.
 */

async function allowed(): Promise<boolean> {
  return Boolean(await getServerUser()) && (await currentCan("pricing.internal"));
}

/**
 * The reports across every case (profitability, cash flow) are the manager's
 * too: a salesperson holds pricing.internal, and an own-files holder sees their
 * own case's profit only (getCaseProfit).
 */
async function allowedAll(): Promise<boolean> {
  return (await allowed()) && !(await gateManager());
}

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

// PostgREST returns an embedded relation as an array even when to-one.
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const PAGE = 1000; // PostgREST's default max rows: a longer read is cut silently, so page past it
const CHUNK = 50; // ids per `in (...)` — keeps the URL short

async function paged<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

async function rowsIn<T>(db: SupabaseClient, table: string, columns: string, column: string, ids: string[]): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const pages = await Promise.all(
    chunks.map((chunk) => paged<T>((from, to) => db.from(table).select(columns).in(column, chunk).order("id").range(from, to))),
  );
  return pages.flat();
}

type OfferRow = {
  id: string;
  serial: string;
  destination: string | null;
  total: number | null;
  currency: string | null;
  employee_id: string | null;
  partner_company_id: string | null;
  partner_cost: number | null;
};

type OpRow = {
  id: string;
  client_status: string;
  execution_status: string;
  travel_start: string | null;
  confirmed_at: string;
  confirmed_by: string | null;
  offers: OfferRow | OfferRow[] | null;
};

type BookingRow = {
  id: string;
  operation_id: string;
  title: string;
  status: string;
  is_paid: boolean;
  start_date: string | null;
  cancellation_deadline: string | null;
  quoted_net: number | null;
  net_charged: number | null;
  currency: string | null;
  origin_ref: string | null;
};

type FlowRow = { operation_id: string; amount: number; currency: string; kind: string; paid_at?: string | null };
type InvoiceRow = { offer_id: string; partner_id: string; amount: number; currency: string; issued_at: string };

export type LoadedCase = {
  id: string;
  client_status: string;
  offer_id: string | null;
  serial: string;
  destination: string | null;
  employee_id: string | null;
  /** the Riyadh month it was confirmed in, YYYY-MM. */
  month: string;
  travel_start: string | null;
  confirmed_on: string;
  cancelled: boolean;
  currency: string;
  total: number | null;
  facts: CaseFacts;
  bookings: (CaseBooking & { title: string })[];
  installments: Installment[];
  /** net client payments, all currencies — what PaymentsPanel settles its schedule with. */
  paid: number;
  /** the Riyadh day of the client's last payment (refunds aside); null = none yet. */
  last_paid_on: string | null;
};

/** Every case (or one), with the money facts the pure functions need. */
export async function loadCases(db: SupabaseClient, operationId?: string): Promise<LoadedCase[]> {
  const ops = await paged<OpRow>((from, to) => {
    let q = db
      .from("operations")
      .select(
        "id, client_status, execution_status, travel_start, confirmed_at, confirmed_by, offers(id, serial, destination, total, currency, employee_id, partner_company_id, partner_cost)",
      )
      .order("id");
    if (operationId) q = q.eq("id", operationId);
    return q.range(from, to);
  });
  if (ops.length === 0) return [];

  const ids = ops.map((o) => o.id);
  const offerIds = ops.map((o) => one(o.offers)?.id).filter((x): x is string => !!x);
  const [payments, installments, bookings, supplierPays, pricings, items, invoices] = await Promise.all([
    rowsIn<FlowRow>(db, "operation_payments", "id, operation_id, amount, currency, kind, paid_at", "operation_id", ids),
    rowsIn<{ operation_id: string; due_date: string; amount: number }>(db, "operation_installments", "id, operation_id, due_date, amount", "operation_id", ids),
    rowsIn<BookingRow>(
      db,
      "operation_bookings",
      "id, operation_id, title, status, is_paid, start_date, cancellation_deadline, quoted_net, net_charged, currency, origin_ref",
      "operation_id",
      ids,
    ),
    rowsIn<FlowRow>(db, "supplier_payments", "id, operation_id, amount, currency, kind", "operation_id", ids),
    rowsIn<{ offer_id: string; buy_total: number | null; currency: string | null }>(db, "pricings", "id, offer_id, buy_total, currency", "offer_id", offerIds),
    rowsIn<PricingLine & { id: string; offer_id: string }>(
      db,
      "offer_pricing_items",
      "id, offer_id, quantity, buy_price, buy_currency, total_buy",
      "offer_id",
      offerIds,
    ),
    rowsIn<InvoiceRow>(db, "partner_invoices", "id, offer_id, partner_id, amount, currency, issued_at", "offer_id", offerIds),
  ]);

  const group = <T,>(list: T[], key: (r: T) => string) => {
    const by = new Map<string, T[]>();
    for (const r of list) {
      const k = key(r);
      const rows = by.get(k);
      if (rows) rows.push(r);
      else by.set(k, [r]);
    }
    return by;
  };
  const paysBy = group(payments, (r) => r.operation_id);
  const instBy = group(installments, (r) => r.operation_id);
  const bookBy = group(bookings, (r) => r.operation_id);
  const supBy = group(supplierPays, (r) => r.operation_id);
  const itemsBy = group(items, (r) => r.offer_id);
  const pricingBy = new Map(pricings.map((p) => [p.offer_id, p]));
  const invoiceBy = new Map(invoices.map((i) => [i.offer_id, i]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const flow = (r: FlowRow) => ({ amount: Number(r.amount), currency: r.currency || "SAR", kind: r.kind });

  return ops.map((op) => {
    const offer = one(op.offers);
    const currency = offer?.currency || "SAR";
    const total = offer?.total != null ? Number(offer.total) : null;
    const partner = Boolean(offer?.partner_company_id);
    const inv = offer ? invoiceBy.get(offer.id) : undefined;
    const invoice: Money | null = inv
      ? { amount: Number(inv.amount), currency: inv.currency }
      : partner && offer?.partner_cost != null
        ? { amount: Number(offer.partner_cost), currency }
        : null;
    const pricing = offer ? pricingBy.get(offer.id) : undefined;

    const caseBookings = (bookBy.get(op.id) ?? []).map((b) => {
      // a booking pulled from a pricing line (`visa:<id>`, `transport:<id>`) costs that line's buy — supplier-work's rule
      const lineId = b.origin_ref?.match(/^(?:visa|transport):([0-9a-f-]{36})$/)?.[1];
      const line = lineId ? itemById.get(lineId) : undefined;
      return {
        title: b.title,
        status: b.status,
        is_paid: b.is_paid,
        start_date: b.start_date,
        deadline: b.cancellation_deadline ? riyadhDate(b.cancellation_deadline) : null,
        cost: bookingCost(b, line ? lineBuy(line, currency) : null),
      };
    });
    const clientPayments = (paysBy.get(op.id) ?? []).map(flow);
    const confirmedOn = riyadhDate(op.confirmed_at);

    const lastPaid = (paysBy.get(op.id) ?? [])
      .filter((p) => p.kind !== "refund" && p.paid_at)
      .reduce<string | null>((max, p) => (max && max > p.paid_at! ? max : p.paid_at!.slice(0, 10)), null);

    return {
      id: op.id,
      client_status: op.client_status,
      last_paid_on: lastPaid,
      offer_id: offer?.id ?? null,
      serial: offer?.serial ?? "",
      destination: offer?.destination ?? null,
      employee_id: offer?.employee_id ?? op.confirmed_by,
      month: confirmedOn.slice(0, 7),
      travel_start: op.travel_start,
      confirmed_on: confirmedOn,
      cancelled: op.client_status === "cancelled" || op.execution_status === "cancelled",
      currency,
      total,
      facts: {
        sale: partner ? invoice : total != null ? { amount: total, currency } : null,
        expectedCost: expectedCost(
          pricing?.buy_total != null ? { amount: Number(pricing.buy_total), currency: pricing.currency || currency } : null,
          (offer ? itemsBy.get(offer.id) : undefined) ?? [],
          currency,
        ),
        partner,
        invoice,
        clientPayments,
        supplierPayments: (supBy.get(op.id) ?? []).map(flow),
        bookings: caseBookings,
      },
      bookings: caseBookings,
      installments: (instBy.get(op.id) ?? []).map((i) => ({ due_date: i.due_date, amount: Number(i.amount) })),
      paid: paidTotal(clientPayments),
    };
  });
}

// ------------------------------------------------------------- one case ----

export type CaseProfitView = CaseProfit & { partner: boolean };

/** «ربحية الحالة» on the case page; null for anyone without pricing.internal. */
export async function getCaseProfit(operationId: string): Promise<CaseProfitView | null> {
  if (!(await allowed()) || (await gateOperation(operationId))) return null;
  try {
    const [c] = await loadCases(service(), operationId);
    return c ? { ...caseProfit(c.facts), partner: c.facts.partner } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- the report ----

export type ProfitReport = {
  from: string;
  to: string;
  cases: number;
  total: ProfitRow[];
  byMonth: (ProfitRow & { key: string })[];
  byEmployee: (ProfitRow & { key: string })[];
  byDestination: (ProfitRow & { key: string })[];
};

const isMonth = (s: string | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/**
 * Cases by the month they were confirmed, the employee who sold them (else who
 * confirmed them) and the destination. Cancelled cases are left out.
 * `from`/`to` are YYYY-MM; anything else means the last twelve months.
 */
export async function getProfitReport(range: { from?: string; to?: string }): Promise<ProfitReport | null> {
  if (!(await allowedAll())) return null;
  try {
    const db = service();
    const all = (await loadCases(db)).filter((c) => !c.cancelled);
    const thisMonth = riyadhDate().slice(0, 7);
    const yearAgo = (() => {
      const [y, m] = thisMonth.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 - 11, 1));
      return d.toISOString().slice(0, 7);
    })();
    const from = isMonth(range.from) ? range.from : yearAgo;
    const to = isMonth(range.to) ? range.to : thisMonth;
    const cases = all.filter((c) => c.month >= from && c.month <= to).map((c) => ({ ...c, profit: caseProfit(c.facts) }));

    const employeeIds = [...new Set(cases.map((c) => c.employee_id).filter((x): x is string => !!x))];
    const employees = await rowsIn<{ id: string; arabic_name: string }>(db, "employees", "id, arabic_name", "id", employeeIds);
    const name = new Map(employees.map((e) => [e.id, e.arabic_name]));

    const desc = <T extends { key: string }>(rows: T[]) => rows.sort((a, b) => b.key.localeCompare(a.key));
    const asc = <T extends { key: string }>(rows: T[]) => rows.sort((a, b) => a.key.localeCompare(b.key, "ar"));
    return {
      from,
      to,
      cases: cases.length,
      total: groupProfit(cases, () => ""),
      byMonth: desc(groupProfit(cases, (c) => c.month)),
      // "" = unknown; the page labels it
      byEmployee: asc(groupProfit(cases, (c) => (c.employee_id ? (name.get(c.employee_id) ?? "") : ""))),
      byDestination: asc(groupProfit(cases, (c) => c.destination?.trim() ?? "")),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ cash flow ----

export type Cashflow = { today: string; buckets: CashBucket[] };

/**
 * Money due IN (what clients still owe on their installments; partner invoices
 * not yet settled) against money due OUT (the cost of confirmed bookings not
 * paid yet), per week and currency. Cancelled cases are left out — except a
 * partner's invoice, which stays on its account whatever became of the file.
 */
export async function getCashflow(): Promise<Cashflow | null> {
  if (!(await allowedAll())) return null;
  try {
    const db = service();
    const today = riyadhDate();
    const [cases, invoices, partnerPays] = await Promise.all([
      loadCases(db),
      paged<InvoiceRow & { offers: { serial: string } | { serial: string }[] | null }>((from, to) =>
        db.from("partner_invoices").select("id, offer_id, partner_id, amount, currency, issued_at, offers(serial)").order("id").range(from, to),
      ),
      paged<{ partner_id: string; amount: number; currency: string }>((from, to) =>
        db.from("partner_payments").select("id, partner_id, amount, currency").order("id").range(from, to),
      ),
    ]);
    const live = cases.filter((c) => !c.cancelled);
    const items: CashItem[] = [];

    for (const c of live) {
      if (!c.facts.partner) {
        // the schedule staff set, else the house terms — as the case page shows it
        const schedule =
          c.installments.length > 0 ? c.installments : defaultSchedule({ total: c.total, confirmed_on: c.confirmed_on, travel_start: c.travel_start });
        for (const due of clientDue(schedule, c.paid, today)) {
          items.push({ direction: "in", kind: "installment", date: due.date, amount: due.amount, currency: c.currency, operation_id: c.id, serial: c.serial, title: "" });
        }
      }
      for (const b of c.bookings.filter(stillOwed)) {
        const cost = b.cost as Money;
        items.push({ direction: "out", kind: "supplier", date: supplierDueDate(b), amount: cost.amount, currency: cost.currency, operation_id: c.id, serial: c.serial, title: b.title });
      }
    }

    // a partner pays by the time its client travels; no trip date → due from the day it was invoiced
    const caseByOffer = new Map(cases.filter((c) => c.offer_id).map((c) => [c.offer_id as string, c]));
    const open = openInvoices(
      invoices.map((i) => ({ ...i, amount: Number(i.amount), serial: one(i.offers)?.serial ?? "" })),
      partnerPays.map((p) => ({ ...p, amount: Number(p.amount) })),
    );
    for (const inv of open) {
      if (!(inv.open > 0)) continue;
      const c = caseByOffer.get(inv.offer_id);
      items.push({
        direction: "in",
        kind: "partner_invoice",
        date: c?.travel_start ?? riyadhDate(inv.issued_at),
        amount: inv.open,
        currency: inv.currency,
        operation_id: c?.id ?? null,
        serial: inv.serial,
        title: "",
      });
    }

    return { today, buckets: cashflowBuckets(items, today) };
  } catch {
    return null;
  }
}
