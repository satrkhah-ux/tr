import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { getRates } from "@/lib/data/rates-actions";
import { loadCases } from "@/lib/data/operation-money";
import { riyadhDate } from "@/lib/operations/payments";
import { commissionMonth, type CommissionFile, type SkippedFile } from "@/lib/commissions/month";
import {
  buildCommissionCalculationSnapshot,
  createDefaultCommissionPolicy,
  parseCommissionPolicy,
  type CommissionCalculationSnapshot,
  type CommissionPolicyDocument,
} from "@/lib/commissions/policy";
import { daysLeftInMonth, progress, rowsToTargets, targetFor, type SalesTargetRow, type SalesTargets } from "@/lib/commissions/target";

/**
 * «العمولات» (0092): the month's commission from the files themselves — no
 * spreadsheet, no name matching. Commission is profit, so every read goes
 * through the service client AFTER the permission check (the 0047 rule), and
 * an employee is only ever handed their own row.
 *
 * A draft cycle is calculated live on every read; from «مراجعة» on, the stored
 * snapshot is the truth and is never recalculated (the trigger in 0092 holds it).
 */

export type CycleStatus = "draft" | "review" | "approved" | "paid" | "void";

export type CycleRow = {
  id: string;
  month: string;
  monthly_cost: number;
  status: CycleStatus;
  policy_id: string | null;
  snapshot: StoredSnapshot | null;
  void_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  approved_at: string | null;
};

/** What a cycle freezes: the engine's snapshot plus the files behind each figure. */
export type StoredSnapshot = {
  calc: CommissionCalculationSnapshot | null;
  files: Record<string, CommissionFile[]>;
  skipped: SkippedFile[];
  names: Record<string, string>;
  rates_source: string;
};

export type Adjustment = { id: string; employee_id: string; amount: number; reason: string; created_at: string };

export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const thisMonth = () => riyadhDate().slice(0, 7);
export const DEFAULT_MONTHLY_COST = 250000;

export const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type PolicyRow = { id: string; doc: CommissionPolicyDocument; status: string; created_by: string | null; approved_at: string | null; created_at: string; note: string | null };

/** The policy in force — or, before anyone approved one, the original system's defaults. */
export async function activePolicy(db: SupabaseClient): Promise<{ id: string | null; doc: CommissionPolicyDocument }> {
  const { data } = await db.from("commission_policies").select("id, doc").eq("status", "approved").maybeSingle();
  if (data) return { id: data.id as string, doc: parseCommissionPolicy(data.doc) };
  return { id: null, doc: createDefaultCommissionPolicy() };
}

export async function liveCycleOf(db: SupabaseClient, month: string): Promise<CycleRow | null> {
  const { data } = await db.from("commission_cycles").select("*").eq("month", month).neq("status", "void").maybeSingle();
  return (data as CycleRow | null) ?? null;
}

async function adjustmentsOf(db: SupabaseClient, cycleId: string): Promise<Adjustment[]> {
  const { data } = await db.from("commission_adjustments").select("id, employee_id, amount, reason, created_at").eq("cycle_id", cycleId).order("created_at");
  return ((data ?? []) as Adjustment[]).map((a) => ({ ...a, amount: Number(a.amount) }));
}

