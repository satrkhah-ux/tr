"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "./audit";
import { managerSnapshot } from "@/lib/manager-screen/snapshot";

export type ManagementDecision = {
  id: string; title: string; evidence: string; source_key: string | null; source_at: string | null;
  owner_id: string; due_on: string; status: "open" | "in_progress" | "done"; updated_at: string;
};
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const allowed = async () => await currentCan("dashboard.admin") || await currentCan("developer.access");
export async function getManagementDecisions() {
  if (!(await allowed())) return null;
  const [decisions, employees, snapshot] = await Promise.all([
    db().from("management_decisions").select("*").order("due_on").limit(500),
    db().from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
    managerSnapshot(),
  ]);
  return {
    rows: (decisions.data ?? []) as ManagementDecision[],
    employees: (employees.data ?? []) as { id: string; arabic_name: string }[],
    signals: snapshot ? [...snapshot.urgent, ...snapshot.watch] : [],
    error: decisions.error || employees.error ? "تعذّر تحميل القرارات أو المسؤولين." : null,
  };
}
export async function createManagementDecision(input: { title: string; ownerId: string; dueOn: string; sourceKey: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  if (typeof input?.title !== "string" || !input.title.trim() || input.title.length > 500
    || typeof input.ownerId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.ownerId)
    || typeof input.sourceKey !== "string" || input.sourceKey.length > 150
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) || !Number.isFinite(Date.parse(input.dueOn))
    || new Date(input.dueOn).toISOString().slice(0, 10) !== input.dueOn) return { ok: false, error: "أكمل القرار والمسؤول وتاريخ التنفيذ." };
  const [user, owner, snapshot] = await Promise.all([
    getServerUser(),
    db().from("employees").select("id").eq("id", input.ownerId).eq("status", "Active").maybeSingle(),
    input.sourceKey ? managerSnapshot() : null,
  ]);
  if (!user || !owner.data) return { ok: false, error: "اختر مسؤولًا نشطًا." };
  const signal = snapshot ? [...snapshot.urgent, ...snapshot.watch].find((x) => `${x.panel}:${x.key}` === input.sourceKey) : null;
  if (input.sourceKey && !signal) return { ok: false, error: "تغيّر المؤشر. حدّث الصفحة قبل تسجيل القرار." };
  const { data, error } = await db().from("management_decisions").insert({
    title: input.title.trim(), owner_id: input.ownerId, due_on: input.dueOn,
    evidence: signal ? `${signal.panelTitle} — ${signal.label}: ${signal.value}. ${signal.reason}` : "",
    source_key: input.sourceKey || null, source_at: signal ? snapshot?.at : null, created_by: user.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "تعذّر حفظ القرار." };
  await logAudit({ action: "management.decision.created", entity: "management_decisions", entity_id: data.id, meta: { title: input.title, owner: input.ownerId, due: input.dueOn } });
  return { ok: true };
}
export async function updateManagementDecision(id: string, status: ManagementDecision["status"], updatedAt: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  if (!["open", "in_progress", "done"].includes(status) || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(Date.parse(updatedAt))) return { ok: false, error: "قيمة غير صالحة" };
  const { data, error } = await db().from("management_decisions").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("updated_at", updatedAt).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "تعذّر التحديث أو عُدّل القرار من مستخدم آخر. حدّث القائمة." };
  await logAudit({ action: "management.decision.updated", entity: "management_decisions", entity_id: id, meta: { status } });
  return { ok: true };
}
