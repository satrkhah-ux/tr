"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { encryptJson } from "@/lib/crypto/secrets";
import { getSupplierAdapter, getSupplierAdapterLogged, getSupplierRows } from "@/lib/providers/hotel-registry";
import type { SupplierCallRecord, TestConnectionResult } from "@/lib/providers/hotel-supplier";
import { getRates } from "@/lib/data/rates-actions";
import { getActiveMarkupRules } from "@/lib/data/markup-rules";
import { priceSupplierRate } from "@/lib/pricing/price-line";
import type { HotelSupplierRow, MarkupRuleRow } from "@/lib/types";
import { currentCan } from "@/lib/roles/current";

/**
 * Supplier registry admin actions. EVERY action is gated on the admin role
 * (settings.manage) — the page, the route, AND these server actions. Credentials
 * are ENCRYPTED on write and NEVER returned to the browser: reads expose only a
 * `has_credentials` boolean. Every credential change is logged to audit_logs
 * (who/when — never the value).
 */

/** SERVICE-ROLE client: the credential vault + audit log are RLS-locked to deny
 *  direct client access, so all reads/writes here go through the service role
 *  (every caller is already behind requireAdmin). Secrets never leave the server. */
function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type Admin = { id: string; email: string | null };

/** Returns the admin actor, or null when the caller is not an authenticated admin. */
async function requireAdmin(): Promise<Admin | null> {
  const user = await getServerUser();
  if (!user) return null;
  if (!await currentCan("settings.manage")) return null;
  return { id: user.id, email: user.email ?? null };
}

/** A credential-free view of a supplier row — safe to send to the browser. */
export type SupplierView = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  enabled: boolean;
  environment: string;
  base_url: string | null;
  priority: number;
  default_markup_rule_id: string | null;
  /** whether stored credentials exist — the secret itself is NEVER sent. */
  has_credentials: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
};

function maskRow(r: HotelSupplierRow): SupplierView {
  return {
    id: r.id,
    code: r.code,
    name_ar: r.name_ar,
    name_en: r.name_en,
    enabled: r.enabled,
    environment: r.environment,
    base_url: r.base_url,
    priority: r.priority,
    default_markup_rule_id: r.default_markup_rule_id,
    has_credentials: Boolean(r.credentials_encrypted),
    last_sync_at: r.last_sync_at,
    last_sync_status: r.last_sync_status,
    last_error: r.last_error,
  };
}

/** Admin: list suppliers (credentials masked to a boolean). Empty for non-admins. */
export async function listSuppliers(): Promise<SupplierView[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return (await getSupplierRows()).map(maskRow);
}

/** Admin: markup rules for the per-supplier default-rule dropdown. */
export async function listMarkupRuleOptions(): Promise<{ id: string; name: string }[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  try {
    const supabase = await db();
    const { data } = await supabase.from("markup_rules").select("id, arabic_name, status").order("priority", { ascending: false });
    return ((data ?? []) as Pick<MarkupRuleRow, "id" | "arabic_name" | "status">[])
      .filter((r) => r.status !== "Disabled")
      .map((r) => ({ id: r.id, name: r.arabic_name }));
  } catch {
    return [];
  }
}

export type SaveSupplierInput = {
  code: string;
  enabled?: boolean;
  environment?: string;
  base_url?: string | null;
  priority?: number;
  default_markup_rule_id?: string | null;
  /** secret fields — provided ONLY when replacing credentials; blank = keep existing. */
  username?: string;
  password?: string;
};

export type SaveResult = { ok: boolean; error?: string };

/** Admin: update a supplier. Credentials are (re)encrypted only when BOTH username
 *  and password are supplied; otherwise the stored secret is left untouched. */
export async function saveSupplier(input: SaveSupplierInput): Promise<SaveResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "forbidden" };
  try {
    const supabase = await db();
    const { data: existing } = await supabase.from("hotel_suppliers").select("*").eq("code", input.code).maybeSingle();
    if (!existing) return { ok: false, error: "notFound" };
    const row = existing as HotelSupplierRow;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.environment !== undefined) patch.environment = input.environment;
    if (input.base_url !== undefined) patch.base_url = input.base_url;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.default_markup_rule_id !== undefined) patch.default_markup_rule_id = input.default_markup_rule_id || null;

    const replacingCreds = Boolean(input.username && input.password);
    if (replacingCreds) {
      patch.credentials_encrypted = encryptJson({
        base_url: (input.base_url ?? row.base_url) || "",
        username: input.username,
        password: input.password,
      });
    }

    const { error } = await supabase.from("hotel_suppliers").update(patch).eq("code", input.code);
    if (error) return { ok: false, error: "updateFailed" };

    await logAudit({
      action: replacingCreds ? "supplier.credentials_changed" : "supplier.updated",
      entity: "hotel_suppliers",
      entity_id: input.code,
      meta: {
        // NEVER the credential values — only which non-secret fields changed.
        fields: Object.keys(patch).filter((k) => k !== "credentials_encrypted" && k !== "updated_at"),
        credentials_changed: replacingCreds,
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "db" };
  }
}

