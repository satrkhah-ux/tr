"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getPartnerSession } from "./session";

/**
 * «عملائي» — the partner's own clients: the people its issued offers name.
 *
 * customers is staff-only (RLS), and a partner's clients are rows like any
 * other there (written by customerFor when the partner issues, never matched to
 * one of ours). So the service role reads them — strictly through the partner's
 * OWN offers (partner_company_id from the server session), never by name or
 * phone, never Teletel's contacts, never ours.
 */
export type PartnerCustomer = {
  name: string;
  phone: string | null;
  offers: number;
  last_serial: string;
  last_destination: string | null;
  last_at: string;
};

export async function listPartnerCustomers(): Promise<PartnerCustomer[]> {
  const partner = await getPartnerSession();
  if (!partner) return [];
  try {
    const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("offers")
      .select("serial, destination, created_at, customer_id, customers(arabic_name, mobile)")
      .eq("partner_company_id", partner.partner_id)
      .not("customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    type Row = {
      serial: string;
      destination: string | null;
      created_at: string;
      customer_id: string;
      customers: { arabic_name: string | null; mobile: string | null } | { arabic_name: string | null; mobile: string | null }[] | null;
    };
    const byCustomer = new Map<string, PartnerCustomer>();
    // newest first, so the first row seen for a client is its latest offer
    for (const row of (data ?? []) as Row[]) {
      const c = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      const seen = byCustomer.get(row.customer_id);
      if (seen) seen.offers += 1;
      else
        byCustomer.set(row.customer_id, {
          name: c?.arabic_name || "—",
          phone: c?.mobile ?? null,
          offers: 1,
          last_serial: row.serial,
          last_destination: row.destination,
          last_at: row.created_at.slice(0, 10),
        });
    }
    return [...byCustomer.values()];
  } catch {
    return [];
  }
}
