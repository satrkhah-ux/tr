"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { TRAVELIUN_BRAND, partnerBrand, publicBrandLogoUrl, type DocBrand } from "@/components/offer-doc/brand";
import { currentCan } from "@/lib/roles/current";
import { isStaffSession } from "@/lib/partners/session";

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
  return await currentCan("data.write") ? null : "err.forbidden";
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
  /** pending until an employee approves it — see partners/registration.ts. */
  status: string;
  /** Arabic family this company prints in — see font-families.ts. */
  doc_font: string;
  price_adjust_kind: string;
  price_adjust_pct: number;
  approved_at: string | null;
  registration_note: string | null;
  contact_email: string | null;
  commercial_register: string | null;
  tourism_license: string | null;
  vat_number: string | null;
  city: string | null;
  country: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  reference_no: string | null;
  documents: { kind: string; path: string; name: string; size: number; type: string }[];
  /** a login was issued — «إصدار حساب» then, «إعادة إرسال» after. */
  has_account: boolean;
};

const COLUMNS =
  "id, name, name_latin, logo_path, brand_color, accent_color, address, phone, whatsapp, website, email, contact_name, resells, active, note, status, price_adjust_kind, price_adjust_pct, approved_at, registration_note, contact_email, doc_font, commercial_register, tourism_license, vat_number, city, country, terms_accepted_at, terms_version, reference_no, documents";

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
    const [{ data }, { data: users }] = await Promise.all([query, supabase.from("partner_users").select("partner_id")]);
    const withAccount = new Set(((users ?? []) as { partner_id: string }[]).map((u) => u.partner_id));
    const url = baseUrl();
    return ((data ?? []) as Omit<PartnerCompany, "logo_url" | "has_account">[]).map((row) => ({
      ...row,
      logo_url: publicLogoUrl(url, row.logo_path),
      has_account: withAccount.has(row.id),
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
  doc_font?: string;
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
      "doc_font",
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
    // A real delete also takes the company's partner LOGINS with it (the
    // partner_users cascade), which is settings.manage's call, not data.write's:
    // without it the company is deactivated, as above. 0047 took DELETE from
    // sessions, so the delete itself runs as the service role behind that check.
    if ((used.count ?? 0) > 0 || !(await currentCan("settings.manage"))) {
      await supabase.from("booking_partners").update({ active: false }).eq("id", id);
      await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: id, meta: { deactivated: true } });
      return { ok: true };
    }
    const { error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("booking_partners")
      .delete()
      .eq("id", id);
    return error ? { ok: false, error: "err.deleteFailed" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Which company an offer is branded for, or null for our own identity.
 *
 * The company is also who we BILL (partner_cost, 0058): changing it clears the
 * cost so the new company is never invoiced at the old one's terms (it is priced
 * again by hand — ledger-server.ts). Refused once the offer is invoiced, and on a
 * partner's own file: that one belongs to the company that built it.
 */
export async function setOfferPartner(serial: string, partnerId: string | null): Promise<{ ok: true } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase.from("offers").select("id, partner_company_id").eq("serial", serial).maybeSingle();
    const offer = data as { id: string; partner_company_id: string | null } | null;
    if (!offer) return { ok: false, error: "err.loadFailed" };
    if ((offer.partner_company_id ?? null) === (partnerId ?? null)) return { ok: true };

    const [invoice, draft] = await Promise.all([
      service.from("partner_invoices").select("id").eq("offer_id", offer.id).limit(1).maybeSingle(),
      service.from("offer_drafts").select("partner_company_id").eq("data->>produced_serial", serial).not("partner_company_id", "is", null).limit(1).maybeSingle(),
    ]);
    if (invoice.data) return { ok: false, error: "partner.err.invoiced" };
    if (draft.data) return { ok: false, error: "partner.err.partnerFile" };

    const { error } = await supabase.from("offers").update({ partner_company_id: partnerId, partner_cost: null }).eq("id", offer.id);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "partner.updated", entity: "offers", entity_id: offer.id, meta: { serial, from: offer.partner_company_id, to: partnerId, partner_cost_cleared: true } });
    return { ok: true };
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
    const row = data as Omit<PartnerCompany, "logo_url" | "has_account"> | null;
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

/**
 * Suspend a company, or let it back in. «موقوف» shuts the portal and every read
 * at once — current_partner_id() and getPartnerSession() admit «approved» only —
 * while its files, offers and history stay. The reason goes to the audit log.
 */
