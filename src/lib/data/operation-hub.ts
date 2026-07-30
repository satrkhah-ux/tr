"use server";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import type { VoucherKind } from "@/lib/operations/voucher-dto";
import { currentCan } from "@/lib/roles/current";

/**
 * ONE link for the client.
 *
 * Documents already carry their own tokens for sharing a single file; this is
 * the folder. Without it the agent sends four links over four days and the
 * client loses track of which is current — the whole reason the ops team keeps
 * getting asked "did the hotel come through?".
 *
 * The link lists what has been issued SO FAR and updates itself: issuing a
 * voucher tomorrow makes it appear on the same URL, so the client can check
 * progress instead of asking.
 */

type Fail = { ok: false; error: TranslationKey };

async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return await currentCan("operations.write") ? null : "ops.err.forbidden";
}

/** Mint the client link, or return the existing one. Idempotent. */
export async function ensureClientLink(operationId: string): Promise<{ ok: true; token: string } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase
      .from("operations")
      .select("client_token, client_token_revoked_at")
      .eq("id", operationId)
      .maybeSingle();
    const row = data as { client_token: string | null; client_token_revoked_at: string | null } | null;
    if (!row) return { ok: false, error: "ops.err.notFound" };
    if (row.client_token && !row.client_token_revoked_at) return { ok: true, token: row.client_token };

    const token = randomBytes(24).toString("base64url");
    const { error } = await supabase
      .from("operations")
      .update({ client_token: token, client_token_revoked_at: null })
      .eq("id", operationId);
    if (error) return { ok: false, error: "err.updateFailed" };

    await logAudit({ action: "voucher.issued", entity: "operations", entity_id: operationId, meta: { client_link: true } });
    return { ok: true, token };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function revokeClientLink(operationId: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { error } = await supabase
      .from("operations")
      .update({ client_token_revoked_at: new Date().toISOString() })
      .eq("id", operationId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "voucher.revoked", entity: "operations", entity_id: operationId, meta: { client_link: true } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ClientHubDoc = { kind: VoucherKind; version: number; token: string; issued_at: string };

export type ClientHub = {
  serial: string;
  destination: string | null;
  customer_name: string | null;
  travel_start: string | null;
  travel_end: string | null;
  documents: ClientHubDoc[];
  /** what is still being worked on, in words the client can read. */
  pending: { kind: string; title: string }[];
};

/**
 * Read the hub for a token. SERVICE ROLE and no session — the traveller holding
 * this link is not a system user, and the token itself is the access control
 * (RLS cannot see a URL). Revoked links resolve to null, i.e. 404.
 *
 * Deliberately carries NO money and NO passport data: this is a progress page a
 * client may forward to their family.
 */
export async function getClientHub(token: string): Promise<ClientHub | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const opRes = await supabase
      .from("operations")
      .select("id, travel_start, travel_end, client_token_revoked_at, offers(serial, destination, customers(arabic_name))")
      .eq("client_token", token)
      .maybeSingle();
    const op = opRes.data as unknown as {
      id: string;
      travel_start: string | null;
      travel_end: string | null;
      client_token_revoked_at: string | null;
      offers: { serial: string; destination: string | null; customers: unknown } | { serial: string; destination: string | null; customers: unknown }[] | null;
    } | null;
    if (!op || op.client_token_revoked_at) return null;

    const offer = Array.isArray(op.offers) ? op.offers[0] : op.offers;
    const custRaw = offer?.customers as { arabic_name: string | null } | { arabic_name: string | null }[] | null;
    const customer = Array.isArray(custRaw) ? custRaw[0] : custRaw;

    const [docsRes, bookingsRes] = await Promise.all([
      supabase
        .from("operation_documents")
        .select("kind, version, token, created_at")
        .eq("operation_id", op.id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("operation_bookings")
        .select("kind, title, status")
        .eq("operation_id", op.id)
        .neq("status", "cancelled"),
    ]);

    const documents = ((docsRes.data ?? []) as { kind: VoucherKind; version: number; token: string; created_at: string }[]).map(
      (d) => ({ kind: d.kind, version: d.version, token: d.token, issued_at: d.created_at.slice(0, 10) }),
    );

    // Only "still being worked on" — never a price, never a supplier name.
    const pending = ((bookingsRes.data ?? []) as { kind: string; title: string; status: string }[])
      .filter((b) => b.status !== "confirmed")
      .map((b) => ({ kind: b.kind, title: b.title }));

    return {
      serial: offer?.serial ?? "",
      destination: offer?.destination ?? null,
      customer_name: customer?.arabic_name ?? null,
      travel_start: op.travel_start,
      travel_end: op.travel_end,
      documents,
      pending,
    };
  } catch {
    return null;
  }
}
