import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { gateManager } from "@/lib/operations/access";
import { riyadhDate } from "@/lib/operations/payments";
import { accountsHome, recentMonths, type AccountsHome, type HomePayment, type HomeSupplierLine } from "@/lib/accounts/home";
import { invoiceOf, type InvoiceStatus, type InvoiceView } from "@/lib/accounts/invoice";
import { expenseTotals, type Expense } from "@/lib/accounts/expenses";
import { listSupplierAccounts } from "./supplier-work";
import { financeFixedCost } from "./finance";
import { quotesView, type Quote, type QuotesView } from "@/lib/accounts/quotes";
import { journal } from "@/lib/accounts/journal";
import { byCurrency } from "@/lib/operations/money";
import { loadCases, type LoadedCase } from "./operation-money";

/**
 * «الحسابات» — the financial section's home, for finance.accounts (2026-10-30). Read-only, from the
 * confirmed cases and their payments, schedules and bookings (lib/accounts/home.ts does the arithmetic).
 * Server-only: it reads costs through the service client, behind the permission.
 */

const CHUNK = 50; // ids per `in (...)` — keeps the URL short
const isMonth = (s: string | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function chunked<T>(ids: string[], read: (part: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export type AccountsHomeView = AccountsHome & {
  months: string[];
  /** the overdue files' client names, by case id */
  clients: Record<string, string>;
  /** «تقرير الربحية» and «التدفق النقدي» open to this account too (pricing.internal, every file) */
  reports: boolean;
  /** the month's «المصروفات» (riyals) and the profit after them */
  expenses: ReturnType<typeof expenseTotals>;
  net: number;
  /** what we owe suppliers today, riyals (their confirmed bookings less what we paid them) */
  supplierOwed: number;
  /** the month's salaries, rents and instalments from «الحسابات المالية» — only to whoever unlocked the book; else null */
  ownerFixed: number | null;
};

export async function getAccountsHome(monthParam?: string): Promise<AccountsHomeView | null> {
  if (!(await getServerUser()) || !(await currentCan("finance.accounts"))) return null;
  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const today = riyadhDate();
  const thisMonth = today.slice(0, 7);
  const month = isMonth(monthParam) && monthParam <= thisMonth ? monthParam : thisMonth;
  const [y, m] = month.split("-").map(Number);

  const cases = await loadCases(db);
  const monthIds = cases.filter((c) => c.month === month).map((c) => c.id);
  const [{ data: pays, error: payError }, bookings] = await Promise.all([
    // a day on either side: paid_at is a timestamp, the month is Riyadh's (accountsHome keeps the month's own days)
    db
      .from("operation_payments")
      .select("operation_id, amount, currency, kind, paid_at")
      .gte("paid_at", new Date(Date.UTC(y, m - 1, 0)).toISOString())
      .lt("paid_at", new Date(Date.UTC(y, m, 2)).toISOString())
      .limit(5000),
    chunked<{ operation_id: string; supplier_name: string | null; net_charged: number | null; quoted_net: number | null; currency: string | null; status: string }>(
      monthIds,
      (part) => db.from("operation_bookings").select("operation_id, supplier_name, net_charged, quoted_net, currency, status").in("operation_id", part),
    ),
  ]);
  if (payError) throw payError;
  const payments: HomePayment[] = ((pays ?? []) as { operation_id: string; amount: number | string; currency: string | null; kind: string; paid_at: string | null }[]).map((p) => ({
    operation_id: p.operation_id,
    amount: Number(p.amount),
    currency: p.currency || "SAR",
    kind: p.kind,
    paid_on: p.paid_at ? riyadhDate(p.paid_at) : null,
  }));
  const suppliers: HomeSupplierLine[] = bookings.map((b) => ({
    operation_id: b.operation_id,
    supplier: b.supplier_name ?? "",
    cost: Number(b.net_charged ?? b.quoted_net ?? 0),
    currency: b.currency || "SAR",
    status: b.status,
  }));

  const home = accountsHome({ month, today, cases, payments, suppliers });

  const clients = await clientNames(db, home.overdue.invoices.map((i) => i.id));

  const [reports, spent, suppliersList, ownerFixed] = await Promise.all([
    (async () => (await currentCan("pricing.internal")) && !(await gateManager()))(),
    readExpenses(db, month),
    listSupplierAccounts(),
    financeFixedCost(month),
  ]);
  const expenses = expenseTotals(spent, month);
  const supplierOwed = (suppliersList?.suppliers ?? [])
    .flatMap((s) => s.balances)
    .filter((b) => b.currency === "SAR" && b.balance > 0)
    .reduce((sum, b) => sum + b.balance, 0);
  return { ...home, months: recentMonths(thisMonth), clients, reports, expenses, net: Math.round((home.profit - expenses.total) * 100) / 100, supplierOwed: Math.round(supplierOwed * 100) / 100, ownerFixed };
}

/** the cases' client names, by case id */
async function clientNames(db: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const rows = await chunked<{ id: string; offers: unknown }>(ids, (part) => db.from("operations").select("id, offers(customers(arabic_name))").in("id", part));
  const out: Record<string, string> = {};
  for (const r of rows) {
    const customer = one(one(r.offers as { customers: unknown } | null)?.customers as { arabic_name: string | null } | null);
    if (customer?.arabic_name) out[r.id] = customer.arabic_name;
  }
  return out;
}

// ------------------------------------------------------------- «الفواتير» ----
// The internal invoice (stage 2, the owner: «الفاتورة داخلية»): a confirmed case of our own read as one
// (lib/accounts/invoice.ts). A partner's file is billed to the partner (partner_invoices), not here.

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const allowed = async () => Boolean(await getServerUser()) && (await currentCan("finance.accounts"));
const invoiceable = (c: LoadedCase) => !c.cancelled && !c.facts.partner;

export type InvoiceRow = Pick<InvoiceView, "number" | "status" | "total" | "paid" | "due"> & {
  id: string; client: string; date: string; currency: string; confirmed: boolean;
};

export async function listInvoices(): Promise<{ rows: InvoiceRow[]; counts: Record<InvoiceStatus | "all", number> } | null> {
  if (!(await allowed())) return null;
  const supabase = db();
  const today = riyadhDate();
  const cases = (await loadCases(supabase)).filter(invoiceable);
  const [clients, { data: confirmations, error }] = await Promise.all([
    clientNames(supabase, cases.map((c) => c.id)),
    supabase.from("invoice_confirmations").select("operation_id"),
  ]);
  if (error) throw error;
  const confirmed = new Set(((confirmations ?? []) as { operation_id: string }[]).map((r) => r.operation_id));
  const rows = cases
    .map((c) => {
      const inv = invoiceOf({ ...c, payments: [] }, today);
      return { id: c.id, number: inv.number, status: inv.status, total: inv.total, paid: inv.paid, due: inv.due, client: clients[c.id] ?? "", date: c.confirmed_on, currency: c.currency, confirmed: confirmed.has(c.id) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const counts = { all: rows.length, paid: 0, partial: 0, overdue: 0, due: 0 };
  for (const r of rows) counts[r.status] += 1;
  return { rows, counts };
}

export type InvoiceDetail = InvoiceView & {
  id: string;
  client: string;
  date: string;
  currency: string;
  /** the offer the case came from — «الطلب المصدر» */
  source: { serial: string; destination: string | null; travel_start: string | null };
  /** what the trip holds, by name only — never a buy price */
  items: { kind: string; title: string; city: string | null; from: string | null; to: string | null }[];
  receipts: { amount: number; kind: string; method: string | null; on: string | null; receipt_no: string | null }[];
  confirmation: { at: string; by: string } | null;
};

export async function getInvoice(operationId: string): Promise<InvoiceDetail | null> {
  if (!(await allowed()) || !/^[0-9a-f-]{36}$/.test(operationId)) return null;
  const supabase = db();
  const [c] = await loadCases(supabase, operationId);
  if (!c || !invoiceable(c)) return null;
  const [clients, inst, pays, books, conf] = await Promise.all([
    clientNames(supabase, [c.id]),
    supabase.from("operation_installments").select("due_date, amount, note").eq("operation_id", c.id),
    supabase.from("operation_payments").select("amount, kind, method, paid_at, receipt_no").eq("operation_id", c.id).order("paid_at"),
    supabase.from("operation_bookings").select("kind, title, city_name, start_date, end_date, status").eq("operation_id", c.id).neq("status", "cancelled").order("start_date"),
    supabase.from("invoice_confirmations").select("confirmed_at, employees(arabic_name)").eq("operation_id", c.id).maybeSingle(),
  ]);
  for (const r of [inst, pays, books, conf]) if (r.error) throw r.error;
  const receipts = ((pays.data ?? []) as { amount: number | string; kind: string; method: string | null; paid_at: string | null; receipt_no: string | null }[]).map((p) => ({
    amount: Number(p.amount), kind: p.kind, method: p.method, on: p.paid_at ? riyadhDate(p.paid_at) : null, receipt_no: p.receipt_no,
  }));
  const installments = ((inst.data ?? []) as { due_date: string | null; amount: number | string; note: string | null }[]).map((r) => ({ due_date: r.due_date, amount: Number(r.amount), note: r.note }));
  const inv = invoiceOf({ ...c, installments, payments: receipts }, riyadhDate());
  const confRow = conf.data as { confirmed_at: string; employees: unknown } | null;
  return {
    ...inv,
    id: c.id,
    client: clients[c.id] ?? "",
    date: c.confirmed_on,
    currency: c.currency,
    source: { serial: c.serial, destination: c.destination, travel_start: c.travel_start },
    items: ((books.data ?? []) as { kind: string; title: string; city_name: string | null; start_date: string | null; end_date: string | null }[]).map((b) => ({
      kind: b.kind, title: b.title, city: b.city_name, from: b.start_date, to: b.end_date,
    })),
    receipts,
    confirmation: confRow ? { at: riyadhDate(confRow.confirmed_at), by: one(confRow.employees as { arabic_name: string | null } | null)?.arabic_name ?? "" } : null,
  };
}

// ------------------------------------------------------------ «المصروفات» ----

async function readExpenses(supabase: SupabaseClient, month: string): Promise<Expense[]> {
  const [y, m] = month.split("-").map(Number);
  const { data, error } = await supabase
    .from("company_expenses")
    .select("id, spent_on, category, title, amount, currency, method, note")
    .gte("spent_on", `${month}-01`)
    .lt("spent_on", new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10))
    .order("spent_on", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return ((data ?? []) as (Omit<Expense, "amount"> & { amount: number | string })[]).map((e) => ({ ...e, amount: Number(e.amount) }));
}

export async function listExpenses(monthParam?: string): Promise<{ month: string; months: string[]; rows: Expense[]; totals: ReturnType<typeof expenseTotals> } | null> {
  if (!(await allowed())) return null;
  const thisMonth = riyadhDate().slice(0, 7);
  const month = isMonth(monthParam) && monthParam <= thisMonth ? monthParam : thisMonth;
  const rows = await readExpenses(db(), month);
  return { month, months: recentMonths(thisMonth), rows, totals: expenseTotals(rows, month) };
}

// ------------------------------------------------------- «عروض الأسعار» ----

const pickMonth = (monthParam?: string) => {
  const thisMonth = riyadhDate().slice(0, 7);
  return { thisMonth, month: isMonth(monthParam) && monthParam <= thisMonth ? monthParam : thisMonth };
};

export async function listQuotes(monthParam?: string): Promise<(QuotesView & { months: string[] }) | null> {
  if (!(await allowed())) return null;
  const supabase = db();
  const { thisMonth, month } = pickMonth(monthParam);
  const { data, error } = await supabase
    .from("offers")
    .select("id, serial, offer_date, created_at, valid_until, status, total, total_sar, currency, employee_id, partner_company_id, customers(arabic_name)")
    .is("partner_company_id", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  type Row = { id: string; serial: string; offer_date: string | null; created_at: string; valid_until: string | null; status: string; total: number | string | null; total_sar: number | string | null; currency: string | null; employee_id: string | null; customers: unknown };
  const rows = (data ?? []) as Row[];
  const sellerIds = [...new Set(rows.map((r) => r.employee_id).filter((x): x is string => !!x))];
  const sellers = await chunked<{ id: string; arabic_name: string | null }>(sellerIds, (part) => supabase.from("employees").select("id, arabic_name").in("id", part));
  const seller = new Map(sellers.map((e) => [e.id, e.arabic_name ?? ""]));
  const quotes: Quote[] = rows.map((r) => ({
    id: r.id,
    serial: r.serial,
    client: one(r.customers as { arabic_name: string | null } | null)?.arabic_name ?? "",
    seller: r.employee_id ? (seller.get(r.employee_id) ?? "") : "",
    date: r.offer_date?.slice(0, 10) ?? riyadhDate(r.created_at),
    valid_until: r.valid_until?.slice(0, 10) ?? null,
    status: r.status,
    sar: r.total_sar != null ? Number(r.total_sar) : (r.currency ?? "SAR") === "SAR" && r.total != null ? Number(r.total) : null,
  }));
  return { ...quotesView(quotes, month, riyadhDate()), months: recentMonths(thisMonth) };
}

// ------------------------------------------------------ «القيود اليومية» ----

export async function getJournal(monthParam?: string): Promise<(ReturnType<typeof journal> & { month: string; months: string[]; left: number }) | null> {
  if (!(await allowed())) return null;
  const supabase = db();
  const { thisMonth, month } = pickMonth(monthParam);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const cases = (await loadCases(supabase)).filter((c) => invoiceable(c) && c.currency === "SAR");
  const byId = new Map(cases.map((c) => [c.id, c]));
  const [clients, pays, sups, spent] = await Promise.all([
    clientNames(supabase, cases.map((c) => c.id)),
    supabase.from("operation_payments").select("operation_id, amount, currency, kind, paid_at, receipt_no")
      .gte("paid_at", new Date(Date.UTC(y, m - 1, 0)).toISOString()).lt("paid_at", new Date(Date.UTC(y, m, 2)).toISOString()).limit(5000),
    supabase.from("supplier_payments").select("supplier_id, operation_id, amount, currency, kind, paid_on, reference, company_suppliers(arabic_name)")
      .gte("paid_on", from).lt("paid_on", to).limit(5000),
    readExpenses(supabase, month),
  ]);
  if (pays.error) throw pays.error;
  if (sups.error) throw sups.error;

  type Pay = { operation_id: string; amount: number | string; currency: string | null; kind: string; paid_at: string | null; receipt_no: string | null };
  type Sup = { operation_id: string | null; amount: number | string; currency: string; kind: "payment" | "refund"; paid_on: string; reference: string | null; company_suppliers: unknown };
  // what the journal cannot carry (another currency, a partner's or cancelled file) is counted, never silently lost
  let left = 0;
  const clientPayments = ((pays.data ?? []) as Pay[]).flatMap((p) => {
    const c = byId.get(p.operation_id);
    const on = p.paid_at ? riyadhDate(p.paid_at) : "";
    if (!on.startsWith(month)) return [];
    if (!c || (p.currency ?? "SAR") !== "SAR") { left += 1; return []; }
    return [{ serial: c.serial, client: clients[c.id] ?? "", on, amount: Number(p.amount), kind: p.kind, receipt: p.receipt_no }];
  });
  const supplierPayments = ((sups.data ?? []) as Sup[]).flatMap((p) => {
    if (p.currency !== "SAR") { left += 1; return []; }
    return [{ supplier: one(p.company_suppliers as { arabic_name: string } | null)?.arabic_name ?? "مورد", serial: (p.operation_id && byId.get(p.operation_id)?.serial) || "", on: p.paid_on, amount: Number(p.amount), kind: p.kind, reference: p.reference }];
  });
  const sales = cases.map((c) => ({
    serial: c.serial,
    client: clients[c.id] ?? "",
    on: c.confirmed_on,
    price: c.total ?? 0,
    cost: byCurrency(c.facts.expectedCost).find((x) => x.currency === "SAR")?.amount ?? 0,
  }));
  const expenses = spent.filter((e) => e.currency === "SAR").map((e) => ({ on: e.spent_on, title: e.title, category: e.category, amount: e.amount }));
  return { ...journal({ month, sales, clientPayments, supplierPayments, expenses }), month, months: recentMonths(thisMonth), left };
}
