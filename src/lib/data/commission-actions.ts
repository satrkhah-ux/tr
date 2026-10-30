"use server";

import { revalidatePath } from "next/cache";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { parseCommissionPolicy } from "@/lib/commissions/policy";
import { logAudit } from "@/lib/data/audit";
import { SALES_TARGETS_KEY, withTarget } from "@/lib/commissions/target";
import { activePolicy, calculate, readSalesTargets, isMonth, liveCycleOf, service, DEFAULT_MONTHLY_COST, type Adjustment, type CycleRow } from "@/lib/data/commissions";

/**
 * The commission cycle's steps (0092). Each one asks for its permission again —
 * a hidden button is not a lock — and the database triggers hold the money
 * rules (frozen snapshot, legal transitions, adjustments only in draft, one
 * payout per cycle) even if a step here were wrong.
 *
 *   commissions.manage  — open a month, its cost, adjustments, send for approval, back to draft
 *   commissions.approve — approve, pay, void; approve a policy someone else wrote
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });
const done = (): ActionResult => {
  revalidatePath("/commissions", "layout");
  return { ok: true };
};

async function gate(perm: "commissions.manage" | "commissions.approve"): Promise<string | null> {
  if (!(await currentCan(perm))) return null;
  return getCurrentEmployeeId();
}

async function cycleById(id: string): Promise<CycleRow | null> {
  const { data } = await service().from("commission_cycles").select("*").eq("id", id).maybeSingle();
  return (data as CycleRow | null) ?? null;
}

export async function openCycle(month: string, monthlyCost?: number): Promise<ActionResult> {
  const me = await gate("commissions.manage");
  if (!me) return fail("لا تملك صلاحية إدارة العمولات");
  if (!isMonth(month)) return fail("الشهر غير صحيح");
  const db = service();
  if (await liveCycleOf(db, month)) return fail("لهذا الشهر دورة قائمة");
  const cost = monthlyCost ?? DEFAULT_MONTHLY_COST;
  if (!Number.isFinite(cost) || cost < 0) return fail("التكلفة الشهرية غير صحيحة");
  const { error } = await db.from("commission_cycles").insert({ month, monthly_cost: cost, created_by: me });
  return error ? fail("تعذّر فتح الدورة") : done();
}

export async function setMonthlyCost(cycleId: string, monthlyCost: number): Promise<ActionResult> {
  if (!(await gate("commissions.manage"))) return fail("لا تملك صلاحية إدارة العمولات");
  if (!Number.isFinite(monthlyCost) || monthlyCost < 0) return fail("التكلفة الشهرية غير صحيحة");
  const cycle = await cycleById(cycleId);
  if (cycle?.status !== "draft") return fail("التكلفة تتغير في المسودة فقط");
  const { error } = await service().from("commission_cycles").update({ monthly_cost: monthlyCost }).eq("id", cycleId);
  return error ? fail("تعذّر الحفظ") : done();
}

export async function addAdjustment(cycleId: string, employeeId: string, amount: number, reason: string): Promise<ActionResult> {
  const me = await gate("commissions.manage");
  if (!me) return fail("لا تملك صلاحية إدارة العمولات");
  if (!Number.isFinite(amount) || amount === 0) return fail("المبلغ غير صحيح");
  if (!reason.trim()) return fail("اكتب سبب التعديل");
  const cycle = await cycleById(cycleId);
  if (cycle?.status !== "draft") return fail("التعديلات في المسودة فقط");
  const { error } = await service()
    .from("commission_adjustments")
    .insert({ cycle_id: cycleId, employee_id: employeeId, amount: Math.round(amount * 100) / 100, reason: reason.trim(), created_by: me });
  return error ? fail("تعذّر إضافة التعديل") : done();
}

export async function removeAdjustment(adjustmentId: string): Promise<ActionResult> {
  if (!(await gate("commissions.manage"))) return fail("لا تملك صلاحية إدارة العمولات");
  const { error } = await service().from("commission_adjustments").delete().eq("id", adjustmentId);
  return error ? fail("التعديلات تُحذف في المسودة فقط") : done();
}

/** Freeze the month: the calculation from this moment is what gets approved and paid. */
export async function sendToReview(cycleId: string): Promise<ActionResult> {
  const me = await gate("commissions.manage");
  if (!me) return fail("لا تملك صلاحية إدارة العمولات");
  const db = service();
  const cycle = await cycleById(cycleId);
  if (cycle?.status !== "draft") return fail("الدورة ليست مسودة");
  const policy = await activePolicy(db);
  const { data: adj } = await db.from("commission_adjustments").select("id, employee_id, amount, reason, created_at").eq("cycle_id", cycleId);
  let snapshot;
  try {
    snapshot = await calculate(db, cycle.month, Number(cycle.monthly_cost), policy.doc, ((adj ?? []) as Adjustment[]).map((a) => ({ ...a, amount: Number(a.amount) })));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "تعذّر الحساب");
  }
  if (snapshot.rates_source === "fallback" && Object.values(snapshot.files).some((f) => f.length)) {
    return fail("أسعار الصرف الحية غير متاحة الآن — أعد المحاولة بعد قليل");
  }
  const { error } = await db
    .from("commission_cycles")
    .update({ status: "review", snapshot, policy_id: policy.id, reviewed_by: me, reviewed_at: new Date().toISOString() })
    .eq("id", cycleId)
    .eq("status", "draft");
  return error ? fail("تعذّر تجميد الدورة") : done();
}

