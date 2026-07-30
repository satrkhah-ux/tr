"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { can } from "@/lib/roles/roles";
import { TRAVELIUN_BRAND, partnerBrand, publicBrandLogoUrl, type DocBrand } from "@/components/offer-doc/brand";

/**
 * «الشركات المتعاونة» — the companies we work with, and how their documents look.
 *
 * ONE table (booking_partners, extended by 0028) serves both roles a partner
 * plays: operations hands them bookings to execute, and sales hands them a file
 * to resell under their own name. They are the same agency in real life, so
 * entering them twice was never going to stay in sync.
 *
 * This module owns the company's IDENTITY (name, logo, colours, contacts);
 * operation-assign.ts keeps its own tiny insert for the "add a partner while
 * assigning a booking" path, which only ever writes a name and a phone.
 */

const BUCKET = "brands";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };

/** Editing a company's identity is reference-data work, like hotels or airports. */
async function requireWrite(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return can(await getCurrentRole(), "data.write") ? null : "err.forbidden";
}

export type PartnerCompany = {
  id: string;
  name: string;
  name_latin: string | null;
  logo_path: string | null;
  /** public URL for the logo, resolved from logo_path. */
  logo_url: string | null;
  brand_color: string;
  accent_color: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  email: string | null;
  contact_name: string | null;
  resells: boolean;
  active: boolean;
  note: string | null;
};

const COLUMNS =
  "id, name, name_latin, logo_path, brand_color, accent_color, address, phone, whatsapp, website, email, contact_name, resells, active, note";

/**
 * The logo's public URL.
 *
 * The bucket is public (0028) precisely so this URL works in three places that
 * cannot share a session: the staff preview, a client's browser on the offer
 * link, and a saved PDF. A signed URL would expire inside the file.
 */
const publicLogoUrl = publicBrandLogoUrl;

function baseUrl(): string {
  // Runtime read (window.__ENV__ equivalent on the server) — see runtime-env.
  return process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
}

export async function listPartnerCompanies(onlyResellers = false): Promise<PartnerCompany[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await db();
    let query = supabase.from("booking_partners").select(COLUMNS).order("name", { ascending: true });
    if (onlyResellers) query = query.eq("resells", true).eq("active", true);
    const { data } = await query;
    const url = baseUrl();
    return ((data ?? []) as Omit<PartnerCompany, "logo_url">[]).map((row) => ({
      ...row,
      logo_url: publicLogoUrl(url, row.logo_path),
    }));
  } catch {
    return [];
  }
}

