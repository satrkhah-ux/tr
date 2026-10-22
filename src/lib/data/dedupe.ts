"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { normAr } from "@/lib/catalog/norm";
import { logAudit } from "./audit";
import { allRows } from "./all-rows";

/**
 * «بيانات مكررة» on «مراجعة الأسعار» (the owner, 2026-10-22: «توجد بيانات
 * متكررة … راجع البيانات»): the same tour, transfer, service, car type or tour
 * programme held more than once — often at different prices — and the same
 * car written two ways. Built live; nothing changes by itself. The owner
 * picks: keep one (the others' prices moved onto it where it lacks them, then
 * they go, each a JSON copy in the private bucket first), one spelling for
 * all, or «ليست مكررة» (remembered). Seeing is data.write; changing is
 * settings.manage, as every delete and merge in «البيانات».
 */

export type DupTable = "tours" | "transfers" | "services" | "transportation_types" | "tour_programs";
export type DupRow = { id: string; label: string; detail: string; price: string; uses: number };
export type DupGroup = { key: string; table: DupTable; country: string; title: string; rows: DupRow[] };
export type Spelling = { key: string; variants: { value: string; count: number }[] };
export type Duplicates = { groups: DupGroup[]; spellings: Spelling[]; canChange: boolean };
type Fail = { ok: false; error: string };

const DISMISSED = "dedupe_dismissed";
const BUCKET = "supplier-docs";
const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const money = (p: unknown, c: unknown) => (p == null ? "—" : `${Number(p).toLocaleString("en-US")} ${c ?? ""}`.trim());
type Row = Record<string, unknown> & { id: string };

async function every(db: SupabaseClient, table: string, columns: string): Promise<Row[]> {
  return (
    await allRows<Row>((from, to) => db.from(table).select(columns).order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>)
  ).data;
}

/** Each table's rows that are the same thing, by a key its own words make. */
const KEYS: Record<DupTable, { columns: string; key: (r: Row) => string; label: (r: Row) => string; detail: (r: Row, city: (id: unknown) => string) => string; price: (r: Row) => string }> = {
  tours: {
    columns: "id, arabic_name, country_id, city_id, price, currency, provisional",
    key: (r) => [r.country_id, r.city_id, normAr(String(r.arabic_name))].join("|"),
    label: (r) => String(r.arabic_name),
    detail: (r, city) => city(r.city_id) + (r.provisional ? " · مؤقت" : ""),
    price: (r) => money(r.price, r.currency),
  },
  transfers: {
    columns: "id, from_city, to_city, car_type, country_id, price, currency",
    key: (r) => [r.country_id, normAr(String(r.from_city)), normAr(String(r.to_city)), normAr(String(r.car_type))].join("|"),
    label: (r) => `${r.from_city} → ${r.to_city}`,
    detail: (r) => String(r.car_type ?? ""),
    price: (r) => money(r.price, r.currency),
  },
  services: {
    columns: "id, arabic_name, country_id, service_type, sell_price, sell_currency",
    key: (r) => [r.country_id, normAr(String(r.arabic_name))].join("|"),
    label: (r) => String(r.arabic_name),
    detail: (r) => String(r.service_type ?? ""),
    price: (r) => money(r.sell_price, r.sell_currency),
  },
  transportation_types: {
    columns: "id, arabic_name, english_name",
    key: (r) => normAr(String(r.arabic_name)),
    label: (r) => String(r.arabic_name),
    detail: (r) => String(r.english_name ?? ""),
    price: () => "",
  },
  tour_programs: {
    columns: "id, title, country_id, city_id",
    key: (r) => [r.country_id, r.city_id, normAr(String(r.title))].join("|"),
    label: (r) => String(r.title),
    detail: (r, city) => city(r.city_id),
    price: () => "",
  },
};

