import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptJson } from "@/lib/crypto/secrets";
import type { HotelSupplierRow } from "@/lib/types";
import { buildHotelSupplier, type HotelSupplier, type SupplierCredentials } from "./hotel-supplier";

/**
 * Server-side supplier registry: reads hotel_suppliers, DECRYPTS credentials, and
 * builds adapter instances. NOT a "use server" module — it returns non-serializable
 * adapter objects for server-only use (search actions, test-connection). Uses the
 * SERVICE-ROLE client because the credential vault is RLS-locked to deny direct
 * client access; decrypted credentials never leave the server.
 */

export async function getSupplierRows(): Promise<HotelSupplierRow[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data } = await supabase.from("hotel_suppliers").select("*").order("priority", { ascending: true });
    return (data ?? []) as HotelSupplierRow[];
  } catch {
    return [];
  }
}

function adapterFor(row: HotelSupplierRow): HotelSupplier {
  const creds = row.credentials_encrypted ? decryptJson<SupplierCredentials>(row.credentials_encrypted) : null;
  // Per the hard rule: credentials absent → the MOCK adapter runs (nothing breaks).
  if (!creds) return buildHotelSupplier("mock", null, null);
  const withBase: SupplierCredentials = { ...creds, base_url: creds.base_url || row.base_url || "" };
  return buildHotelSupplier(row.code, withBase, row.base_url);
}

/** Enabled suppliers ordered by priority; falls back to the mock when none are enabled. */
export async function getEnabledHotelSuppliers(): Promise<HotelSupplier[]> {
  const rows = (await getSupplierRows()).filter((r) => r.enabled);
  const list = rows.map(adapterFor);
  // DEMO MODE: inject the Almosafer demo supplier WITHOUT a DB row, so the
  // management demo runs locally on captured-real data with no server wiring.
  // Guarded by an env flag; never set it in production (it serves fixtures).
  if (process.env.ALMOSAFER_DEMO === "1") list.unshift(buildHotelSupplier("almosafer", null, null));
  if (list.length === 0) return [buildHotelSupplier("mock", null, null)];
  return list;
}

/** The adapter for one supplier code (uses its stored, decrypted credentials). */
export async function getSupplierAdapter(code: string): Promise<HotelSupplier | null> {
  const row = (await getSupplierRows()).find((r) => r.code === code);
  if (!row) return null;
  return adapterFor(row);
}
