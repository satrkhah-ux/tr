/**
 * The ONE line a repackaged file's case holds for what we owe its supplier.
 *
 * A repackaged offer prices the supplier's package as a whole — its cost is
 * `pricings.buy_total`, and its hotel lines carry none — so the case opened
 * with hotels and flights that cost nothing and a supplier nobody owed. This
 * line is the debt: kind «service», the supplier on it, the supplier's cost (in
 * the supplier's own currency) as its quoted net. «حسابات الموردين» lists it
 * once the supplier confirms it, and the supplier's payments are recorded
 * against it — through the same screens as any other booking.
 *
 * It is internal: no date (so no day-of-the-trip paper or driver board picks it
 * up), a neutral title, and the client-facing readers skip it (isPackageLine).
 * Pure: no React, no Supabase.
 */

import type { RepackageData } from "./repackage-types";

export const PACKAGE_REF_PREFIX = "package:";

/** The booking's `origin_ref` — one per offer, so a second pull finds it and adds no twin. */
export const packageRef = (offerId: string) => `${PACKAGE_REF_PREFIX}${offerId}`;

/** A booking that stands for the supplier's whole package: never shown to the client, never dated. */
export const isPackageLine = (originRef: string | null | undefined): boolean => Boolean(originRef?.startsWith(PACKAGE_REF_PREFIX));

export type PackageLine = {
  origin_ref: string;
  kind: "service";
  title: string;
  city_name: string;
  start_date: null;
  end_date: null;
  detail: Record<string, string>;
  /** the supplier's name as typed on the import — an internal column no client reader selects. */
  supplier_name: string;
  cancellation_policy: null;
  /** what the supplier is paid, in `currency` — the repackage's supplier_total. */
  quoted_net: number;
  currency: string;
  /** the registered supplier (company_suppliers) when the file is linked to one. */
  assignee_supplier_id: string | null;
};

/**
 * The line for a repackaged offer, or null when there is no supplier cost to
 * owe (the import carried no price).
 */
export function packageLine(offerId: string, data: RepackageData): PackageLine | null {
  const pkg = data.extracted;
  if (!pkg || pkg.supplier_total == null || !(pkg.supplier_total > 0)) return null;
  const where = (pkg.destination || pkg.country).trim();
  return {
    origin_ref: packageRef(offerId),
    kind: "service",
    title: where ? `الباقة كاملة — ${where}` : "الباقة كاملة",
    city_name: "",
    start_date: null,
    end_date: null,
    detail: {},
    supplier_name: data.source.supplier_name.trim(),
    cancellation_policy: null,
    quoted_net: pkg.supplier_total,
    currency: (pkg.supplier_currency || "SAR").trim().toUpperCase(),
    assignee_supplier_id: data.source.company_supplier_id,
  };
}