export async function getDuplicates(): Promise<Duplicates> {
  const none: Duplicates = { groups: [], spellings: [], canChange: false };
  if (!(await getServerUser()) || !(await currentCan("data.write"))) return none;
  try {
    const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const [countries, cities, dismissed, canChange] = await Promise.all([
      db.from("countries").select("id, arabic_name"),
      every(db, "cities", "id, arabic_name"),
      db.from("app_settings").select("value").eq("key", DISMISSED).maybeSingle(),
      currentCan("settings.manage"),
    ]);
    const countryName = new Map(((countries.data ?? []) as { id: string; arabic_name: string }[]).map((c) => [c.id, c.arabic_name]));
    const cityName = new Map(cities.map((c) => [c.id, String(c.arabic_name)]));
    const city = (id: unknown) => (id ? (cityName.get(String(id)) ?? "") : "بلا مدينة");
    const skip = new Set<string>(JSON.parse(((dismissed.data as { value?: string } | null)?.value ?? "[]") || "[]") as string[]);

    const groups: DupGroup[] = [];
    let transfers: Row[] = [];
    let tourPrices: Row[] = [];
    for (const table of Object.keys(KEYS) as DupTable[]) {
      const k = KEYS[table];
      const rows = await every(db, table, k.columns);
      if (table === "transfers") transfers = rows;
      const byKey = new Map<string, Row[]>();
      for (const r of rows) byKey.set(k.key(r), [...(byKey.get(k.key(r)) ?? []), r]);
      const dup = [...byKey.entries()].filter(([key, list]) => list.length > 1 && !skip.has(`${table}|${key}`));
      if (table === "tours" && dup.length) {
        const ids = dup.flatMap(([, list]) => list.map((r) => r.id));
        tourPrices = ((await db.from("tour_prices").select("id, tour_id").in("tour_id", ids)).data ?? []) as Row[];
      }
      for (const [key, list] of dup) {
        groups.push({
          key: `${table}|${key}`,
          table,
          country: countryName.get(String(list[0].country_id ?? "")) ?? "",
          title: k.label(list[0]),
          rows: list.map((r) => ({
            id: r.id,
            label: k.label(r),
            detail: k.detail(r, city),
            price: k.price(r),
            // a tour's per-car prices: what «إبقاء» moves onto the kept one
            uses: table === "tours" ? tourPrices.filter((p) => p.tour_id === r.id).length : 0,
          })),
        });
      }
    }
    // the same car written two ways («سياره صغيرة» / «سيارة صغيرة»)
    const variants = new Map<string, Map<string, number>>();
    for (const r of transfers) {
      const raw = String(r.car_type ?? "").trim();
      if (!raw) continue;
      const m = variants.get(normAr(raw)) ?? new Map<string, number>();
      m.set(raw, (m.get(raw) ?? 0) + 1);
      variants.set(normAr(raw), m);
    }
    const spellings = [...variants.entries()]
      .filter(([key, m]) => m.size > 1 && !skip.has(`spelling|${key}`))
      .map(([key, m]) => ({ key: `spelling|${key}`, variants: [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) }));
    return { groups, spellings, canChange };
  } catch {
    return none;
  }
}

async function manager(): Promise<boolean> {
  return Boolean(await getServerUser()) && (await currentCan("settings.manage"));
}

/** A JSON copy of what is about to go, in the private bucket — the audit row names it, never the prices. */
async function backup(name: string, payload: unknown): Promise<string | null> {
  const path = `backups/dedupe/${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.json`;
  const up = await service().storage.from(BUCKET).upload(path, new TextEncoder().encode(JSON.stringify(payload, null, 1)), { contentType: "application/json", upsert: false });
  return up.error ? null : path;
}

/**
 * «إبقاء هذا»: the others of its group go. A tour's per-car prices move onto
 * the kept one where it has none for that car; a programme's tours point at the
 * kept one. Only rows that really are the kept one's group — the key is
 * worked out again here.
 */