export async function backToDraft(cycleId: string): Promise<ActionResult> {
  if (!(await gate("commissions.manage")) && !(await gate("commissions.approve"))) return fail("لا تملك الصلاحية");
  const { error } = await service().from("commission_cycles").update({ status: "draft", snapshot: null, reviewed_by: null, reviewed_at: null }).eq("id", cycleId).eq("status", "review");
  return error ? fail("تعذّر الإرجاع") : done();
}

export async function approveCycle(cycleId: string): Promise<ActionResult> {
  const me = await gate("commissions.approve");
  if (!me) return fail("الاعتماد لصاحب صلاحية «اعتماد وصرف العمولات»");
  const { data, error } = await service()
    .from("commission_cycles")
    .update({ status: "approved", approved_by: me, approved_at: new Date().toISOString() })
    .eq("id", cycleId)
    .eq("status", "review")
    .select("id");
  return error || !data?.length ? fail("الدورة ليست بانتظار الاعتماد") : done();
}

/** One payout per cycle (unique cycle_id): a second press finds it already paid. */
export async function payCycle(cycleId: string, reference: string): Promise<ActionResult> {
  const me = await gate("commissions.approve");
  if (!me) return fail("الصرف لصاحب صلاحية «اعتماد وصرف العمولات»");
  const db = service();
  const cycle = await cycleById(cycleId);
  if (cycle?.status !== "approved" || !cycle.snapshot) return fail("الدورة غير معتمدة");
  const total = Number(cycle.snapshot.calc?.result.totals.totalGrossPayableHalalas ?? 0) / 100;
  const ins = await db.from("commission_payouts").insert({ cycle_id: cycleId, amount: total, reference: reference.trim() || null, paid_by: me });
  if (ins.error) return fail(ins.error.code === "23505" ? "سُجّل صرف هذه الدورة من قبل" : "تعذّر تسجيل الصرف");
  const { error } = await db.from("commission_cycles").update({ status: "paid" }).eq("id", cycleId).eq("status", "approved");
  return error ? fail("سُجّل الصرف لكن تعذّر تحديث الحالة") : done();
}

