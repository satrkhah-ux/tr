"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import type { TranslationKey } from "@/lib/i18n";
import type { TransferPointKind } from "@/lib/types";

/**
 * «إدارة أسعار المواصلات» (the owner, 2026-10-26): one screen where a data
 * clerk picks the country, the line's two ends (city/airport/port/station, from
 * the country's own lists, adding what they lack), then prices every vehicle of
 * the fleet — saved as STRUCTURED transfers rows (0072 from_kind/from_id/
 * to_kind/to_id), one row per (road × vehicle), exactly what Basic and the
 * price grid already read. data.write, like every data screen.
 */

export type TransportPlace = { id: string; name: string; kind: TransferPointKind; cityId?: string | null };
export type TransportCar = { name: string; pax: number | null };
export type TransportRoad = {
  from: { kind: TransferPointKind; id: string; name: string };
  to: { kind: TransferPointKind; id: string; name: string };
  prices: { car: string; price: number; currency: string }[];
};
export type TransportCountry = {
  ok: true;
  currency: string | null;
  cities: TransportPlace[];
  points: TransportPlace[];
  cars: TransportCar[];
  roads: TransportRoad[];
};
type Fail = { ok: false; error: TranslationKey };

async function staffClient(): Promise<SupabaseClient | Fail> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  if (!(await currentCan("data.write"))) return { ok: false, error: "err.forbidden" };
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}
const isFail = (x: unknown): x is Fail => typeof x === "object" && x !== null && "ok" in x;
const POINT_KIND = (kind: string | null): TransferPointKind => (kind === "airport" ? "airport" : kind === "port" ? "port" : "station");

export async function getTransportCountry(countryId: string): Promise<TransportCountry | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  const [{ data: country }, { data: cities }, { data: points }, { data: fleet }, { data: caps }] = await Promise.all([
    db.from("countries").select("default_currency").eq("id", countryId).maybeSingle(),
    db.from("cities").select("id, arabic_name").eq("country_id", countryId).order("arabic_name"),
    db.from("airports").select("id, arabic_name, code, kind, city_id, status").eq("country_id", countryId).order("arabic_name"),
    db.from("transportation_types").select("arabic_name, pax_capacity, status").eq("category", "fleet").order("pax_capacity", { ascending: true, nullsFirst: false }),
    db.from("country_vehicles").select("car_type, pax_capacity").eq("country_id", countryId),
  ]);
  type Named = { id: string; arabic_name: string };
  const cityRows: TransportPlace[] = ((cities ?? []) as Named[]).map((c) => ({ id: c.id, name: c.arabic_name, kind: "city" }));
  const pointRows: TransportPlace[] = ((points ?? []) as (Named & { code: string | null; kind: string | null; city_id: string | null; status: string | null })[])
    .filter((p) => p.status !== "Disabled")
    .map((p) => ({ id: p.id, name: p.code ? `${p.arabic_name} (${p.code})` : p.arabic_name, kind: POINT_KIND(p.kind), cityId: p.city_id }));
  // the country's own capacity first, the fleet's general figure otherwise
  const byCar = new Map(((caps ?? []) as { car_type: string; pax_capacity: number | null }[]).map((c) => [c.car_type.trim(), c.pax_capacity]));
  const cars: TransportCar[] = ((fleet ?? []) as { arabic_name: string | null; pax_capacity: number | null; status: string | null }[])
    .filter((c) => c.status !== "Disabled" && c.arabic_name?.trim())
    .map((c) => ({ name: c.arabic_name!.trim(), pax: byCar.get(c.arabic_name!.trim()) ?? c.pax_capacity }));

  // the country's structured roads, grouped, for the «المحفوظ» table
  const { data: rows } = await db
    .from("transfers")
    .select("from_kind, from_id, to_kind, to_id, from_city, to_city, car_type, price, currency")
    .eq("country_id", countryId)
    .not("from_kind", "is", null);
  type Row = { from_kind: TransferPointKind; from_id: string; to_kind: TransferPointKind; to_id: string; from_city: string | null; to_city: string | null; car_type: string | null; price: number | string | null; currency: string | null };
  const roads = new Map<string, TransportRoad>();
  for (const r of (rows ?? []) as Row[]) {
    if (!r.car_type || r.price == null) continue;
    const key = `${r.from_kind}:${r.from_id}→${r.to_kind}:${r.to_id}`;
    const road = roads.get(key) ?? {
      from: { kind: r.from_kind, id: r.from_id, name: r.from_city ?? "" },
      to: { kind: r.to_kind, id: r.to_id, name: r.to_city ?? "" },
      prices: [],
    };
    road.prices.push({ car: r.car_type, price: Number(r.price), currency: r.currency || "SAR" });
    roads.set(key, road);
  }
  return {
    ok: true,
    currency: (country as { default_currency?: string | null } | null)?.default_currency ?? null,
    cities: cityRows,
    points: pointRows,
    cars,
    roads: [...roads.values()],
  };
}

