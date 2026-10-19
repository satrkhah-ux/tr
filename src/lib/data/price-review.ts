"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { normAr } from "@/lib/catalog/norm";
import { logAudit } from "./audit";
import { allRows } from "./all-rows";

/**
 * «مراجعة الأسعار» (the owner, 2026-10-18) — the prices still waiting on a
 * person, in «قسم البيانات», for everyone who keeps the data (data.write):
 *
 *  · airport: every airport of the countries the files use most, with what the
 *    list already prices to its city, asking the small car's price;
 *  · transfer / tour: the provisional 100 SAR placeholders (0095, 0096);
 *  · conflict: one tour name, several prices.
 *
 * Built live from the tables — nothing to sync. Every save writes the table
 * itself, drops «مؤقت», and is one audit row (who, what, before → after) that
 * the page's «آخر التحديثات» reads back.
 */

export type ReviewKind = "airport" | "transfer" | "tour" | "conflict";
export type ReviewRow = {
  key: string;
  kind: ReviewKind;
  country: string;
  city: string;
  label: string;
  sub: string;
  car: string;
  /** the price this row is about now (null: none yet) */
  price: number | null;
  currency: string;
  provisional: boolean;
  /** what the list holds besides: every car's price, or the conflicting prices */
  listed: string[];
  /** who last changed it here, and when */
  last: { by: string; at: string } | null;
};
export type ReviewEntry = { at: string; by: string; label: string; kind: string; before: string; after: string };
export type ReviewPage = { rows: ReviewRow[]; history: ReviewEntry[] };
type Fail = { ok: false; error: string };

const SMALL_CAR = "سيارة صغيرة";
const TOP_COUNTRIES = 7;
const money = (p: number | null | undefined, c: string | null | undefined) => (p == null ? "—" : `${Number(p).toLocaleString("en-US")} ${c ?? ""}`.trim());