export async function upsertPartnerCompany(input: {
  id?: string;
  name: string;
  name_latin?: string | null;
  brand_color?: string;
  accent_color?: string;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  email?: string | null;
  contact_name?: string | null;
  resells?: boolean;
  active?: boolean;
  note?: string | null;
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  if (!input.name.trim()) return { ok: false, error: "partner.err.nameRequired" };

  try {
    const supabase = await db();
    const patch: Record<string, unknown> = { name: input.name.trim() };
    // Only send what the form actually submitted, so an edit never blanks a
    // field the screen did not show.
    const optional = [
      "name_latin",
      "brand_color",
      "accent_color",
      "address",
      "phone",
      "whatsapp",
      "website",
      "email",
      "contact_name",
      "resells",
      "active",
      "note",
    ] as const;
    for (const key of optional) if (input[key] !== undefined) patch[key] = input[key];

    const query = input.id
      ? supabase.from("booking_partners").update(patch).eq("id", input.id).select("id").single()
      : supabase.from("booking_partners").insert(patch).select("id").single();

    const { data, error } = await query;
    if (error || !data) {
      // the unique index on lower(name) is the likely cause
      return { ok: false, error: input.id ? "err.updateFailed" : "partner.err.duplicate" };
    }
    const id = (data as { id: string }).id;
    await logAudit({
      action: input.id ? "partner.updated" : "partner.created",
      entity: "booking_partners",
      entity_id: id,
      meta: { name: patch.name, resells: patch.resells ?? null },
    });
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Upload a logo.
 *
 * A random leaf per upload rather than overwriting one path: a replaced logo
 * must not silently change the look of a PDF a client already holds, and a
 * cached CDN copy of an overwritten path is worse than a new URL.
 */
export async function uploadPartnerLogo(partnerId: string, formData: FormData): Promise<{ ok: true } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ops.err.noFile" };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "partner.err.logoTooLarge" };

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
  if (!["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) return { ok: false, error: "partner.err.logoType" };

  try {
    const supabase = await db();
    const path = `${partnerId}/${randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "image/png",
      upsert: false,
    });
    if (up.error) return { ok: false, error: "ops.err.uploadFailed" };

    await supabase.from("booking_partners").update({ logo_path: path }).eq("id", partnerId);
    await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: partnerId, meta: { logo: true } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deletePartnerCompany(id: string): Promise<{ ok: true } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    // A company that has executed a booking is history, not a row to delete —
    // operation_bookings.assignee_partner_id would go null and the audit trail
    // would name nobody. Deactivating keeps the record and hides it from pickers.
    const used = await supabase
      .from("operation_bookings")
      .select("id", { count: "exact", head: true })
      .eq("assignee_partner_id", id);
    if ((used.count ?? 0) > 0) {
      await supabase.from("booking_partners").update({ active: false }).eq("id", id);
      await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: id, meta: { deactivated: true } });
      return { ok: true };
    }
    const { error } = await supabase.from("booking_partners").delete().eq("id", id);
    return error ? { ok: false, error: "err.deleteFailed" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Which company an offer is branded for, or null for our own identity. */
export async function setOfferPartner(serial: string, partnerId: string | null): Promise<{ ok: true } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase.from("offers").update({ partner_company_id: partnerId }).eq("serial", serial);
    return error ? { ok: false, error: "err.updateFailed" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Whether THIS file prints a price. Written from the export screen. */
export async function setOfferShowPrices(serial: string, showPrices: boolean): Promise<{ ok: true } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase.from("offers").update({ show_prices: showPrices }).eq("serial", serial);
    return error ? { ok: false, error: "err.updateFailed" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ResolvedBrand = { brand: DocBrand; showPrices: boolean; partnerId: string | null };

/**
 * The brand a document should print, resolved server-side.
 *
 * `partnerId` wins when given (the export screen's picker); otherwise the
 * offer's own stored partner is used, so a file re-downloaded next week comes out
 * branded the way it was sent. Anything unresolvable falls back to OUR identity —
 * never to a half-filled partner block.
 */
export async function resolveDocBrand(input: {
  serial: string;
  partnerId?: string | null;
  showPrices?: boolean;
}): Promise<ResolvedBrand> {
  const fallback: ResolvedBrand = { brand: TRAVELIUN_BRAND, showPrices: input.showPrices ?? true, partnerId: null };
  try {
    // SERVICE client, deliberately: the public client link and its PDF have no
    // session, and booking_partners is readable by `authenticated` only — with
    // the user client those two surfaces would silently print OUR branding on a
    // partner's file. Nothing sensitive leaves: what comes back is exactly the
    // name, logo and colours the document is meant to display.
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;

    // One read: whose file it is, and whether it prints a price. Both live on the
    // offer, so the export screen, the PDF and the client link cannot disagree.
    const offerRes = await supabase
      .from("offers")
      .select("partner_company_id, show_prices")
      .eq("serial", input.serial)
      .maybeSingle();
    const offer = offerRes.data as { partner_company_id: string | null; show_prices: boolean } | null;
    const storedPrices = offer?.show_prices ?? true;

    const id = input.partnerId ?? offer?.partner_company_id ?? null;
    if (!id) return { ...fallback, showPrices: input.showPrices ?? storedPrices };

    const { data } = await supabase.from("booking_partners").select(COLUMNS).eq("id", id).maybeSingle();
    const row = data as Omit<PartnerCompany, "logo_url"> | null;
    if (!row) return fallback;

    return {
      brand: partnerBrand(row, publicLogoUrl(baseUrl(), row.logo_path)),
      // An explicit choice from the export screen wins; otherwise whatever that
      // screen last saved on this offer.
      showPrices: input.showPrices ?? storedPrices,
      partnerId: row.id,
    };
  } catch {
    return fallback;
  }
}
