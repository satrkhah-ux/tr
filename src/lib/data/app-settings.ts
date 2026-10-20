"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "@/lib/data/audit";
import { forgetFeatureFlags, getFeatureFlags } from "@/lib/features-server";
import { FEATURES_SETTING_KEY, isFeature, type Feature } from "@/lib/features";
import { intlPhone, listTeletelTeams } from "@/lib/providers/teletel";
import { SETTING as MURAD_SETTING } from "@/lib/murad/core";
import { parseDelay, parseHours, readRoutes, ROUTE_KEYS, type Routes } from "@/lib/murad/reception";
import { readOffers, type OfferCountry } from "@/lib/murad/auto-offer";
import { usdSarRate } from "@/lib/offer/pricing";

/**
 * Choices the administration makes once for everyone (app_settings, 0054).
 *
 * Read by any staff session; written only here, after settings.manage, through
 * the service role — the table has no write policy at all.
 */

/** Which system the package generator searches for hotels: "internal" or a hotel_suppliers code. */
export async function getHotelSearchSource(): Promise<string> {
  if (!(await getServerUser())) return "internal";
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase.from("app_settings").select("value").eq("key", "hotel_search_source").maybeSingle();
    return (data as { value?: string } | null)?.value?.trim() || "internal";
  } catch {
    return "internal";
  }
}

export type SetSettingResult = { ok: true } | { ok: false; error: "err.forbidden" | "err.db" };

export async function setHotelSearchSource(code: string): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "err.forbidden" };
  const value = code.trim();
  if (!value) return { ok: false, error: "err.db" };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    // Only a source that exists: the internal catalogue, or a supplier row.
    if (value !== "internal") {
      const { data } = await supabase.from("hotel_suppliers").select("code").eq("code", value).maybeSingle();
      if (!data) return { ok: false, error: "err.db" };
    }
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "hotel_search_source", value, updated_at: new Date().toISOString() });
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Who puts the profit on a package, and the margin a file starts with.
 *
 * `by`: "staff" — the agent issuing the package sets it (the owner's choice,
 * 2026-10-13); "managers" — only a viewer with pricing.internal. `default_pct`:
 * a margin applied to a file whose profit nobody stated (null = none).
 */
export type ProfitSettings = { by: "staff" | "managers"; default_pct: number | null };

export async function getProfitSettings(): Promise<ProfitSettings> {
  const fallback: ProfitSettings = { by: "staff", default_pct: null };
  if (!(await getServerUser())) return fallback;
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase.from("app_settings").select("key, value").in("key", ["profit_by", "profit_default_pct"]);
    const rows = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const pct = Number(rows.get("profit_default_pct"));
    return {
      by: rows.get("profit_by") === "managers" ? "managers" : "staff",
      default_pct: rows.get("profit_default_pct") && Number.isFinite(pct) && pct > 0 ? pct : null,
    };
  } catch {
    return fallback;
  }
}

export async function setProfitSettings(next: ProfitSettings): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "err.forbidden" };
  if (next.by !== "staff" && next.by !== "managers") return { ok: false, error: "err.db" };
  const pct = next.default_pct;
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 500)) return { ok: false, error: "err.db" };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const at = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert([
      { key: "profit_by", value: next.by, updated_at: at },
      { key: "profit_default_pct", value: pct == null || pct === 0 ? "" : String(pct), updated_at: at },
    ]);
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The company's dollar (pricing.ts USD_SAR_DEFAULT) — what «سياسة الربح» shows. */
export async function getUsdRate(): Promise<number> {
  try {
    const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient).from("app_settings").select("value").eq("key", "usd_sar_rate").maybeSingle();
    return usdSarRate((data as { value?: string } | null)?.value);
  } catch {
    return usdSarRate(null);
  }
}

/**
 * «سعر صرف الدولار» on «سياسة الربح» (the owner, 2026-10-19): every new price,
 * profit and commission takes it within a minute; issued files keep theirs.
 * 3–5 riyals only. Audited — before and after.
 */
