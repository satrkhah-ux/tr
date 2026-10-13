"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { currentCan } from "@/lib/roles/current";
import type { Tier } from "./tiers";

/**
 * The commission ladder, ours to set: one per company, or the default one
 * (partner_id null) for companies without their own. Staff only (RLS is_staff
 * on partner_commission_tiers; data.write here).
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

export async function listTiers(partnerId: string | null): Promise<Tier[]> {
  try {
    if (!(await getServerUser())) return [];
    const q = (await db()).from("partner_commission_tiers").select("partner_id, min_confirmed, pct").order("min_confirmed");
    const { data } = await (partnerId ? q.eq("partner_id", partnerId) : q.is("partner_id", null));
    return ((data ?? []) as Tier[]).map((t) => ({ ...t, pct: Number(t.pct) }));
  } catch {
    return [];
  }
}

/** Replace a ladder with these steps (an empty list removes it). */
export async function saveTiers(partnerId: string | null, steps: { min_confirmed: number; pct: number }[]): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await getServerUser()) || !(await currentCan("data.write"))) return { ok: false, message: "لا تملك صلاحية." };
  const clean = steps.filter((s) => Number.isInteger(s.min_confirmed) && s.min_confirmed > 0 && Number.isFinite(s.pct) && s.pct >= 0 && s.pct <= 100);
  if (clean.length !== steps.length) return { ok: false, message: "كل درجة: عدد ملفات صحيح أكبر من صفر، ونسبة بين 0 و100." };
  if (new Set(clean.map((s) => s.min_confirmed)).size !== clean.length) return { ok: false, message: "لا تتكرر الدرجة نفسها مرتين." };
  try {
    const supabase = await db();
    const del = supabase.from("partner_commission_tiers").delete();
    const { error: delErr } = await (partnerId ? del.eq("partner_id", partnerId) : del.is("partner_id", null));
    if (delErr) return { ok: false, message: "تعذّر الحفظ." };
    if (clean.length) {
      const { error } = await supabase.from("partner_commission_tiers").insert(clean.map((s) => ({ partner_id: partnerId, min_confirmed: s.min_confirmed, pct: s.pct })));
      if (error) return { ok: false, message: "تعذّر الحفظ." };
    }
    if (partnerId) await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: partnerId, meta: { tiers: clean } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}