/** Admin: real server-side auth + sample search. Updates last-sync status. */
export async function testSupplierConnection(code: string): Promise<TestConnectionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const adapter = await getSupplierAdapter(code);
  if (!adapter) return { ok: false, message: "المزوّد غير موجود." };

  let result: TestConnectionResult;
  try {
    result = await adapter.testConnection();
  } catch {
    // Never surface a raw supplier error/endpoint to the browser.
    result = { ok: false, message: "تعذّر الاتصال بخدمة المزوّد. تحقّق من بيانات الاعتماد." };
  }

  try {
    const supabase = await db();
    await supabase
      .from("hotel_suppliers")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: result.ok ? "ok" : "error",
        last_error: result.ok ? null : result.message,
      })
      .eq("code", code);
    await logAudit({ action: "supplier.test_connection", entity: "hotel_suppliers", entity_id: code, meta: { ok: result.ok } });
  } catch {
    /* status update is best-effort */
  }
  return result;
}

// ------------------------------------------------------------ «تجربة البحث» ----

/** One supplier call as the test screen shows it — its verdict only, never a body or a header. */
export type SearchTryCall = {
  method: string;
  ok: boolean;
  http: number | null;
  /** the supplier's Status.Code (TBO answers HTTP 200 and puts the verdict here). */
  code: number | null;
  description: string | null;
  ms: number;
  /** how many rows the call returned (cities, hotel codes, hotels). */
  count: number | null;
  /** no answer within our time limit — the supplier was slow, the address is fine. */
  timeout: boolean;
};

function callView(c: SupplierCallRecord): SearchTryCall {
  const body = (c.response && typeof c.response === "object" ? c.response : {}) as Record<string, unknown>;
  const status = body.Status as { Description?: unknown } | undefined;
  const list = Object.values(body).find(Array.isArray) as unknown[] | undefined;
  return {
    method: c.method,
    // 201 on Search is TBO's «no rooms for these criteria» — an answer, not a refusal
    ok: c.ok || (c.method.toLowerCase() === "search" && c.status_code === 201),
    http: c.http_status,
    code: c.status_code,
    description: typeof status?.Description === "string" ? status.Description : typeof body.error === "string" ? body.error : null,
    ms: c.duration_ms,
    count: list ? list.length : null,
    timeout: body.timeout === true,
  };
}

/** The adapter for a test — logged, and refused when it would silently be the mock. */
async function testAdapter(code: string, sink: SupplierCallRecord[]) {
  const adapter = await getSupplierAdapterLogged(code, sink);
  return adapter && adapter.code === code ? adapter : null;
}

const NO_CREDS = "لا توجد بيانات اعتماد محفوظة لهذا المورّد — احفظها في «ربط مزوّدي الفنادق» أولاً.";

export type CitiesTryResult =
  | { ok: true; cities: { code: string; name: string }[] }
  | { ok: false; message: string; calls: SearchTryCall[] };

/** Admin: the supplier's own cities of a country, to search one of them exactly. */
export async function trySupplierCities(code: string, countryCode: string): Promise<CitiesTryResult> {
  if (!(await requireAdmin())) return { ok: false, message: "غير مصرّح لك بهذا الإجراء.", calls: [] };
  const sink: SupplierCallRecord[] = [];
  const adapter = await testAdapter(code, sink);
  if (!adapter?.listCities) return { ok: false, message: NO_CREDS, calls: [] };
  const cities = await adapter.listCities(countryCode);
  if (!cities) {
    // nothing was sent: the row itself is not usable (sandbox with no URL, half the credentials) — say which
    if (sink.length === 0) return { ok: false, message: (await adapter.testConnection()).message, calls: [] };
    return { ok: false, message: "لم يُرجع المورّد قائمة المدن.", calls: sink.map(callView) };
  }
  return { ok: true, cities: cities.sort((a, b) => a.name.localeCompare(b.name)) };
}

export type SearchTryInput = {
  code: string;
  country_code: string;
  /** Arabic — what the markup rules are written against. */
  country_name: string;
  /** the supplier's own spelling, from trySupplierCities. */
  city: string;
  check_in: string;
  check_out: string;
  rooms: number;
  /** per room */
  adults: number;
  /** per room */
  children: number;
  children_ages: number[];
  nationality: string;
  hotel_name: string;
};

export type SearchTryRate = {
  room: string;
  board: string;
  refundable: boolean;
  policy: string;
  /** what the supplier charges us, whole stay — null without pricing.internal. */
  net: number | null;
  currency: string;
  /** our price by the markup rules, whole stay in SAR; null = no rule or no exchange rate. */
  sell: number | null;
  /** the rules refuse this sell (below the floor or the minimum margin), as /basic marks it. */
  blocked: boolean;
};

export type SearchTryHotel = { id: string; name: string; stars: number | null; rates: SearchTryRate[] };