export async function setUsdRate(rate: number): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "err.forbidden" };
  if (!Number.isFinite(rate) || rate < 3 || rate > 5) return { ok: false, error: "err.db" };
  try {
    const before = await getUsdRate();
    const value = String(Math.round(rate * 10000) / 10000);
    const { error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("app_settings")
      .upsert({ key: "usd_sar_rate", value, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: "usd_sar_rate", meta: { before, after: Number(value) } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** «مطوّر»: switch one system service off or on (features.ts). Audited — who stopped what, and when. */
export async function setFeature(feature: Feature, on: boolean): Promise<SetSettingResult> {
  if (!(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  if (!isFeature(feature) || typeof on !== "boolean") return { ok: false, error: "err.db" };
  try {
    const next = { ...(await getFeatureFlags()), [feature]: on };
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: FEATURES_SETTING_KEY, value: JSON.stringify(next), updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    forgetFeatureFlags();
    await logAudit({ action: "feature.toggled", entity: "app_settings", entity_id: FEATURES_SETTING_KEY, meta: { feature, on } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- «مُراد» (src/lib/murad) ----------

/**
 * The numbers Murad may answer on WhatsApp himself (murad_auto_phones), beside
 * the owner's test number. developer.access only, audited: putting a number
 * here lets a model write to that client.
 */
export async function setMuradAutoPhones(phones: string[]): Promise<SetSettingResult> {
  if (!(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  if (!Array.isArray(phones) || phones.length > 20) return { ok: false, error: "err.db" };
  const clean = phones.map((p) => (typeof p === "string" ? intlPhone(p) : null));
  if (clean.some((p) => p === null)) return { ok: false, error: "err.db" };
  const value = JSON.stringify([...new Set(clean)]);
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { error } = await supabase.from("app_settings").upsert({ key: "murad_auto_phones", value, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: "murad_auto_phones", meta: { count: clean.length } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** «سياسات الشركة» Murad answers policy questions from — empty: those go to staff. */
export async function getMuradPolicies(): Promise<string> {
  if (!(await currentCan("settings.manage")) && !(await currentCan("developer.access"))) return "";
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase.from("app_settings").select("value").eq("key", "murad_policies").maybeSingle();
    return (data as { value?: string } | null)?.value ?? "";
  } catch {
    return "";
  }
}

export async function setMuradPolicies(text: string): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage")) && !(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  if (typeof text !== "string" || text.length > 4000) return { ok: false, error: "err.db" };
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { error } = await supabase.from("app_settings").upsert({ key: "murad_policies", value: text.trim(), updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: "murad_policies", meta: { length: text.trim().length } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- «المستقبل الآلي» (src/lib/murad/reception.ts) ----------

export type ReceptionSetup = {
  teams: { id: number; name: string }[];
  routes: Routes;
  /** false: the table shown is the suggestion from the teams' names, nothing saved yet */
  saved: boolean;
  hours: string;
  /** «20-60»: the seconds Murad waits before answering */
  delay: string;
  /** «عروض آلية»: the countries Murad prices himself */
  offers: OfferCountry[];
  /** the company's dollar — the auto-offer example prices with it */
  usd: number;
  scope: "test" | "all";
};

/** The department → Teletel team table and the working day, for /settings/client-comms. */
export async function getReceptionSetup(): Promise<ReceptionSetup | null> {
  if (!(await currentCan("settings.manage")) && !(await currentCan("developer.access"))) return null;
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const [teams, { data }] = await Promise.all([
      listTeletelTeams(),
      service.from("app_settings").select("key, value").in("key", [MURAD_SETTING.receptionRoutes, MURAD_SETTING.receptionHours, MURAD_SETTING.receptionScope, MURAD_SETTING.receptionDelay, MURAD_SETTING.receptionOffers]),
    ]);
    const v = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const hours = parseHours(v.get(MURAD_SETTING.receptionHours));
    const delay = parseDelay(v.get(MURAD_SETTING.receptionDelay));
    return {
      offers: readOffers(v.get(MURAD_SETTING.receptionOffers)),
      usd: await getUsdRate(),
      delay: `${delay.min}-${delay.max}`,
      teams,
      routes: readRoutes(v.get(MURAD_SETTING.receptionRoutes), teams),
      saved: v.has(MURAD_SETTING.receptionRoutes),
      hours: `${hours.open}-${hours.close}`,
      scope: v.get(MURAD_SETTING.receptionScope) === "all" ? "all" : "test",
    };
  } catch {
    return null;
  }
}

/** Saves the table and the working day. settings.manage (or the developer); audited. */
export async function setReceptionRoutes(routes: Routes, hours: string, delay = "20-60"): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage")) && !(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  const clean: Routes = {};
  for (const k of [...ROUTE_KEYS, "fallback"] as const) {
    const v = routes?.[k];
    clean[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  const h = parseHours(hours);
  const d = parseDelay(delay);
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const now = new Date().toISOString();
    const { error } = await service.from("app_settings").upsert([
      { key: MURAD_SETTING.receptionRoutes, value: JSON.stringify(clean), updated_at: now },
      { key: MURAD_SETTING.receptionHours, value: `${h.open}-${h.close}`, updated_at: now },
      { key: MURAD_SETTING.receptionDelay, value: `${d.min}-${d.max}`, updated_at: now },
    ]);
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: MURAD_SETTING.receptionRoutes, meta: { routes: clean, hours: `${h.open}-${h.close}`, delay: `${d.min}-${d.max}` } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The trial's two numbers, or every client — the owner's call, from /developer only; audited. */
export async function setReceptionScope(scope: "test" | "all"): Promise<SetSettingResult> {
  if (!(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  if (scope !== "test" && scope !== "all") return { ok: false, error: "err.db" };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { error } = await service.from("app_settings").upsert({ key: MURAD_SETTING.receptionScope, value: scope, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: MURAD_SETTING.receptionScope, meta: { scope } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** «عروض آلية»: the countries Murad prices himself, their route, hotels and prices. settings.manage (or the developer); audited. */
export async function setReceptionOffers(offers: OfferCountry[]): Promise<SetSettingResult> {
  if (!(await currentCan("settings.manage")) && !(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
  const clean: OfferCountry[] = [];
  for (const o of Array.isArray(offers) ? offers.slice(0, 20) : []) {
    const cities = (Array.isArray(o?.cities) ? o.cities : [])
      .slice(0, 8)
      .map((c) => ({ city: String(c?.city ?? "").trim().slice(0, 60), nights: num(c?.nights, 30) ?? 1, hotel: String(c?.hotel ?? "").trim().slice(0, 120) }))
      .filter((c) => c.city);
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : []);
    const fields = [num(o?.carPerDay, 100000), num(o?.roomPerNight, 100000), num(o?.transfer, 100000), num(o?.marginPct, 100), num(o?.maxPeople, 20)];
    if (!String(o?.country ?? "").trim() || !cities.length || fields.some((f) => f === null)) return { ok: false, error: "err.db" };
    const [carPerDay, roomPerNight, transfer, marginPct, maxPeople] = fields as number[];
    clean.push({
      country: String(o.country).trim().slice(0, 60),
      enabled: o.enabled === true,
      cities,
      carPerDay,
      roomPerNight,
      transfer,
      currency: /^[A-Z]{3}$/.test(String(o.currency)) ? String(o.currency) : "USD",
      marginPct,
      maxPeople,
      includes: list(o.includes),
      excludes: list(o.excludes),
    });
  }
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { error } = await service.from("app_settings").upsert({ key: MURAD_SETTING.receptionOffers, value: JSON.stringify(clean), updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "err.db" };
    await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: MURAD_SETTING.receptionOffers, meta: { countries: clean.map((o) => `${o.country}${o.enabled ? "" : " (off)"}`) } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
