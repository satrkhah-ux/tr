import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PointKind, PointTransfer, PricingReference, TourPrice } from "@/lib/offer/pricing-suggest";

/**
 * The price lists the data model (0072) adds to «اقتراح التسعير», for one country:
 *
 *   points — transfers stored from a point to an area (from/to kind + id), each
 *            end resolved to its name and, for an airport, its IATA code: what
 *            resolveAirportCity prices reception and farewell from;
 *   tours  — a tour's price per vehicle (tour_prices), named as the tour and
 *            carrying its programme, so a pick finds the price for its car.
 *
 * Kept out of suggestPricingForDraft on purpose (that file is shared with the
 * partner-pricing work): one call there, everything here. Read with the caller's
 * client (the service role there). Fails open — before 0072 is applied the
 * columns and the table do not exist, and the sheet is priced as before.
 */
export async function addModelPrices(reference: PricingReference, db: SupabaseClient, countryId: string | null): Promise<void> {
  if (!countryId) return;
  const [points, tours] = await Promise.all([pointTransfers(db, countryId), tourPrices(db, countryId)]);
  if (points.length > 0) reference.points = points;
  if (tours.length > 0) reference.tours = [...(reference.tours ?? []), ...tours];
}

/** The list's own rule for a currency: a code, or «ريال سعودي» written out; anything else is no price. */
function currencyCode(raw: string | null): string | null {
  const c = raw?.trim() === "ريال سعودي" ? "SAR" : (raw?.trim().toUpperCase() ?? "");
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

async function pointTransfers(db: SupabaseClient, countryId: string): Promise<PointTransfer[]> {
  try {
    const { data, error } = await db
      .from("transfers")
      .select("from_kind, from_id, to_kind, to_id, car_type, price, currency, created_at")
      .eq("country_id", countryId)
      .not("from_kind", "is", null)
      .not("to_kind", "is", null)
      .not("price", "is", null);
    if (error || !data || data.length === 0) return [];
    type Row = { from_kind: PointKind; from_id: string; to_kind: PointKind; to_id: string; car_type: string | null; price: number | string; currency: string | null; created_at: string | null };
    const rows = data as Row[];
    // a city end is a row of cities; an airport, station or port end a row of airports
    const cityIds = new Set<string>();
    const pointIds = new Set<string>();
    for (const r of rows) {
      (r.from_kind === "city" ? cityIds : pointIds).add(r.from_id);
      (r.to_kind === "city" ? cityIds : pointIds).add(r.to_id);
    }
    const [cities, airports] = await Promise.all([
      db.from("cities").select("id, arabic_name").in("id", [...cityIds]),
      db.from("airports").select("id, arabic_name, code").in("id", [...pointIds]),
    ]);
    const name = new Map<string, { name: string; code: string | null }>();
    for (const c of (cities.data ?? []) as { id: string; arabic_name: string }[]) name.set(c.id, { name: c.arabic_name, code: null });
    for (const a of (airports.data ?? []) as { id: string; arabic_name: string; code: string | null }[]) name.set(a.id, { name: a.arabic_name, code: a.code });
    return rows.flatMap((r) => {
      const from = name.get(r.from_id);
      const to = name.get(r.to_id);
      const currency = currencyCode(r.currency);
      if (!from || !to || !currency) return [];
      return [{
        from_kind: r.from_kind, from_name: from.name, from_code: from.code,
        to_kind: r.to_kind, to_name: to.name, to_code: to.code,
        car_type: r.car_type, price: Number(r.price), currency, created_at: r.created_at,
      }];
    });
  } catch {
    return [];
  }
}

async function tourPrices(db: SupabaseClient, countryId: string): Promise<TourPrice[]> {
  try {
    const { data, error } = await db
      .from("tour_prices")
      .select("car_type, price, currency, provisional, tours!inner(arabic_name, program_id, country_id)")
      .eq("tours.country_id", countryId);
    if (error || !data) return [];
    type Row = { car_type: string; price: number | string; currency: string | null; provisional?: boolean | null; tours: { arabic_name: string | null; program_id: string | null } | null };
    return (data as unknown as Row[]).flatMap((r) => {
      const currency = currencyCode(r.currency);
      const name = r.tours?.arabic_name?.trim();
      return name && currency ? [{ name, price: Number(r.price), currency, car_type: r.car_type, program_id: r.tours?.program_id ?? null, ...(r.provisional ? { provisional: true } : {}) }] : [];
    });
  } catch {
    return [];
  }
}
