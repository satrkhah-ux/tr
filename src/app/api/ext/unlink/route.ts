import type { SupabaseClient } from "@supabase/supabase-js";
import { extCaller, extJson } from "@/lib/ext/auth";
import { logAudit } from "@/lib/data/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/ext/unlink — the device revokes its own link («فك الربط» in the
 * popup, or the link it held before being linked again). Only the link the
 * token belongs to; anything else is revoked from /extension.
 */
export async function POST(request: Request) {
  const caller = await extCaller(request);
  if (caller instanceof Response) return caller;
  const { error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
    .from("extension_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", caller.linkId)
    .is("revoked_at", null);
  if (error) return extJson({ ok: false, error: "unavailable" }, 503);
  await logAudit({ action: "ext.revoked", entity: "extension_links", entity_id: caller.linkId, meta: { from: "extension" }, actor: { id: caller.employeeId, label: caller.name } });
  return extJson({ ok: true });
}
