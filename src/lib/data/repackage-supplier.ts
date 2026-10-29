import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepackageData } from "@/lib/repackage/repackage-types";
import { matchSupplier, type CompanySupplier } from "@/lib/repackage/supplier-match";

/**
 * The registered supplier (company_suppliers) behind a repackage — the link the
 * file already holds, else the one its supplier's NAME says. Service-role reads,
 * for server code that has already checked who is asking (the confirmation's pull
 * and the order screen): the registry is staff-only and a partner must not learn
 * whom we buy from.
 */
const COLUMNS = "id, arabic_name, english_name, contact_name, mobile, whatsapp, email, request_lang, status";

type Row = Omit<CompanySupplier, "request_lang"> & { request_lang: string | null };
const toSupplier = (r: Row): CompanySupplier => ({ ...r, request_lang: r.request_lang === "en" ? "en" : "ar" });

export async function registeredSupplier(db: SupabaseClient, data: Pick<RepackageData, "source">): Promise<CompanySupplier | null> {
  const linked = data.source.company_supplier_id;
  if (linked) {
    const { data: row } = await db.from("company_suppliers").select(COLUMNS).eq("id", linked).maybeSingle();
    if (row) return toSupplier(row as Row);
  }
  const name = data.source.supplier_name.trim();
  if (!name) return null;
  const { data: rows, error } = await db.from("company_suppliers").select(COLUMNS).order("arabic_name").limit(1000);
  // before 0063 the whatsapp / request_lang columns do not exist: no registry link rather than a wrong one
  if (error) return null;
  const hit = matchSupplier(((rows ?? []) as Row[]).map(toSupplier), name);
  return hit;
}