/** Saves one road's vehicle prices; an empty price deletes that vehicle's row. */
export async function saveTransportRoad(input: {
  countryId: string;
  from: { kind: TransferPointKind; id: string };
  to: { kind: TransferPointKind; id: string };
  currency: string;
  prices: { car: string; price: number | null }[];
}): Promise<{ ok: true } | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "err.updateFailed" };
  if (input.from.kind === input.to.kind && input.from.id === input.to.id) return { ok: false, error: "err.updateFailed" };
  const nameOf = async (side: { kind: TransferPointKind; id: string }): Promise<string | null> => {
    const table = side.kind === "city" ? "cities" : "airports";
    const { data } = await db.from(table).select("arabic_name").eq("id", side.id).maybeSingle();
    return (data as { arabic_name?: string } | null)?.arabic_name ?? null;
  };
  const [fromName, toName] = await Promise.all([nameOf(input.from), nameOf(input.to)]);
  if (!fromName || !toName) return { ok: false, error: "err.updateFailed" };
  for (const p of input.prices) {
    const car = p.car.trim();
    if (!car) continue;
    const key = { from_kind: input.from.kind, from_id: input.from.id, to_kind: input.to.kind, to_id: input.to.id, car_type: car };
    const { error } =
      p.price == null
        ? await db.from("transfers").delete().match(key)
        : Number.isFinite(p.price) && p.price >= 0
          ? await db.from("transfers").upsert(
              { ...key, from_city: fromName, to_city: toName, price: p.price, currency, country_id: input.countryId, provisional: false },
              { onConflict: "from_kind,from_id,to_kind,to_id,car_type" },
            )
          : { error: new Error("bad price") };
    if (error) return { ok: false, error: "err.updateFailed" };
  }
  return { ok: true };
}

/** Removes one saved road whole (every vehicle's row). */
export async function deleteTransportRoad(input: { from: { kind: TransferPointKind; id: string }; to: { kind: TransferPointKind; id: string } }): Promise<{ ok: true } | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  const { error } = await db.from("transfers").delete().match({
    from_kind: input.from.kind, from_id: input.from.id, to_kind: input.to.kind, to_id: input.to.id,
  });
  return error ? { ok: false, error: "err.updateFailed" } : { ok: true };
}

/**
 * «وإن كانت لا توجد دولة أو مدينة أو مطار يمكن أن يضيفها المستخدم»: a quick add
 * from the same screen. A point (airport/port/station) belongs to a city.
 */
export async function addTransportPlace(input: {
  countryId: string;
  kind: "city" | "airport" | "port" | "station";
  name: string;
  cityId?: string | null;
}): Promise<{ ok: true; id: string } | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "err.updateFailed" };
  if (input.kind === "city") {
    const { data, error } = await db.from("cities").insert({ arabic_name: name, country_id: input.countryId }).select("id").single();
    return error ? { ok: false, error: "err.updateFailed" } : { ok: true, id: (data as { id: string }).id };
  }
  const { data, error } = await db
    .from("airports")
    .insert({ arabic_name: name, kind: input.kind, city_id: input.cityId ?? null, country_id: input.countryId, status: "Active" })
    .select("id")
    .single();
  return error ? { ok: false, error: "err.updateFailed" } : { ok: true, id: (data as { id: string }).id };
}

export async function addTransportCountry(name: string): Promise<{ ok: true; id: string } | Fail> {
  const db = await staffClient();
  if (isFail(db)) return db;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "err.updateFailed" };
  const { data, error } = await db.from("countries").insert({ arabic_name: trimmed }).select("id").single();
  return error ? { ok: false, error: "err.updateFailed" } : { ok: true, id: (data as { id: string }).id };
}
