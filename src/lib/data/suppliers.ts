"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/data/metrics";
import { can } from "@/lib/roles/roles";
import { encryptJson } from "@/lib/crypto/secrets";
import { getSupplierAdapter, getSupplierRows } from "@/lib/providers/hotel-registry";
import type { TestConnectionResult } from "@/lib/providers/hotel-supplier";
import type { HotelSupplierRow, MarkupRuleRow } from "@/lib/types";

/**
 * Supplier registry admin actions. EVERY action is gated on the admin role
 * (settings.manage) — the page, the route, AND these server actions. Credentials
 * are ENCRYPTED on write and NEVER returned to the browser: reads expose only a
 * `has_credentials` boolean. Every credential change is logged to audit_logs
 * (who/when — never the value).
 */

/** SERVICE-ROLE client: the credential vault + audit log are RLS-locked to deny
 *  direct client access, so all reads/writes here go through the service role
 *  (every caller is already behind requireAdmin). Secrets never leave the server. */
function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type Admin = { id: string; email: string | null };

/** Returns the admin actor, or null when the caller is not an authenticated admin. */
async function requireAdmin(): Promise<Admin | null> {
  const user = await getServerUser();
  if (!user) return null;
  const role = await getCurrentRole();
  if (!can(role, "settings.manage")) return null;
  return { id: user.id, email: user.email ?? null };
}

async function logAudit(
  supabase: SupabaseClient,
  actor: Admin,
  action: string,
  entityId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      actor_email: actor.email,
      action,
      entity: "hotel_suppliers",
      entity_id: entityId,
      meta,
    });
  } catch {
    /* audit is best-effort; never block the primary action */
  }
}

/** A credential-free view of a supplier row — safe to send to the browser. */
export type SupplierView = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  enabled: boolean;
  environment: string;
  base_url: string | null;
  priority: number;
  default_markup_rule_id: string | null;
  /** whether stored credentials exist — the secret itself is NEVER sent. */
  has_credentials: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
};

function maskRow(r: HotelSupplierRow): SupplierView {
  return {
    id: r.id,
    code: r.code,
    name_ar: r.name_ar,
    name_en: r.name_en,
    enabled: r.enabled,
    environment: r.environment,
    base_url: r.base_url,
    priority: r.priority,
    default_markup_rule_id: r.default_markup_rule_id,
    has_credentials: Boolean(r.credentials_encrypted),
    last_sync_at: r.last_sync_at,
    last_sync_status: r.last_sync_status,
    last_error: r.last_error,
  };
}

/** Admin: list suppliers (credentials masked to a boolean). Empty for non-admins. */
export async function listSuppliers(): Promise<SupplierView[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return (await getSupplierRows()).map(maskRow);
}

/** Admin: markup rules for the per-supplier default-rule dropdown. */
export async function listMarkupRuleOptions(): Promise<{ id: string; name: string }[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  try {
    const supabase = await db();
    const { data } = await supabase.from("markup_rules").select("id, arabic_name, status").order("priority", { ascending: false });
    return ((data ?? []) as Pick<MarkupRuleRow, "id" | "arabic_name" | "status">[])
      .filter((r) => r.status !== "Disabled")
      .map((r) => ({ id: r.id, name: r.arabic_name }));
  } catch {
    return [];
  }
}

export type SaveSupplierInput = {
  code: string;
  enabled?: boolean;
  environment?: string;
  base_url?: string | null;
  priority?: number;
  default_markup_rule_id?: string | null;
  /** secret fields — provided ONLY when replacing credentials; blank = keep existing. */
  username?: string;
  password?: string;
};

export type SaveResult = { ok: boolean; error?: string };

/** Admin: update a supplier. Credentials are (re)encrypted only when BOTH username
 *  and password are supplied; otherwise the stored secret is left untouched. */
export async function saveSupplier(input: SaveSupplierInput): Promise<SaveResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "forbidden" };
  try {
    const supabase = await db();
    const { data: existing } = await supabase.from("hotel_suppliers").select("*").eq("code", input.code).maybeSingle();
    if (!existing) return { ok: false, error: "notFound" };
    const row = existing as HotelSupplierRow;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.environment !== undefined) patch.environment = input.environment;
    if (input.base_url !== undefined) patch.base_url = input.base_url;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.default_markup_rule_id !== undefined) patch.default_markup_rule_id = input.default_markup_rule_id || null;

    const replacingCreds = Boolean(input.username && input.password);
    if (replacingCreds) {
      patch.credentials_encrypted = encryptJson({
        base_url: (input.base_url ?? row.base_url) || "",
        username: input.username,
        password: input.password,
      });
    }

    const { error } = await supabase.from("hotel_suppliers").update(patch).eq("code", input.code);
    if (error) return { ok: false, error: "updateFailed" };

    await logAudit(supabase, admin, replacingCreds ? "supplier.credentials_changed" : "supplier.updated", input.code, {
      // NEVER the credential values — only which non-secret fields changed.
      fields: Object.keys(patch).filter((k) => k !== "credentials_encrypted" && k !== "updated_at"),
      credentials_changed: replacingCreds,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "db" };
  }
}

/** Admin: real server-side auth + sample search. Updates last-sync status. */
export async function testSupplierConnection(code: string): Promise<TestConnectionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const adapter = await getSupplierAdapter(code);
  if (!adapter) return { ok: false, message: "المزوّد غير موجود." };

  let result: TestConnectionResult;
  try {
    result = await adapter.testConnection();
  } catch {
    // Never surface a raw supplier error/endpoint to the browser.
    result = { ok: false, message: "تعذّر الاتصال بخدمة المزوّد. تحقّق من بيانات الاعتماد." };
  }

  try {
    const supabase = await db();
    await supabase
      .from("hotel_suppliers")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: result.ok ? "ok" : "error",
        last_error: result.ok ? null : result.message,
      })
      .eq("code", code);
    await logAudit(supabase, admin, "supplier.test_connection", code, { ok: result.ok });
  } catch {
    /* status update is best-effort */
  }
  return result;
}
