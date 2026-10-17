"use server";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { gateRow } from "@/lib/operations/access";
import { DRV, waNumber } from "@/lib/operations/drivers";
import { driverLinkExpiry, supplierLinkExpiry, type LinkKind } from "@/lib/operations/op-links";

/**
 * «رابط المورد» and «رابط السائق» — minted and stopped by operations
 * (operations order 11). The pages they open live in public-links.ts.
 *
 * Service role behind the case's gate (operations/access.ts — a link is judged
 * by its booking's case): 0067's table is closed to sessions.
 * Asking twice gives the same open link, so the one already sent keeps working.
 */

type Fail = { ok: false; error: TranslationKey };
export type OpsLink = { id: string; token: string; expires_at: string };

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** The supplier link of a booking's request, or the link of its driver's day. */
export async function ensureOpsLink(kind: LinkKind, bookingId: string): Promise<{ ok: true; link: OpsLink } | Fail> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = service();
    const { data } = await supabase
      .from("operation_bookings")
      .select("id, status, start_date, detail, assignee_kind, assignee_supplier_id")
      .eq("id", bookingId)
      .maybeSingle();
    const b = data as {
      id: string;
      status: string;
      start_date: string | null;
      detail: Record<string, string> | null;
      assignee_kind: string;
      assignee_supplier_id: string | null;
    } | null;
    if (!b || b.status === "cancelled") return { ok: false, error: "ops.err.notFound" };

    const now = new Date();
    let target: Record<string, string | null>;
    let open = supabase
      .from("operation_links")
      .select("id, token, expires_at")
      .eq("kind", kind)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString());
    if (kind === "supplier") {
      if (b.assignee_kind !== "supplier" || !b.assignee_supplier_id) return { ok: false, error: "ops.link.err.noSupplier" };
      target = { booking_id: b.id, supplier_id: b.assignee_supplier_id, expires_at: supplierLinkExpiry(now) };
      open = open.eq("booking_id", b.id).eq("supplier_id", b.assignee_supplier_id);
    } else {
      const phone = waNumber(b.detail?.[DRV.phone] ?? "");
      if (phone.length < 7) return { ok: false, error: "ops.link.err.noPhone" };
      if (!b.start_date) return { ok: false, error: "ops.link.err.noDate" };
      target = {
        driver_phone: phone,
        driver_name: b.detail?.[DRV.driver]?.trim() || null,
        service_date: b.start_date,
        expires_at: driverLinkExpiry(b.start_date),
      };
      open = open.eq("driver_phone", phone).eq("service_date", b.start_date);
    }

    const existing = await open.order("created_at", { ascending: false }).limit(1).maybeSingle();
    // before 0067 is applied the table is not there
    if (existing.error) return { ok: false, error: "ops.link.err.notReady" };
    if (existing.data) return { ok: true, link: existing.data as OpsLink };

    const { data: row, error } = await supabase
      .from("operation_links")
      .insert({ kind, token: randomBytes(24).toString("base64url"), ...target, created_by: await getCurrentEmployeeId() })
      .select("id, token, expires_at")
      .single();
    if (error || !row) return { ok: false, error: "err.createFailed" };
    await logAudit({ action: "voucher.issued", entity: "operation_bookings", entity_id: b.id, meta: { ops_link: kind, link_id: (row as OpsLink).id } });
    return { ok: true, link: row as OpsLink };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Stop a link now — the page answers «not found» from the next request. */
export async function revokeOpsLink(linkId: string): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_links", linkId);
  if (denied) return { ok: false, error: denied };
  try {
    const { data, error } = await service()
      .from("operation_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", linkId)
      .is("revoked_at", null)
      .select("kind, booking_id")
      .maybeSingle();
    if (error) return { ok: false, error: "err.updateFailed" };
    const row = data as { kind: LinkKind; booking_id: string | null } | null;
    if (row) await logAudit({ action: "voucher.revoked", entity: row.booking_id ? "operation_bookings" : "operation_links", entity_id: row.booking_id ?? linkId, meta: { ops_link: row.kind, link_id: linkId } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
