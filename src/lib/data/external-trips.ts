"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { readExternalTrip, type ExternalStatus, type ExternalTripInput } from "@/lib/leads/lifecycle-rules";

/**
 * «نظام البكجات ← المؤكدون خارج النظام» (the user, 2026-10-22: «اضف امكانية
 * ادخال ربط لعميل قبل النظام… رقمه تاريخ السفر عدد الايام الوجهة الحالة و
 * المبلغ المدفوع ماذا تم تأكديه يكون الادخال سهل جدا و يكون غير مرتبط مع
 * البكجات»): a confirmed client from before the system, entered by hand, so
 * the work is counted here and the client's conversation is handled as a
 * traveller's (leads/lifecycle.ts). offers.write; whoever entered a trip owns it.
 */
type Result = { ok: true } | { ok: false; error: string };
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type ExternalTripRow = {
  id: string;
  phone: string;
  travel_start: string;
  days: number;
  destination: string;
  status: ExternalStatus;
  paid_amount: number | null;
  confirmed_items: string[];
  employee_id: string | null;
  employee_name: string | null;
  created_at: string;
};

export async function listExternalTrips(): Promise<{ rows: ExternalTripRow[]; me: string | null; admin: boolean } | null> {
  if (!(await currentCan("offers.write"))) return null;
  const [{ data }, me, admin] = await Promise.all([
    db().from("external_trips").select("id, phone, travel_start, days, destination, status, paid_amount, confirmed_items, employee_id, created_at, employees(arabic_name)").order("travel_start", { ascending: false }).limit(500),
    getCurrentEmployeeId(),
    currentCan("settings.manage"),
  ]);
  const rows = ((data ?? []) as unknown as (Omit<ExternalTripRow, "employee_name" | "paid_amount"> & { paid_amount: string | number | null; employees: { arabic_name: string | null } | null })[]).map(({ employees, ...r }) => ({
    ...r,
    paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
    employee_name: employees?.arabic_name ?? null,
  }));
  return { rows, me, admin };
}

/** a new trip, or an edit of one's own (the administration edits any) */
export async function saveExternalTrip(input: ExternalTripInput & { id?: string }): Promise<Result> {
  if (!(await currentCan("offers.write"))) return { ok: false, error: "لا صلاحية" };
  const read = readExternalTrip(input);
  if (!read.ok) return read;
  const me = await getCurrentEmployeeId();
  const now = new Date().toISOString();
  if (input.id) {
    if (!(await mayChange(input.id, me))) return { ok: false, error: "تعدّل ما أدخلته أنت فقط" };
    const { error } = await db().from("external_trips").update({ ...read.row, updated_at: now }).eq("id", input.id);
    if (error) return { ok: false, error: "تعذّر الحفظ" };
    await logAudit({ action: "data.updated", entity: "external_trips", entity_id: input.id, meta: read.row });
    return { ok: true };
  }
  const { data, error } = await db().from("external_trips").insert({ ...read.row, employee_id: me }).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "data.created", entity: "external_trips", entity_id: (data as { id: string }).id, meta: read.row });
  return { ok: true };
}

export async function deleteExternalTrip(id: string): Promise<Result> {
  if (!(await currentCan("offers.write"))) return { ok: false, error: "لا صلاحية" };
  if (!(await mayChange(id, await getCurrentEmployeeId()))) return { ok: false, error: "تحذف ما أدخلته أنت فقط" };
  const { data: before } = await db().from("external_trips").select("phone, travel_start, destination, status").eq("id", id).maybeSingle();
  const { error } = await db().from("external_trips").delete().eq("id", id);
  if (error) return { ok: false, error: "تعذّر الحذف" };
  await logAudit({ action: "data.deleted", entity: "external_trips", entity_id: id, meta: { before } });
  return { ok: true };
}

async function mayChange(id: string, me: string | null): Promise<boolean> {
  if (await currentCan("settings.manage")) return true;
  const { data } = await db().from("external_trips").select("employee_id").eq("id", id).maybeSingle();
  return Boolean(me && (data as { employee_id: string | null } | null)?.employee_id === me);
}
