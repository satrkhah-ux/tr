"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "./audit";
import { STAFF_RULES, type MuradStaffRulesDoc, type StaffRuleChoice } from "@/lib/murad/staff-rules-catalog";

/** The owner's decisions on «قواعد مراد بين الموظفين», one JSON doc in app_settings (staff-rules-catalog.ts). */
const KEY = "murad_staff_rules";
const CHOICES: StaffRuleChoice[] = ["approve", "reject", "edit"];
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const allowed = async () => (await currentCan("dashboard.admin")) || (await currentCan("developer.access"));

const empty = (): MuradStaffRulesDoc => ({ decisions: {}, added: [], approvedAt: null, updatedAt: "" });

export async function getMuradStaffRules(): Promise<MuradStaffRulesDoc | null> {
  if (!(await allowed())) return null;
  const { data } = await db().from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (!data?.value) return empty();
  try { return { ...empty(), ...(JSON.parse(data.value) as MuradStaffRulesDoc) }; } catch { return empty(); }
}

function valid(doc: MuradStaffRulesDoc): boolean {
  if (!doc || typeof doc !== "object" || !doc.decisions || !Array.isArray(doc.added)) return false;
  const ids = new Set(STAFF_RULES.map((r) => r.id));
  for (const [id, d] of Object.entries(doc.decisions)) {
    if (!ids.has(id) || !CHOICES.includes(d?.choice) || (d.text != null && (typeof d.text !== "string" || d.text.length > 2000))) return false;
  }
  if (doc.added.length > 50) return false;
  for (const a of doc.added) {
    if (typeof a?.id !== "string" || a.id.length > 40 || typeof a?.text !== "string" || !a.text.trim() || a.text.length > 1000) return false;
  }
  return doc.approvedAt === null || typeof doc.approvedAt === "string";
}

/** Save the whole doc. `expected` is the updatedAt the caller last saw ("" for a fresh doc): a mismatch returns the fresh doc instead of overwriting another device's edits. */
export async function saveMuradStaffRules(doc: MuradStaffRulesDoc, expected: string): Promise<{ ok: boolean; doc?: MuradStaffRulesDoc; error?: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  if (!valid(doc)) return { ok: false, error: "قيمة غير صالحة" };
  const current = await getMuradStaffRules();
  if (current && current.updatedAt !== expected) return { ok: false, doc: current, error: "عُدّلت القرارات من نافذة أخرى — حُمّلت النسخة الأحدث." };
  const now = new Date().toISOString();
  const next: MuradStaffRulesDoc = { decisions: doc.decisions, added: doc.added, approvedAt: doc.approvedAt, updatedAt: now };
  const { error } = await db().from("app_settings").upsert({ key: KEY, value: JSON.stringify(next), updated_at: now });
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({
    action: "murad.staff_rules.saved",
    entity: "app_settings",
    entity_id: KEY,
    meta: { decided: Object.keys(doc.decisions).length, added: doc.added.length, approved: !!doc.approvedAt },
  });
  return { ok: true, doc: next };
}
