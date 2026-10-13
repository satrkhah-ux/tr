"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import type { TranslationKey } from "@/lib/i18n";

/**
 * «أسعار التوصيل والجولات» — a city's price table, filled once (data orders 6, 7).
 *
 *   transfers: each airport / station / port of the city × each fleet car = the
 *              price from it to the city (transfers, 0072 from/to kind + id);
 *   tours:     each tour of the city × each fleet car (tour_prices, 0072).
 *
 * One cell is one row: a price saves it, an empty cell deletes it. The old text
 * columns of a transfer (from_city / to_city) are written too, so whatever still
 * reads them by name keeps finding the price. data.write, like the data screens.
 */

export type GridMode = "transfers" | "tours";
export type GridCity = { id: string; name: string; country: string; currency: string | null };
export type GridRow = { id: string; label: string };
export type PriceGrid = {
  rows: GridRow[];
  cars: string[];
  /** `${rowId}|${car}` → the price on that cell. */
  cells: Record<string, { price: number; currency: string }>;
};
type Fail = { ok: false; error: TranslationKey };

async function staffClient(): Promise<SupabaseClient | Fail> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  if (!(await currentCan("data.write"))) return { ok: false, error: "err.forbidden" };
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const isFail = (x: unknown): x is Fail => typeof x === "object" && x !== null && "ok" in x;

/** The cities to choose from, with their country (and its currency, the grid's default). */
export async function getGridCities(): Promise<GridCity[]> {
  const db = await staffClient();
  if (isFail(db)) return [];
  const { data } = await db
    .from("cities")
    .select("id, arabic_name, countries(arabic_name, default_currency)")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("arabic_name");
  type Row = { id: string; arabic_name: string; countries: { arabic_name: string; default_currency: string | null } | null };
  return ((data ?? []) as unknown as Row[])
    .map((c) => ({ id: c.id, name: c.arabic_name, country: c.countries?.arabic_name ?? "", currency: c.countries?.default_currency ?? null }))
    .sort((a, b) => a.country.localeCompare(b.country, "ar"));
}

export async function getPriceGrid(mode: GridMode, cityId: string): Promise<{ ok: true; grid: PriceGrid } | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  // the agency's own vehicles, smallest first — what «نوع السيارة» can be everywhere else
  const { data: fleet } = await db
    .from("transportation_types")
    .select("arabic_name, pax_capacity, status")
    .eq("category", "fleet")
    .order("pax_capacity", { ascending: true, nullsFirst: false });
  const cars = [
    ...new Set(
      ((fleet ?? []) as { arabic_name: string | null; status: string | null }[])
        .filter((c) => c.status !== "Disabled" && c.arabic_name?.trim())
        .map((c) => c.arabic_name!.trim()),
    ),
  ];
  const cells: PriceGrid["cells"] = {};

  if (mode === "transfers") {
    const { data: points, error } = await db
      .from("airports")
      .select("id, arabic_name, code, kind, status")
      .eq("city_id", cityId)
      .order("arabic_name");
    // `kind` is 0072's: before it is applied this screen has nothing to stand on
    if (error) return { ok: false, error: "data.model.grid.notReady" };
    const rows = ((points ?? []) as { id: string; arabic_name: string; code: string | null; status: string | null }[])
      .filter((p) => p.status !== "Disabled")
      .map((p) => ({ id: p.id, label: p.code ? `${p.arabic_name} (${p.code})` : p.arabic_name }));
    if (rows.length > 0) {
      const { data: prices } = await db
        .from("transfers")
        .select("from_id, car_type, price, currency")
        .eq("to_kind", "city")
        .eq("to_id", cityId)
        .in("from_id", rows.map((r) => r.id));
      for (const p of (prices ?? []) as { from_id: string; car_type: string | null; price: number | string | null; currency: string | null }[]) {
        if (p.car_type && p.price != null) cells[`${p.from_id}|${p.car_type}`] = { price: Number(p.price), currency: p.currency || "SAR" };
      }
    }
    return { ok: true, grid: { rows, cars, cells } };
  }

  const { data: tours, error } = await db.from("tours").select("id, arabic_name").eq("city_id", cityId).order("arabic_name");
  if (error) return { ok: false, error: "data.model.grid.notReady" };
  const rows = ((tours ?? []) as { id: string; arabic_name: string }[]).map((t) => ({ id: t.id, label: t.arabic_name }));
  if (rows.length > 0) {
    const { data: prices } = await db.from("tour_prices").select("tour_id, car_type, price, currency").in("tour_id", rows.map((r) => r.id));
    for (const p of (prices ?? []) as { tour_id: string; car_type: string; price: number | string; currency: string }[]) {
      cells[`${p.tour_id}|${p.car_type}`] = { price: Number(p.price), currency: p.currency };
    }
  }
  return { ok: true, grid: { rows, cars, cells } };
}

/** The point kind a row of /airports is, as a transfer names it. */
const pointKind = (kind: string | null) => (kind === "airport" ? "airport" : kind === "port" ? "port" : "station");

export async function savePriceCell(input: {
  mode: GridMode;
  cityId: string;
  rowId: string;
  car: string;
  price: number | null;
  currency: string;
}): Promise<{ ok: true } | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  const car = input.car.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!car || !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "err.updateFailed" };
  if (input.price != null && !(Number.isFinite(input.price) && input.price >= 0)) return { ok: false, error: "err.updateFailed" };

  if (input.mode === "tours") {
    const { error } =
      input.price == null
        ? await db.from("tour_prices").delete().eq("tour_id", input.rowId).eq("car_type", car)
        : await db
            .from("tour_prices")
            .upsert({ tour_id: input.rowId, car_type: car, price: input.price, currency }, { onConflict: "tour_id,car_type" });
    return error ? { ok: false, error: "err.updateFailed" } : { ok: true };
  }

  const [{ data: point }, { data: city }] = await Promise.all([
    db.from("airports").select("arabic_name, kind").eq("id", input.rowId).maybeSingle(),
    db.from("cities").select("arabic_name, country_id").eq("id", input.cityId).maybeSingle(),
  ]);
  if (!point || !city) return { ok: false, error: "err.updateFailed" };
  const p = point as { arabic_name: string; kind: string | null };
  const c = city as { arabic_name: string; country_id: string | null };
  const key = { from_kind: pointKind(p.kind), from_id: input.rowId, to_kind: "city", to_id: input.cityId, car_type: car };
  const { error } =
    input.price == null
      ? await db
          .from("transfers")
          .delete()
          .match(key)
      : await db
          .from("transfers")
          .upsert(
            { ...key, from_city: p.arabic_name, to_city: c.arabic_name, price: input.price, currency, country_id: c.country_id },
            { onConflict: "from_kind,from_id,to_kind,to_id,car_type" },
          );
  return error ? { ok: false, error: "err.updateFailed" } : { ok: true };
}