export async function voidCycle(cycleId: string, reason: string): Promise<ActionResult> {
  if (!(await gate("commissions.approve"))) return fail("الإلغاء لصاحب صلاحية «اعتماد وصرف العمولات»");
  if (!reason.trim()) return fail("اكتب سبب الإلغاء");
  const { error } = await service().from("commission_cycles").update({ status: "void", void_reason: reason.trim() }).eq("id", cycleId).in("status", ["draft", "review", "approved"]);
  return error ? fail("تعذّر الإلغاء") : done();
}

// ------------------------------------------------------------- policy ----

export async function savePolicyDraft(doc: unknown, note: string): Promise<ActionResult> {
  const me = (await gate("commissions.manage")) ?? (await gate("commissions.approve"));
  if (!me) return fail("لا تملك الصلاحية");
  let parsed;
  try {
    parsed = parseCommissionPolicy(doc);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "السياسة غير صحيحة");
  }
  const { error } = await service().from("commission_policies").insert({ doc: parsed, created_by: me, note: note.trim() || null });
  return error ? fail("تعذّر حفظ المسودة") : done();
}

/** Never one you wrote yourself (the four-eyes check in 0092 holds it too). */
export async function approvePolicy(policyId: string): Promise<ActionResult> {
  const me = await gate("commissions.approve");
  if (!me) return fail("اعتماد السياسة لصاحب صلاحية «اعتماد وصرف العمولات»");
  const db = service();
  const { data: p } = await db.from("commission_policies").select("id, created_by, status").eq("id", policyId).maybeSingle();
  if (!p || p.status !== "draft") return fail("المسودة غير موجودة");
  if (p.created_by === me) return fail("لا يعتمد أحد سياسة كتبها بنفسه — يعتمدها شخص آخر");
  const retire = await db.from("commission_policies").update({ status: "retired" }).eq("status", "approved");
  if (retire.error) return fail("تعذّر إيقاف السياسة السابقة");
  const { error } = await db.from("commission_policies").update({ status: "approved", approved_by: me, approved_at: new Date().toISOString() }).eq("id", policyId);
  return error ? fail("تعذّر الاعتماد") : done();
}

export async function discardPolicyDraft(policyId: string): Promise<ActionResult> {
  if (!(await gate("commissions.manage")) && !(await gate("commissions.approve"))) return fail("لا تملك الصلاحية");
  const { error } = await service().from("commission_policies").delete().eq("id", policyId).eq("status", "draft");
  return error ? fail("تعذّر الحذف") : done();
}

/**
 * «أهداف المبيعات»: one employee's standing target (month null) or one month's override; amount null clears it.
 * commissions.manage; audited with before and after.
 */
export async function setSalesTarget(employeeId: string, month: string | null, amount: number | null): Promise<ActionResult> {
  if (!(await gate("commissions.manage"))) return fail("لا تملك صلاحية إدارة العمولات");
  if (typeof employeeId !== "string" || !/^[0-9a-f-]{36}$/i.test(employeeId)) return fail("موظف غير موجود");
  const db = service();
  // ponytail: read-modify-write of one JSON value; two managers saving in the same second can lose one edit — a table if that ever happens
  const { data: person } = await db.from("employees").select("id").eq("id", employeeId).maybeSingle();
  if (!person) return fail("موظف غير موجود");
  const before = await readSalesTargets(db);
  const next = withTarget(before, employeeId, month, amount);
  if (!next) return fail("المبلغ أو الشهر غير صحيح");
  const { error } = await db.from("app_settings").upsert({ key: SALES_TARGETS_KEY, value: JSON.stringify(next), updated_at: new Date().toISOString() });
  if (error) return fail("تعذّر الحفظ");
  await logAudit({
    action: "settings.updated",
    entity: "app_settings",
    entity_id: SALES_TARGETS_KEY,
    meta: { employee_id: employeeId, month, before: month ? (before.months[month]?.[employeeId] ?? null) : (before.monthly[employeeId] ?? null), after: amount },
  });
  return done();
}
