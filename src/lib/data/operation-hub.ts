"use server";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { CLIENT_DOCUMENT_KINDS, type VoucherKind } from "@/lib/operations/voucher-dto";
import { voucherLive, type ClientBookingRow, type StayKey } from "@/lib/operations/client-booking-state";
import { gateOperation } from "@/lib/operations/access";
import { resolveDocBrand } from "@/lib/data/doc-brand";
import { getPartnerSession } from "@/lib/partners/session";

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

/** Mint the client link, or return the existing one. Idempotent. */
export async function ensureClientLink(operationId: string): Promise<{ ok: true; token: string } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  return mintClientLink((await createSupabaseServerClient()) as unknown as SupabaseClient, operationId);
}

/**
 * The same link, asked for by the partner whose client it is — they send it to
 * their traveller. The partner may READ its own operations (0037) but not write
 * them, so: visible through the partner's own session first, then minted with
 * the service role.
 */
export async function partnerClientLink(operationId: string): Promise<{ ok: true; token: string } | Fail> {
  if (!(await getPartnerSession())) return { ok: false, error: "err.session" };
  try {
    const own = await ((await createSupabaseServerClient()) as unknown as SupabaseClient)
      .from("operations")
      .select("id, client_token_revoked_at")
      .eq("id", operationId)
      .maybeSingle();
    if (!own.data) return { ok: false, error: "ops.err.notFound" };
    // a link we stopped stays stopped — a new one is ours to give
    if ((own.data as { client_token_revoked_at: string | null }).client_token_revoked_at) return { ok: false, error: "ops.err.forbidden" };
    return mintClientLink(createSupabaseServiceClient() as unknown as SupabaseClient, operationId);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

async function mintClientLink(supabase: SupabaseClient, operationId: string): Promise<{ ok: true; token: string } | Fail> {
  try {
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
  const denied = await gateOperation(operationId);
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
  /** what is still being worked on, in words the client can read — with our booking number for it (0084). */
  pending: { kind: string; title: string; ref: string | null }[];
  /** whose trip it is — a partner's client sees the partner's name, number and colour, not ours. */
  brand: {
    name: string;
    nameLatin: string;
    phone: string;
    website: string;
    color: string | null;
    /** the company's second colour (gold for us) — null keeps ours. */
    accent: string | null;
    /** null → our own logo asset. */
    logo: string | null;
    whatsapp: string;
  };
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
        // a hotel voucher's stays: whether its confirmation still holds (voucherLive)
        .select("kind, version, token, created_at, stays:snapshot_json->bookings")
        .eq("operation_id", op.id)
        // the booking summary (suppliers, what is unpaid) and the welcome board are ours, never the client's
        .in("kind", CLIENT_DOCUMENT_KINDS)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("operation_bookings")
        .select("kind, title, start_date, status, confirmation_number, company_ref")
        .eq("operation_id", op.id)
        .neq("status", "cancelled"),
    ]);

    const bookings = (bookingsRes.data ?? []) as Pick<ClientBookingRow, "kind" | "title" | "start_date" | "status" | "confirmation_number" | "company_ref">[];
    const documents = ((docsRes.data ?? []) as { kind: VoucherKind; version: number; token: string; created_at: string; stays: StayKey[] | null }[])
      // the paper shown at the hotel desk only while the hotel's own confirmation it prints holds
      .filter((d) => d.kind !== "hotel_voucher" || voucherLive(d.stays, bookings))
      .map((d) => ({ kind: d.kind, version: d.version, token: d.token, issued_at: d.created_at.slice(0, 10) }));

    // Only "still being worked on" — never a price, never a supplier name.
    const pending = bookings
      .filter((b) => b.status !== "confirmed")
      .map((b) => ({ kind: b.kind, title: b.title, ref: b.company_ref ?? null }));

    const { brand } = await resolveDocBrand({ serial: offer?.serial ?? "" });

    return {
      serial: offer?.serial ?? "",
      destination: offer?.destination ?? null,
      customer_name: customer?.arabic_name ?? null,
      travel_start: op.travel_start,
      travel_end: op.travel_end,
      documents,
      pending,
      brand: {
        name: brand.nameAr,
        nameLatin: brand.nameLatin,
        phone: brand.phone,
        website: brand.website,
        color: brand.vars?.["--od-green"] ?? null,
        accent: brand.vars?.["--od-gold"] ?? null,
        logo: brand.logoUrl,
        whatsapp: brand.whatsapp,
      },
    };
  } catch {
    return null;
  }
}
