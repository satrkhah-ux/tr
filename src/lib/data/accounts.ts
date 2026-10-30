import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { gateManager } from "@/lib/operations/access";
import { riyadhDate } from "@/lib/operations/payments";
import { accountsHome, recentMonths, type AccountsHome, type HomePayment, type HomeSupplierLine } from "@/lib/accounts/home";
import { loadCases } from "./operation-money";

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

  const lateIds = home.overdue.invoices.map((i) => i.id);
  const names = await chunked<{ id: string; offers: unknown }>(lateIds, (part) => db.from("operations").select("id, offers(customers(arabic_name))").in("id", part));
  const clients: Record<string, string> = {};
  for (const r of names) {
    const customer = one(one(r.offers as { customers: unknown } | null)?.customers as { arabic_name: string | null } | null);
    if (customer?.arabic_name) clients[r.id] = customer.arabic_name;
  }

  const reports = (await currentCan("pricing.internal")) && !(await gateManager());
  return { ...home, months: recentMonths(thisMonth), clients, reports };
}
