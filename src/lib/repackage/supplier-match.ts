/**
 * Which registered supplier (company_suppliers) a repackage's supplier is.
 *
 * The import names its supplier as typed («المنار للسياحة»); the registry that
 * holds contact data (a number, a WhatsApp, an email, the language it is written
 * to in) is company_suppliers. The two meet by NAME, folded the way the
 * catalogue folds names (normAr) — exact, never fuzzy: sending an order to the
 * wrong company is worse than asking the employee to pick the right one once.
 * Pure: no React, no Supabase.
 */

import { normAr } from "@/lib/catalog/norm";

export type CompanySupplier = {
  id: string;
  arabic_name: string;
  english_name: string | null;
  contact_name: string | null;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
  request_lang: "ar" | "en";
  status: string | null;
};

/** The supplier whose Arabic or English name is this one, a disabled one only when nothing else matches. */
export function matchSupplier<T extends Pick<CompanySupplier, "arabic_name" | "english_name" | "status">>(list: T[], name: string): T | null {
  const wanted = normAr(name);
  if (!wanted) return null;
  const hits = list.filter((s) => normAr(s.arabic_name) === wanted || normAr(s.english_name) === wanted);
  return hits.find((s) => s.status !== "Disabled") ?? hits[0] ?? null;
}

export type SupplierContact = {
  /** who the order is addressed to — the supplier's name. */
  label: string;
  /** WhatsApp when it gave one, else the mobile. */
  phone: string | null;
  email: string | null;
  person: string | null;
  /** a way to reach it exists (a number or an email) — without one the employee types it once. */
  reachable: boolean;
};

export function supplierContact(s: Pick<CompanySupplier, "arabic_name" | "contact_name" | "mobile" | "whatsapp" | "email">): SupplierContact {
  const phone = (s.whatsapp || s.mobile || "").trim() || null;
  const email = (s.email ?? "").trim() || null;
  return { label: s.arabic_name, phone, email, person: s.contact_name?.trim() || null, reachable: Boolean(phone || email) };
}