export async function setPartnerSuspended(id: string, suspended: boolean, reason: string): Promise<{ ok: true } | Fail> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { data, error } = await supabase
      .from("booking_partners")
      .update({ status: suspended ? "suspended" : "approved" })
      .eq("id", id)
      // only an approved company is suspended, only a suspended one comes back — never a pending or rejected one
      .eq("status", suspended ? "approved" : "suspended")
      .select("id");
    if (error || !data || data.length === 0) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "partner.updated",
      entity: "booking_partners",
      entity_id: id,
      meta: { suspended, reason: reason.trim() || null },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type PartnerCompanyDetail = {
  company: PartnerCompany;
  users: { email: string; name: string | null; status: string; created_at: string }[];
  /** files started (with something in them or not — this is our view). */
  files: number;
  offers: {
    serial: string;
    destination: string | null;
    total: number | null;
    currency: string | null;
    status: string | null;
    created_at: string;
    client_status: string | null;
    execution_status: string | null;
  }[];
  /** confirmed offers' value, per currency — never added across currencies. */
  sales: { currency: string; total: number }[];
  /** recorded payments minus refunds on its confirmed cases, per currency. */
  paid: { currency: string; net: number }[];
  activity: { action: string; actor_email: string | null; created_at: string; meta: Record<string, unknown> }[];
};

/** One company, for us: its people, files, offers, confirmations, money and history. Staff only (RLS is_staff). */
export async function getPartnerCompanyDetail(id: string): Promise<PartnerCompanyDetail | null> {
  try {
    // ours only: a partner session reads its own company row, and this page is not for it
    if (!(await isStaffSession())) return null;
    const supabase = await db();
    const companies = await listPartnerCompanies();
    const company = companies.find((c) => c.id === id);
    if (!company) return null;

    const [usersRes, offersRes, auditRes] = await Promise.all([
      supabase.from("partner_users").select("email, name, status, created_at").eq("partner_id", id).order("created_at"),
      supabase
        .from("offers")
        .select("id, serial, destination, total, currency, status, created_at")
        .eq("partner_company_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("audit_logs")
        .select("action, actor_email, created_at, meta")
        .eq("entity", "booking_partners")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    // drafts are closed to sessions (0047) — a count only, through the service role, behind the staff read above
    const { count: files } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("offer_drafts")
      .select("id", { count: "exact", head: true })
      .eq("partner_company_id", id);

    type OfferRow = { id: string; serial: string; destination: string | null; total: number | null; currency: string | null; status: string | null; created_at: string };
    const offerRows = (offersRes.data ?? []) as OfferRow[];
    const opsRes = offerRows.length
      ? await supabase.from("operations").select("id, offer_id, client_status, execution_status").in("offer_id", offerRows.map((o) => o.id))
      : { data: [] };
    const ops = (opsRes.data ?? []) as { id: string; offer_id: string; client_status: string; execution_status: string }[];
    const opByOffer = new Map(ops.map((o) => [o.offer_id, o]));
    const payRes = ops.length
      ? await supabase.from("operation_payments").select("amount, currency, kind").in("operation_id", ops.map((o) => o.id))
      : { data: [] };

    const sales = new Map<string, number>();
    for (const o of offerRows) {
      if (!opByOffer.has(o.id) || o.total == null) continue;
      const cur = o.currency || "SAR";
      sales.set(cur, (sales.get(cur) ?? 0) + Number(o.total));
    }
    const paid = new Map<string, number>();
    for (const p of (payRes.data ?? []) as { amount: number | string; currency: string | null; kind: string }[]) {
      const cur = p.currency || "SAR";
      paid.set(cur, (paid.get(cur) ?? 0) + (p.kind === "refund" ? -1 : 1) * (Number(p.amount) || 0));
    }

    return {
      company,
      users: (usersRes.data ?? []) as PartnerCompanyDetail["users"],
      files: files ?? 0,
      offers: offerRows.map((o) => ({
        serial: o.serial,
        destination: o.destination,
        total: o.total != null ? Number(o.total) : null,
        currency: o.currency,
        status: o.status,
        created_at: o.created_at,
        client_status: opByOffer.get(o.id)?.client_status ?? null,
        execution_status: opByOffer.get(o.id)?.execution_status ?? null,
      })),
      sales: [...sales.entries()].map(([currency, total]) => ({ currency, total })),
      paid: [...paid.entries()].map(([currency, net]) => ({ currency, net })),
      activity: (auditRes.data ?? []) as PartnerCompanyDetail["activity"],
    };
  } catch {
    return null;
  }
}
