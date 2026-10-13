"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyOps } from "@/lib/data/ops-notify";

/**
 * The traveller's rating after the trip (operations order 6). The trip link's
 * token is the only gate — as for /trip itself (RLS cannot see a URL) — so the
 * service role reads the case by token and refuses a stopped link. One rating
 * per trip: a second submit keeps the first.
 */

async function caseFor(token: string): Promise<{ id: string; serial: string } | null> {
  const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
    .from("operations")
    .select("id, client_token_revoked_at, offers(serial)")
    .eq("client_token", token)
    .maybeSingle();
  const row = data as unknown as { id: string; client_token_revoked_at: string | null; offers: { serial: string } | { serial: string }[] | null } | null;
  if (!row || row.client_token_revoked_at) return null;
  const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers;
  return { id: row.id, serial: offer?.serial ?? "" };
}

export async function getTripRating(token: string): Promise<{ found: boolean; score: number | null }> {
  try {
    const op = await caseFor(token);
    if (!op) return { found: false, score: null };
    const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient).from("operation_ratings").select("score").eq("operation_id", op.id).maybeSingle();
    return { found: true, score: (data as { score: number } | null)?.score ?? null };
  } catch {
    return { found: false, score: null };
  }
}

export async function submitTripRating(token: string, score: number, comment: string): Promise<{ ok: boolean; message: string }> {
  if (!Number.isInteger(score) || score < 1 || score > 5) return { ok: false, message: "اختر تقييماً من 1 إلى 5." };
  try {
    const op = await caseFor(token);
    if (!op) return { ok: false, message: "الرابط غير صالح." };
    const { error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("operation_ratings")
      .insert({ operation_id: op.id, score, comment: comment.trim().slice(0, 2000) || null });
    if (error) return { ok: true, message: "شكراً لكم — وصلنا تقييمكم من قبل." };
    await logAudit({ action: "operation.rated", entity: "operations", entity_id: op.id, meta: { score }, actor: { id: null, label: "client" } });
    await notifyOps(`⭐ تقييم العميل ${score}/5 — ${op.serial}${comment.trim() ? `\n${comment.trim().slice(0, 300)}` : ""}`, `/operations/${op.id}`);
    return { ok: true, message: "شكراً لكم على تقييمكم." };
  } catch {
    return { ok: false, message: "تعذّر الإرسال. حاولوا مرة أخرى." };
  }
}