/** The month calculated now, from the files and today's rates. */
export async function calculate(
  db: SupabaseClient,
  month: string,
  monthlyCost: number,
  policy: CommissionPolicyDocument,
  adjustments: Adjustment[],
): Promise<StoredSnapshot> {
  const [cases, rates] = await Promise.all([loadCases(db), getRates()]);
  const { employees, skipped } = commissionMonth(cases, month, rates.sarPer);
  const ids = [...new Set([...employees.map((e) => e.employee_id), ...adjustments.map((a) => a.employee_id)])];
  const { data: people } = ids.length ? await db.from("employees").select("id, arabic_name").in("id", ids) : { data: [] };
  const names = Object.fromEntries(((people ?? []) as { id: string; arabic_name: string }[]).map((p) => [p.id, p.arabic_name]));

  // an adjustment for someone with no file this month still needs a row to land on
  const rows = ids.map((id) => {
    const e = employees.find((x) => x.employee_id === id);
    return { salesRowId: id, employeeId: id, sales: e?.sales ?? 0, profit: e?.profit ?? 0, saleCount: e?.files.length ?? 0, refundCount: 0 };
  });
  const adjustmentsByEmployee: Record<string, { amount: number }[]> = {};
  for (const a of adjustments) (adjustmentsByEmployee[a.employee_id] ??= []).push({ amount: a.amount });

  const calc = rows.length
    ? buildCommissionCalculationSnapshot({ period: { id: randomUUID(), startsOn: `${month}-01`, monthlyCost }, policy, rows, adjustmentsByEmployee })
    : null;
  return {
    calc,
    files: Object.fromEntries(employees.map((e) => [e.employee_id, e.files])),
    skipped,
    names,
    rates_source: rates.source,
  };
}

// ------------------------------------------------------------ «عمولتي» ----

export type MyCommission = {
  month: string;
  status: CycleStatus | "none";
  /** true once the administration froze the month: the figure will not move any more. */
  frozen: boolean;
  files: CommissionFile[];
  sales: number;
  profit: number;
  base: number;
  adjustments: number;
  net: number;
  viaFallback: boolean;
  skipped: number;
  history: { month: string; status: CycleStatus; net: number; profit: number }[];
};

export async function getMyCommission(monthIn?: string): Promise<MyCommission | null> {
  if (!(await currentCan("commissions.view"))) return null;
  const me = await getCurrentEmployeeId();
  if (!me) return null;
  return commissionOf(me, isMonth(monthIn) ? monthIn : thisMonth());
}

/** the month's figures: the frozen snapshot once the month is reviewed, else a live calculation */
async function monthSnapshot(db: SupabaseClient, month: string) {
  const cycle = await liveCycleOf(db, month);
  if (cycle && cycle.status !== "draft" && cycle.snapshot) return { cycle, snap: cycle.snapshot };
  const policy = await activePolicy(db);
  const snap: StoredSnapshot = await calculate(db, month, cycle ? Number(cycle.monthly_cost) : DEFAULT_MONTHLY_COST, policy.doc, cycle ? await adjustmentsOf(db, cycle.id) : []);
  return { cycle, snap };
}

/** one employee's month — no permission check here: callers decide who may ask (the page: its own session; the bot: its own member) */
async function commissionOf(me: string, month: string): Promise<MyCommission> {
  const db = service();
  const { cycle, snap } = await monthSnapshot(db, month);
  const mine = snap.calc?.result.employees.find((e) => e.employeeId === me);

  const { data: past } = await db.from("commission_cycles").select("month, status, snapshot").in("status", ["review", "approved", "paid"]).order("month", { ascending: false }).limit(24);
  const history = ((past ?? []) as { month: string; status: CycleStatus; snapshot: StoredSnapshot | null }[]).flatMap((c) => {
    const e = c.snapshot?.calc?.result.employees.find((x) => x.employeeId === me);
    return e ? [{ month: c.month, status: c.status, net: e.netCommission, profit: e.grossProfit }] : [];
  });

  return {
    month,
    status: cycle?.status ?? "none",
    frozen: Boolean(cycle && cycle.status !== "draft"),
    files: snap.files[me] ?? [],
    sales: mine?.grossSales ?? 0,
    profit: mine?.grossProfit ?? 0,
    base: mine?.baseCommission ?? 0,
    adjustments: mine?.adjustmentTotal ?? 0,
    net: mine?.netCommission ?? 0,
    viaFallback: mine?.viaFallback ?? false,
    skipped: snap.skipped.filter((s) => s.employee_id === me).length,
    history,
  };
}

// ------------------------------------------------------ the administration ----

