"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/data/metrics";
import { can } from "@/lib/roles/roles";

/**
 * INTERNAL executive dashboard data. Each row carries buy/profit, so the whole
 * function is gated on `pricing.internal` (admin + developer only) — an
 * authenticated employee holds `pricing.view` but NOT `pricing.internal` and
 * must never see cost/profit. NEVER surface this on a client/anon route.
 *
 * SECURITY CAVEAT: this app-layer gate is currently the ONLY boundary on cost/
 * profit. The `pricings` and `offer_pricing_items` tables still carry the
 * blanket `authenticated_all` RLS policy (migrations 0001/0008), so a signed-in
 * employee can read buy_total/profit/total_buy directly via PostgREST, bypassing
 * this function. Locking those tables down (mirroring 0017's supplier fix) and
 * routing reads through the service-role client is tracked as a follow-up.
 *
 * Cost has TWO mutually-exclusive sources in this data set:
 *  - `pricings` (one row/offer) → buy_total + profit, for offers priced the
 *    classic way (createOffer / seed).
 *  - `offer_pricing_items` (per line) → summed, for offers produced by the
 *    package generator (which never writes a pricings row).
 * We prefer pricings, then fall back to the item sum. Offers with NEITHER have
 * an unknown cost (buy/profit = null, hasCost = false) so the UI can compute an
 * honest margin instead of inflating uncosted offers to 100%.
 *
 * This function only ASSEMBLES rows (the security-sensitive part). All KPI /
 * chart aggregation happens client-side over the filtered rows, so there is a
 * single aggregation implementation and filters stay live.
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ExecRow = {
  serial: string;
  destination: string | null;
  customer: string | null;
  employee: string | null;
  sell: number;
  buy: number | null;
  profit: number | null;
  /** true when a cost figure exists (from pricings or the item sum). */
  hasCost: boolean;
  status: string;
  stage: string;
  date: string | null;
  pax: number;
};

export type ExecutiveRef = {
  customers: number;
  hotels: number;
  countries: number;
};

export type ExecutiveDashboard = {
  ok: boolean;
  /** false when the caller is unauthenticated OR lacks pricing.internal. */
  authorized: boolean;
  generatedAt: string;
  rows: ExecRow[];
  ref: ExecutiveRef;
};

function emptyDashboard(authorized: boolean): ExecutiveDashboard {
  return {
    ok: false,
    authorized,
    generatedAt: "",
    rows: [],
    ref: { customers: 0, hotels: 0, countries: 0 },
  };
}

export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  // 1) Authorization first, so a later data-fetch failure never misreports an
  //    authorized admin as lacking permission.
  try {
    const user = await getServerUser();
    if (!user) return emptyDashboard(false);
    const role = await getCurrentRole();
    if (!can(role, "pricing.internal")) return emptyDashboard(false);
  } catch {
    return emptyDashboard(false);
  }

  // 2) Data fetch — on any failure return authorized:true + ok:false so the
  //    client shows a retry affordance rather than "no permission"/"no data".
  try {
    const supabase = await db();

    const { data: offerData, error: offerErr } = await supabase
      .from("offers")
      .select("id, serial, destination, offer_date, adults, children, infants, total, status, pipeline_stage, customer_id, employee_id")
      .order("offer_date", { ascending: false });

    if (offerErr) return emptyDashboard(true);

    const offers = (offerData ?? []) as {
      id: string; serial: string; destination: string | null; offer_date: string | null;
      adults: number; children: number; infants: number; total: number | null;
      status: string; pipeline_stage: string; customer_id: string | null; employee_id: string | null;
    }[];

    const generatedAt = new Date().toISOString();

    if (offers.length === 0) {
      return { ...emptyDashboard(true), ok: true, generatedAt };
    }

    const offerIds = offers.map((o) => o.id);
    const customerIds = [...new Set(offers.map((o) => o.customer_id).filter((v): v is string => Boolean(v)))];
    const employeeIds = [...new Set(offers.map((o) => o.employee_id).filter((v): v is string => Boolean(v)))];

    const [pricingRes, itemRes, customerRes, employeeRes, customersCountRes, hotelsRes, countriesRes] = await Promise.all([
      supabase.from("pricings").select("offer_id, buy_total, sell_total, profit, total").in("offer_id", offerIds),
      supabase.from("offer_pricing_items").select("offer_id, quantity, buy_price, total_buy").in("offer_id", offerIds),
      customerIds.length ? supabase.from("customers").select("id, arabic_name").in("id", customerIds) : Promise.resolve({ data: [] }),
      employeeIds.length ? supabase.from("employees").select("id, arabic_name").in("id", employeeIds) : Promise.resolve({ data: [] }),
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("hotels").select("id", { count: "exact", head: true }),
      supabase.from("countries").select("id", { count: "exact", head: true }),
    ]);

    // buy_total / profit / sell from the one-row-per-offer pricings table.
    const pricingBy = new Map<string, { buy: number | null; profit: number | null; sell: number | null }>();
    for (const p of (pricingRes.data ?? []) as { offer_id: string; buy_total: number | null; sell_total: number | null; profit: number | null; total: number | null }[]) {
      pricingBy.set(p.offer_id, { buy: p.buy_total, profit: p.profit, sell: p.sell_total ?? p.total });
    }

    // Fallback cost: sum of per-line buy for generator-produced offers.
    const itemBuyBy = new Map<string, number>();
    for (const it of (itemRes.data ?? []) as { offer_id: string; quantity: number | null; buy_price: number | null; total_buy: number | null }[]) {
      const line = it.total_buy ?? (it.buy_price != null ? it.buy_price * (it.quantity ?? 1) : 0);
      itemBuyBy.set(it.offer_id, (itemBuyBy.get(it.offer_id) ?? 0) + line);
    }

    const custBy = new Map<string, string>();
    for (const c of (customerRes.data ?? []) as { id: string; arabic_name: string }[]) custBy.set(c.id, c.arabic_name);
    const empBy = new Map<string, string>();
    for (const e of (employeeRes.data ?? []) as { id: string; arabic_name: string }[]) empBy.set(e.id, e.arabic_name);

    const rows: ExecRow[] = offers.map((o) => {
      const pr = pricingBy.get(o.id);
      const sell = o.total ?? pr?.sell ?? 0;
      // Prefer the pricings buy_total; else fall back to the summed line items.
      let buy: number | null = null;
      if (pr?.buy != null) buy = pr.buy;
      else if (itemBuyBy.has(o.id)) buy = round2(itemBuyBy.get(o.id) ?? 0);
      const profit = buy != null ? round2(sell - buy) : null;
      return {
        serial: o.serial,
        destination: o.destination,
        customer: o.customer_id ? custBy.get(o.customer_id) ?? null : null,
        employee: o.employee_id ? empBy.get(o.employee_id) ?? null : null,
        sell: round2(sell),
        buy,
        profit,
        hasCost: buy != null,
        status: o.status,
        stage: o.pipeline_stage,
        date: o.offer_date,
        pax: o.adults + o.children + o.infants,
      };
    });

    const ref: ExecutiveRef = {
      customers: customersCountRes.count ?? 0,
      hotels: hotelsRes.count ?? 0,
      countries: countriesRes.count ?? 0,
    };

    return { ok: true, authorized: true, generatedAt, rows, ref };
  } catch {
    // Authorized (gate passed above) but the data fetch threw → surface as a
    // retryable error, not a permission/empty state.
    return emptyDashboard(true);
  }
}