async function staff(): Promise<SupabaseClient | null> {
  if (!(await getServerUser()) || !(await currentCan("data.write"))) return null;
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** the countries the files use most: the drafts' trip country, counted */
async function topCountries(): Promise<string[]> {
  const { data } = await service().from("offer_drafts").select("country:data->trip->>country").limit(5000);
  const n = new Map<string, number>();
  for (const r of (data ?? []) as { country: string | null }[]) if (r.country?.trim()) n.set(r.country.trim(), (n.get(r.country.trim()) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_COUNTRIES).map(([c]) => c);
}

export async function getPriceReview(): Promise<ReviewPage | Fail> {
  const db = await staff();
  if (!db) return { ok: false, error: "err.forbidden" };
  const countries = await topCountries();
  const [{ data: airports }, { data: transfers }, { data: tourPrices }, { data: tours }, { data: audits }] = await Promise.all([
    db
      .from("airports")
      .select("id, arabic_name, code, status, kind, countries(arabic_name), cities(arabic_name)")
      .eq("status", "Active"),
    allRows((a, b) => db.from("transfers").select("id, from_city, to_city, car_type, price, currency, provisional, countries(arabic_name)").order("id").range(a, b)),
    db.from("tour_prices").select("id, car_type, price, currency, provisional, tours!inner(arabic_name, countries(arabic_name), cities(arabic_name))").eq("provisional", true),
    allRows((a, b) => db.from("tours").select("id, arabic_name, price, currency, countries(arabic_name), cities(arabic_name)").not("price", "is", null).order("id").range(a, b)),
    service().from("audit_logs").select("entity, entity_id, actor_email, meta, created_at").eq("action", "price.reviewed").order("created_at", { ascending: false }).limit(300),
  ]);

  const auditRows = (audits ?? []) as { entity: string; entity_id: string; actor_email: string | null; meta: Record<string, string>; created_at: string }[];
  const lastBy = new Map<string, { by: string; at: string }>();
  for (const a of auditRows) {
    const k = `${a.entity}:${a.entity_id}`;
    if (!lastBy.has(k)) lastBy.set(k, { by: a.actor_email ?? "—", at: a.created_at });
  }

  type Named = { arabic_name: string } | null;
  const rows: ReviewRow[] = [];
  const tr = (transfers ?? []) as unknown as { id: string; from_city: string; to_city: string; car_type: string; price: number | string | null; currency: string; provisional: boolean; countries: Named }[];

  // ---------- airports of the most-used countries ----------
  const wanted = new Set(countries.map(normAr));
  const core = (s: string) => normAr(s.replace(/مطار|الدولي|الدولى|\(.*?\)/g, "")).replace(/\s+/g, "");
  for (const a of (airports ?? []) as unknown as { id: string; arabic_name: string; code: string | null; kind: string | null; countries: Named; cities: Named }[]) {
    const country = a.countries?.arabic_name ?? "";
    const city = a.cities?.arabic_name ?? "";
    if ((a.kind ?? "airport") !== "airport" || !city || !wanted.has(normAr(country))) continue;
    const ac = core(a.arabic_name);
    const roads = tr.filter((t) => normAr(t.to_city) === normAr(city) && t.from_city?.includes("مطار") && ac && (core(t.from_city).includes(ac) || ac.includes(core(t.from_city))));
    const small = roads.filter((t) => normAr(t.car_type) === normAr(SMALL_CAR)).at(-1);
    rows.push({
      key: `airport:${a.id}`,
      kind: "airport",
      country,
      city,
      label: `${a.arabic_name} ← ${city}`,
      sub: a.code ?? "",
      car: SMALL_CAR,
      price: small?.price == null ? null : Number(small.price),
      currency: small?.currency ?? "SAR",
      provisional: Boolean(small?.provisional),
      listed: [...new Map(roads.map((t) => [t.car_type, `${t.car_type} ${money(t.price == null ? null : Number(t.price), t.currency)}${t.provisional ? " (مؤقت)" : ""}`])).values()],
      last: lastBy.get(`airports:${a.id}`) ?? null,
    });
  }
  rows.sort((x, y) => countries.indexOf(x.country) - countries.indexOf(y.country) || x.city.localeCompare(y.city, "ar"));

  // ---------- the provisional transfers ----------
  for (const t of tr.filter((x) => x.provisional)) {
    rows.push({
      key: `transfer:${t.id}`,
      kind: "transfer",
      country: t.countries?.arabic_name ?? "",
      city: t.to_city,
      label: `${t.from_city} ← ${t.to_city}`,
      sub: "استقبال المطار وتوديعه",
      car: t.car_type,
      price: t.price == null ? null : Number(t.price),
      currency: t.currency,
      provisional: true,
      listed: [`${money(t.price == null ? null : Number(t.price), t.currency)} (مؤقت)`],
      last: lastBy.get(`transfers:${t.id}`) ?? null,
    });
  }

  // ---------- the provisional tours ----------
  for (const p of (tourPrices ?? []) as unknown as { id: string; car_type: string; price: number | string | null; currency: string; tours: { arabic_name: string; countries: Named; cities: Named } | null }[]) {
    rows.push({
      key: `tour:${p.id}`,
      kind: "tour",
      country: p.tours?.countries?.arabic_name ?? "",
      city: p.tours?.cities?.arabic_name ?? "",
      label: p.tours?.arabic_name ?? "—",
      sub: "",
      car: p.car_type,
      price: p.price == null ? null : Number(p.price),
      currency: p.currency,
      provisional: true,
      listed: [`${money(p.price == null ? null : Number(p.price), p.currency)} (مؤقت)`],
      last: lastBy.get(`tour_prices:${p.id}`) ?? null,
    });
  }

  // ---------- one tour, several prices ----------
  const groups = new Map<string, { ids: string[]; name: string; country: string; city: string; prices: Set<string> }>();
  for (const t of (tours ?? []) as unknown as { id: string; arabic_name: string; price: number | string; currency: string; countries: Named; cities: Named }[]) {
    const k = `${normAr(t.countries?.arabic_name)}|${normAr(t.cities?.arabic_name)}|${normAr(t.arabic_name)}`;
    const g = groups.get(k) ?? { ids: [], name: t.arabic_name, country: t.countries?.arabic_name ?? "", city: t.cities?.arabic_name ?? "", prices: new Set<string>() };
    g.ids.push(t.id);
    g.prices.add(money(Number(t.price), t.currency));
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    if (g.prices.size < 2) continue;
    const id = g.ids.sort()[0];
    rows.push({
      key: `conflict:${g.ids.sort().join(",")}`,
      kind: "conflict",
      country: g.country,
      city: g.city,
      label: g.name,
      sub: `${g.ids.length} صفوف بالاسم نفسه`,
      car: "",
      price: null,
      currency: [...g.prices][0].split(" ").at(-1) ?? "SAR",
      provisional: false,
      listed: [...g.prices],
      last: lastBy.get(`tours:${id}`) ?? null,
    });
  }

  const history = auditRows.slice(0, 60).map((a) => ({
    at: a.created_at,
    by: a.actor_email ?? "—",
    label: String(a.meta?.label ?? ""),
    kind: String(a.meta?.kind ?? ""),
    before: String(a.meta?.before ?? "—"),
    after: String(a.meta?.after ?? "—"),
  }));
  return { rows, history };
}

/**
 * Save one row's price — or keep the one it has («اعتماد كما هو», price null).
 * Writes the table, drops «مؤقت», records who did it.
 */
export async function saveReviewPrice(key: string, price: number | null, currency: string): Promise<{ ok: true } | Fail> {
  const db = await staff();
  if (!db) return { ok: false, error: "err.forbidden" };
  const cur = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur) || (price != null && !(Number.isFinite(price) && price >= 0))) return { ok: false, error: "err.updateFailed" };
  const [kind, idPart] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)] as [ReviewKind, string];
  const audit = (entity: string, id: string, label: string, before: string, after: string) =>
    logAudit({ action: "price.reviewed", entity, entity_id: id, meta: { kind, label, before, after } });

  if (kind === "transfer" || kind === "tour") {
    const table = kind === "transfer" ? "transfers" : "tour_prices";
    const { data: was } = await db
      .from(table)
      .select(kind === "transfer" ? "price, currency, from_city, to_city" : "price, currency, tours(arabic_name)")
      .eq("id", idPart)
      .maybeSingle();
    if (!was) return { ok: false, error: "err.loadFailed" };
    const w = was as unknown as { price: number | null; currency: string; from_city?: string; to_city?: string; tours?: { arabic_name: string } | null };
    const label = kind === "transfer" ? `${w.from_city} ← ${w.to_city}` : (w.tours?.arabic_name ?? "");
    const next = { price: price ?? w.price, currency: price == null ? w.currency : cur, provisional: false };
    const { error } = await db.from(table).update(next).eq("id", idPart);
    if (error) return { ok: false, error: "err.updateFailed" };
    await audit(table, idPart, label, money(w.price, w.currency) + " (مؤقت)", money(next.price, next.currency));
    return { ok: true };
  }

  if (kind === "conflict") {
    if (price == null) return { ok: false, error: "price" };
    const ids = idPart.split(",").filter(Boolean);
    const { data: was } = await db.from("tours").select("id, arabic_name, price, currency").in("id", ids);
    const w = (was ?? []) as { id: string; arabic_name: string; price: number; currency: string }[];
    // the ids came from the page: they must still be one tour's name
    if (w.length === 0 || new Set(w.map((t) => normAr(t.arabic_name))).size !== 1) return { ok: false, error: "err.loadFailed" };
    const { error } = await db.from("tours").update({ price, currency: cur }).in("id", ids);
    if (error) return { ok: false, error: "err.updateFailed" };
    await audit("tours", [...ids].sort()[0], w[0].arabic_name, [...new Set(w.map((t) => money(Number(t.price), t.currency)))].join(" / "), money(price, cur));
    return { ok: true };
  }

  if (kind === "airport") {
    const { data: a } = await db.from("airports").select("id, arabic_name, kind, city_id, cities(arabic_name, country_id)").eq("id", idPart).maybeSingle();
    const ap = a as unknown as { id: string; arabic_name: string; kind: string | null; city_id: string | null; cities: { arabic_name: string; country_id: string | null } | null } | null;
    if (!ap?.city_id || !ap.cities) return { ok: false, error: "err.loadFailed" };
    // the road as the list already names it (an imported or provisional row), else as «أسعار التوصيل» keys it
    const { data: same } = await db
      .from("transfers")
      .select("id, from_city, price, currency")
      .eq("to_city", ap.cities.arabic_name)
      .eq("car_type", SMALL_CAR)
      .ilike("from_city", "%مطار%");
    const core = (s: string) => normAr(s.replace(/مطار|الدولي|الدولى|\(.*?\)/g, "")).replace(/\s+/g, "");
    const hit = ((same ?? []) as { id: string; from_city: string; price: number | null; currency: string }[]).filter(
      (t) => core(t.from_city).includes(core(ap.arabic_name)) || core(ap.arabic_name).includes(core(t.from_city)),
    );
    const before = hit[0] ? money(hit[0].price, hit[0].currency) : "—";
    if (price == null && !hit[0]) return { ok: false, error: "price" };
    const { error } = hit.length
      ? await db
          .from("transfers")
          .update({ ...(price == null ? {} : { price, currency: cur }), provisional: false })
          .in("id", hit.map((t) => t.id))
      : await db.from("transfers").insert({
          from_kind: "airport",
          from_id: ap.id,
          to_kind: "city",
          to_id: ap.city_id,
          car_type: SMALL_CAR,
          from_city: ap.arabic_name,
          to_city: ap.cities.arabic_name,
          price,
          currency: cur,
          country_id: ap.cities.country_id,
        });
    if (error) return { ok: false, error: "err.updateFailed" };
    await audit("airports", ap.id, `${ap.arabic_name} ← ${ap.cities.arabic_name}`, before, price == null ? before : money(price, cur));
    return { ok: true };
  }
  return { ok: false, error: "err.updateFailed" };
}