export type CycleView = {
  month: string;
  cycle: CycleRow | null;
  monthlyCost: number;
  snap: StoredSnapshot;
  adjustments: Adjustment[];
  policy: { id: string | null; doc: CommissionPolicyDocument };
  cycles: { id: string; month: string; status: CycleStatus }[];
  employees: { id: string; name: string }[];
  can: { manage: boolean; approve: boolean };
  payout: { amount: number; reference: string | null; paid_at: string } | null;
};

export async function getCycleView(monthIn?: string): Promise<CycleView | null> {
  const [manage, approve] = await Promise.all([currentCan("commissions.manage"), currentCan("commissions.approve")]);
  if (!manage && !approve) return null;
  const month = isMonth(monthIn) ? monthIn : thisMonth();
  const db = service();
  const [cycle, policy, list, staff] = await Promise.all([
    liveCycleOf(db, month),
    activePolicy(db),
    db.from("commission_cycles").select("id, month, status").order("month", { ascending: false }).limit(36),
    db.from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
  ]);
  const adjustments = cycle ? await adjustmentsOf(db, cycle.id) : [];
  const monthlyCost = cycle ? Number(cycle.monthly_cost) : DEFAULT_MONTHLY_COST;
  const snap = cycle && cycle.status !== "draft" && cycle.snapshot ? cycle.snapshot : await calculate(db, month, monthlyCost, policy.doc, adjustments);
  const { data: payout } = cycle ? await db.from("commission_payouts").select("amount, reference, paid_at").eq("cycle_id", cycle.id).maybeSingle() : { data: null };
  return {
    month,
    cycle,
    monthlyCost,
    snap,
    adjustments,
    policy,
    cycles: (list.data ?? []) as CycleView["cycles"],
    employees: ((staff.data ?? []) as { id: string; arabic_name: string }[]).map((e) => ({ id: e.id, name: e.arabic_name })),
    can: { manage, approve },
    payout: payout ? { ...(payout as { amount: number; reference: string | null; paid_at: string }), amount: Number((payout as { amount: number }).amount) } : null,
  };
}

export type PolicyView = {
  active: { id: string | null; doc: CommissionPolicyDocument; approved_at: string | null };
  drafts: PolicyRow[];
  me: string | null;
  employees: { id: string; name: string }[];
  can: { manage: boolean; approve: boolean };
};

export async function getPolicyView(): Promise<PolicyView | null> {
  const [manage, approve] = await Promise.all([currentCan("commissions.manage"), currentCan("commissions.approve")]);
  if (!manage && !approve) return null;
  const db = service();
  const [active, drafts, staff, me] = await Promise.all([
    db.from("commission_policies").select("id, doc, approved_at").eq("status", "approved").maybeSingle(),
    db.from("commission_policies").select("id, doc, status, created_by, approved_at, created_at, note").eq("status", "draft").order("created_at", { ascending: false }),
    db.from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
    getCurrentEmployeeId(),
  ]);
  return {
    active: active.data
      ? { id: active.data.id as string, doc: parseCommissionPolicy(active.data.doc), approved_at: active.data.approved_at as string | null }
      : { id: null, doc: createDefaultCommissionPolicy(), approved_at: null },
    drafts: (drafts.data ?? []) as PolicyRow[],
    me,
    employees: ((staff.data ?? []) as { id: string; arabic_name: string }[]).map((e) => ({ id: e.id, name: e.arabic_name })),
    can: { manage, approve },
  };
}

// ------------------------------------------------ «أهداف المبيعات» ----

/** public.sales_targets (closed table): callers check the permission first; employeeId narrows to one person's rows */
export async function readSalesTargets(db: SupabaseClient, employeeId?: string): Promise<SalesTargets> {
  let q = db.from("sales_targets").select("employee_id, month, amount");
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data } = await q;
  return rowsToTargets((data ?? []) as SalesTargetRow[]);
}

/** The home card (the owner, 2026-10-30): this month's own figures from «عمولتي», and the target. Null = no commissions.view. */
export type MySalesCard = {
  month: string;
  sales: number;
  clients: number;
  commission: number;
  frozen: boolean;
  target: number | null;
  progress: ReturnType<typeof progress>;
  daysLeft: number;
};

