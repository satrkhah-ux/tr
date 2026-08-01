import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptJson } from "@/lib/crypto/secrets";
import type { HotelSupplierRow } from "@/lib/types";
import {
  buildHotelSupplier,
  type HotelSupplier,
  type SupplierCallRecord,
  type SupplierCallRecorder,
  type SupplierCredentials,
  type SupplierEnvironment,
} from "./hotel-supplier";

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

function adapterFor(row: HotelSupplierRow, record: SupplierCallRecorder | null = null): HotelSupplier {
  const creds = row.credentials_encrypted ? decryptJson<SupplierCredentials>(row.credentials_encrypted) : null;
  // Per the hard rule: credentials absent → the MOCK adapter runs (nothing breaks).
  if (!creds) return buildHotelSupplier("mock", null, null);
  const withBase: SupplierCredentials = { ...creds, base_url: creds.base_url || row.base_url || "" };
  // environment is a DB free-text column; anything that isn't 'sandbox' is live.
  const env: SupplierEnvironment = row.environment === "sandbox" ? "sandbox" : "live";
  return buildHotelSupplier(row.code, withBase, row.base_url, env, record);
}

/**
 * Enabled suppliers ordered by priority; falls back to the mock when none are enabled.
 *
 * `sink` collects each call's request/response. The SEARCH path passes one not
 * to store it — search runs constantly — but to read WHY a supplier returned
 * nothing. `searchHotels` answers with an array, so a refusal and an empty city
 * are the same empty array, and the screen ends up blaming the dates for a
 * rejected password.
 */
export async function getEnabledHotelSuppliers(sink?: SupplierCallRecord[]): Promise<HotelSupplier[]> {
  const rows = (await getSupplierRows()).filter((r) => r.enabled);
  const list = rows.map((row) => adapterFor(row, sink ? (rec) => sink.push(rec) : null));
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

/**
 * The same adapter, but every request/response pair lands in `sink`.
 *
 * Used for the booking path only. Search runs hundreds of calls an hour and
 * logging all of them would bury the handful that moved money — and it is those
 * that a dispute, or TBO's certification, actually asks for.
 *
 * The sink is filled synchronously and written by the caller AFTER the call, so
 * a slow insert can never delay a booking or, worse, fail it.
 */
export async function getSupplierAdapterLogged(code: string, sink: SupplierCallRecord[]): Promise<HotelSupplier | null> {
  const row = (await getSupplierRows()).find((r) => r.code === code);
  if (!row) return null;
  return adapterFor(row, (rec) => sink.push(rec));
}