export type SearchTryResult =
  | { ok: true; hotels: SearchTryHotel[]; calls: SearchTryCall[]; nights: number }
  | { ok: false; message: string; calls: SearchTryCall[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A whole number from the browser, kept inside [min, max]; anything else is `fallback`. */
function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * The catalogue's Arabic name for a supplier's city — what the markup rules and
 * the drafts are written in, so the sell shown here is the one /basic would get.
 */
async function catalogCity(iso2: string, english: string): Promise<string | null> {
  try {
    const supabase = db();
    const { data: country } = await supabase.from("countries").select("id").ilike("iso2", iso2).maybeSingle();
    if (!country) return null;
    const { data } = await supabase.from("cities").select("arabic_name, english_name").eq("country_id", (country as { id: string }).id);
    const wanted = english.trim().toLowerCase();
    return ((data ?? []) as { arabic_name: string; english_name: string | null }[]).find((c) => (c.english_name ?? "").trim().toLowerCase() === wanted)?.arabic_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Admin: a real availability search at the supplier, run from inside the system.
 * Read-only — no PreBook, no Book. Shows the net, our sell by the markup rules,
 * and every call's verdict, so a refusal reads as the supplier's own words.
 */
export async function trySupplierSearch(input: SearchTryInput): Promise<SearchTryResult> {
  if (!(await requireAdmin())) return { ok: false, message: "غير مصرّح لك بهذا الإجراء.", calls: [] };
  if (!ISO_DATE.test(input.check_in) || !ISO_DATE.test(input.check_out) || input.check_out <= input.check_in) {
    return { ok: false, message: "تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول.", calls: [] };
  }
  if (!input.city.trim() || !/^[A-Za-z]{2}$/.test(input.country_code)) {
    return { ok: false, message: "اختر الدولة والمدينة.", calls: [] };
  }
  const sink: SupplierCallRecord[] = [];
  const adapter = await testAdapter(input.code, sink);
  if (!adapter) return { ok: false, message: NO_CREDS, calls: [] };

  const nights = Math.round((Date.parse(input.check_out) - Date.parse(input.check_in)) / 86_400_000);
  // the form asks per room; the adapter takes the whole party and shares it out
  const rooms = int(input.rooms, 1, 4, 1);
  const adults = int(input.adults, 1, 8, 2);
  const children = int(input.children, 0, 4, 0);
  const ages = (Array.isArray(input.children_ages) ? input.children_ages : []).slice(0, children).map((a) => int(a, 0, 17, 8));
  while (ages.length < children) ages.push(8);
  const iso2 = input.country_code.toUpperCase();
  const [results, { sarPer }, rules, internal, city] = await Promise.all([
    adapter
      .searchHotels({
        city: input.city.trim(),
        country_code: iso2,
        check_in: input.check_in,
        check_out: input.check_out,
        rooms,
        adults: adults * rooms,
        children: children * rooms,
        children_ages: Array.from({ length: rooms }, () => ages).flat(),
        nationality: /^[A-Za-z]{2}$/.test(input.nationality) ? input.nationality.toUpperCase() : "SA",
        hotel_name: input.hotel_name.trim() || null,
      })
      .catch(() => []),
    // a price we cannot work out is shown as «بلا قاعدة تسعير», never as a lost search
    getRates().catch(() => ({ sarPer: {} as Record<string, number> })),
    getActiveMarkupRules().catch(() => []),
    currentCan("pricing.internal"),
    catalogCity(iso2, input.city),
  ]);
  const calls = sink.map(callView);

  // the name narrowed the city's list to nothing, so TBO was never asked for rooms
  const listed = sink.find((c) => c.method === "TBOHotelCodeList");
  if (input.hotel_name.trim() && listed?.ok && !sink.some((c) => c.method.toLowerCase() === "search")) {
    return { ok: false, message: "لا يوجد فندق بهذا الاسم في قائمة فنادق TBO لهذه المدينة — جرّب جزءاً من الاسم بالإنجليزية.", calls };
  }

  const fxDate = new Date().toISOString().slice(0, 10);
  const cheapest = (h: (typeof results)[number]) => Math.min(...h.rates.map((r) => r.inclusive));
  const hotels = [...results].sort((a, b) => cheapest(a) - cheapest(b)).map((h): SearchTryHotel => ({
    id: h.supplier_hotel_id,
    name: h.name_ar,
    stars: h.star_rating,
    rates: [...h.rates]
      .sort((a, b) => a.inclusive - b.inclusive)
      .map((r): SearchTryRate => {
        // the context /basic prices with (contextFor): the catalogue's city, no stars
        const priced = priceSupplierRate(
          r,
          rules,
          { country: input.country_name || null, city: city ?? input.city, supplier_id: r.supplier_id, stars: null, date: input.check_in, customer_type: "individual" },
          sarPer,
          "SAR",
          fxDate,
        );
        return {
          room: r.room_category_raw,
          board: r.board_type,
          refundable: r.refundable,
          policy: r.cancellation_policy,
          net: internal ? r.inclusive : null,
          currency: r.currency,
          sell: priced.ok ? priced.line.sell : null,
          blocked: priced.ok && priced.line.blocks.length > 0,
        };
      }),
  }));
  return { ok: true, hotels, calls, nights };
}