export async function getMySalesCard(nowMs = Date.now()): Promise<MySalesCard | null> {
  if (!(await currentCan("commissions.view"))) return null;
  const me = await getCurrentEmployeeId();
  return me ? salesCardFor(me, nowMs) : null;
}

/** the card for one employee — the staff bot's «🎯 هدفي» (its member is already identified); no permission check here */
export async function salesCardFor(me: string, nowMs = Date.now()): Promise<MySalesCard> {
  const mine = await commissionOf(me, thisMonth());
  const targets = await readSalesTargets(service(), me);
  const target = targetFor(targets, me, mine.month);
  return {
    month: mine.month,
    sales: mine.sales,
    clients: mine.files.length,
    commission: mine.net,
    frozen: mine.frozen,
    target,
    progress: progress(mine.sales, target),
    daysLeft: daysLeftInMonth(nowMs),
  };
}

/** مُراد's grounding for «كيف أصل إلى هدفي؟» — the same card, as plain lines; null when the employee may not see commissions. */
export async function salesTargetBrief(): Promise<string | null> {
  const c = await getMySalesCard().catch(() => null);
  if (!c) return null;
  const n = (x: number) => Math.round(x).toLocaleString("en-US");
  return [
    `أرقام الموظف هذا الشهر (${c.month}) — كما في «العمولات»: الملف يُحسب في الشهر الذي أكمل فيه العميل الدفع:`,
    `- مبيعاته: ${n(c.sales)} ريال`,
    `- عدد العملاء المؤكدين (أكملوا الدفع): ${c.clients}`,
    `- عمولته التقديرية: ${n(c.commission)} ريال${c.frozen ? " (معتمدة)" : " (تقديرية، تتحدث مع كل سداد)"}`,
    c.target && c.progress
      ? `- هدفه الشهري: ${n(c.target)} ريال — حقق ${c.progress.pct}%، الباقي ${n(c.progress.left)} ريال، وبقي في الشهر ${c.daysLeft} يوماً (≈ ${n(c.progress.left / c.daysLeft)} ريال يومياً)`
      : "- لم تحدد الإدارة له هدفاً شهرياً بعد.",
  ].join("\n");
}

export type TargetsView = {
  month: string;
  employees: { id: string; name: string }[];
  targets: SalesTargets;
};

/** «أهداف المبيعات» — commissions.manage only. */
export async function getTargetsView(monthIn?: string): Promise<TargetsView | null> {
  if (!(await currentCan("commissions.manage"))) return null;
  const db = service();
  const [targets, staff] = await Promise.all([readSalesTargets(db), db.from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name")]);
  return {
    month: isMonth(monthIn) ? monthIn : thisMonth(),
    employees: ((staff.data ?? []) as { id: string; arabic_name: string }[]).map((e) => ({ id: e.id, name: e.arabic_name })),
    targets,
  };
}

/** «👥 أهداف الفريق» in the staff bot — managers only (the caller checks): every employee with a target, and their month */
export async function teamSalesTargets(): Promise<{ month: string; rows: { id: string; name: string; target: number; sales: number }[] }> {
  const db = service();
  const month = thisMonth();
  const [targets, { snap }, staff] = await Promise.all([readSalesTargets(db), monthSnapshot(db, month), db.from("employees").select("id, arabic_name").eq("status", "Active")]);
  const sales = new Map((snap.calc?.result.employees ?? []).map((e) => [e.employeeId, e.grossSales]));
  const rows = ((staff.data ?? []) as { id: string; arabic_name: string }[]).flatMap((e) => {
    const target = targetFor(targets, e.id, month);
    return target ? [{ id: e.id, name: e.arabic_name.trim(), target, sales: sales.get(e.id) ?? 0 }] : [];
  });
  return { month, rows: rows.sort((a, b) => b.sales / b.target - a.sales / a.target) };
}