export async function keepOne(table: DupTable, keepId: string, dropIds: string[]): Promise<{ ok: true } | Fail> {
  if (!(await manager())) return { ok: false, error: "forbidden" };
  if (!KEYS[table] || !keepId || dropIds.length === 0 || dropIds.includes(keepId)) return { ok: false, error: "invalid" };
  try {
    const db = service();
    const k = KEYS[table];
    const { data } = await db.from(table).select("*").in("id", [keepId, ...dropIds]);
    const rows = (data ?? []) as Row[];
    const keep = rows.find((r) => r.id === keepId);
    const drop = rows.filter((r) => dropIds.includes(r.id));
    if (!keep || drop.length !== dropIds.length || drop.some((r) => k.key(r) !== k.key(keep))) return { ok: false, error: "invalid" };

    const prices = table === "tours" ? (((await db.from("tour_prices").select("*").in("tour_id", [keepId, ...dropIds])).data ?? []) as Row[]) : [];
    const path = await backup(table, { table, kept: keep, dropped: drop, tour_prices: prices });
    if (!path) return { ok: false, error: "backup" };

    if (table === "tours") {
      const has = new Set(prices.filter((p) => p.tour_id === keepId).map((p) => normAr(String(p.car_type))));
      for (const p of prices.filter((p) => p.tour_id !== keepId)) {
        if (has.has(normAr(String(p.car_type)))) continue;
        await db.from("tour_prices").update({ tour_id: keepId }).eq("id", p.id);
        has.add(normAr(String(p.car_type)));
      }
    }
    if (table === "tour_programs") await db.from("tours").update({ program_id: keepId }).in("program_id", dropIds);
    const { error } = await db.from(table).delete().in("id", dropIds);
    if (error) return { ok: false, error: "used" };
    await logAudit({ action: "data.deleted", entity: table, entity_id: keepId, meta: { dedupe: true, kept: keepId, dropped: dropIds, backup: path } });
    return { ok: true };
  } catch {
    return { ok: false, error: "db" };
  }
}

/** One spelling for a car on every transfer and tour price that writes it another way. */
export async function unifySpelling(groupKey: string, value: string): Promise<{ ok: true } | Fail> {
  if (!(await manager())) return { ok: false, error: "forbidden" };
  const key = groupKey.replace(/^spelling\|/, "");
  if (!value.trim() || normAr(value) !== key) return { ok: false, error: "invalid" };
  try {
    const db = service();
    const [t, p] = await Promise.all([every(db, "transfers", "id, car_type"), every(db, "tour_prices", "id, car_type")]);
    const other = (rows: Row[]) => rows.filter((r) => normAr(String(r.car_type)) === key && String(r.car_type).trim() !== value).map((r) => r.id);
    const transfers = other(t);
    const tourPrices = other(p);
    if (transfers.length) await db.from("transfers").update({ car_type: value }).in("id", transfers);
    if (tourPrices.length) await db.from("tour_prices").update({ car_type: value }).in("id", tourPrices);
    await logAudit({ action: "data.updated", entity: "transfers", entity_id: key, meta: { dedupe: true, car_type: value, transfers: transfers.length, tour_prices: tourPrices.length } });
    return { ok: true };
  } catch {
    return { ok: false, error: "db" };
  }
}

/** «ليست مكررة»: the group stays off the list. */
export async function notDuplicate(groupKey: string): Promise<{ ok: true } | Fail> {
  if (!(await manager())) return { ok: false, error: "forbidden" };
  try {
    const db = service();
    const { data } = await db.from("app_settings").select("value").eq("key", DISMISSED).maybeSingle();
    const list = new Set<string>(JSON.parse(((data as { value?: string } | null)?.value ?? "[]") || "[]") as string[]);
    list.add(groupKey.slice(0, 300));
    const { error } = await db.from("app_settings").upsert({ key: DISMISSED, value: JSON.stringify([...list]), updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "db" };
    await logAudit({ action: "data.updated", entity: "app_settings", entity_id: DISMISSED, meta: { group: groupKey.slice(0, 300) } });
    return { ok: true };
  } catch {
    return { ok: false, error: "db" };
  }
}
