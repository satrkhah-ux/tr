"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentSecretaryEmployee } from "@/lib/secretary/core";
import { currentCan } from "@/lib/roles/current";
import { notifyEmployee } from "@/lib/notifications/notify";
import { ensureCatalogHotel } from "./hotel-data-request";
import { updateRow } from "./actions";
import type { DataRow } from "./types";
import { cleanAdditionName, visibleAdditions, type AdditionKind, type AdditionStatus, type CatalogAddition } from "@/lib/catalog/additions";

/**
 * «إضافات الموظفين» — the doors. An employee adds (theirs at once, nothing
 * blocks them); the data team (settings.manage — data.write is every
 * salesperson's, hotel-data-to-admin) reviews, corrects and approves.
 * Service role behind each gate; the table is closed (20261029160000).
 */

const TABLE_MISSING = "42P01";
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const REVIEW_PATH = "/data-additions";

const ADDED_AR: Record<AdditionKind, string> = {
  country: "أُضيفت دولة جديدة",
  city: "أُضيفت مدينة جديدة",
  hotel: "أُضيف فندق جديد",
  room: "أُضيفت غرفة جديدة",
  view: "أُضيفت إطلالة جديدة",
};

async function tellDataTeam(row: { id: string; kind: AdditionKind; name: string }, by: string) {
  await notifyEmployee({
    permission: "settings.manage",
    kind: "data",
    title: `${ADDED_AR[row.kind]}: ${row.name}`,
    body: `أضافها ${by || "موظف"} أثناء البرنامج — راجع الاسم وصحّحه واعتمده لكل الموظفين`,
    href: REVIEW_PATH,
    source: "data",
    dedupeKey: `add:${row.id}`,
  });
}

async function insertAddition(input: {
  kind: AdditionKind;
  typed: string;
  name: string;
  refId?: string | null;
  countryId?: string | null;
  cityId?: string | null;
  employee: { id: string; name: string };
}): Promise<CatalogAddition | null> {
  const { data, error } = await db()
    .from("catalog_additions")
    .insert({
      kind: input.kind,
      typed_text: input.typed.slice(0, 200) || input.name,
      name: input.name,
      ref_id: input.refId ?? null,
      country_id: input.countryId ?? null,
      city_id: input.cityId ?? null,
      created_by: input.employee.id,
    })
    .select("id, kind, name, status, created_by")
    .single();
  // the table not applied yet: the employee's own pick still stands, unreviewed
  if (error || !data) return null;
  const row = data as CatalogAddition;
  await tellDataTeam(row, input.employee.name);
  return row;
}

/** The additions this employee sees in their lists: everyone's approved, their own pending. */
export async function getMyCatalogAdditions(): Promise<CatalogAddition[]> {
  const employee = await currentSecretaryEmployee();
  const { data, error } = await db()
    .from("catalog_additions")
    .select("id, kind, name, status, created_by")
    .in("kind", ["room", "view"])
    .neq("status", "rejected")
    .order("created_at")
    .limit(2000);
  if (error) return [];
  return visibleAdditions((data ?? []) as CatalogAddition[], employee?.id ?? null);
}

/** A room name or a view the catalogue does not have — the employee's own confirmed text. */
export async function addCatalogName(kind: "room" | "view", typed: string, confirmed: string): Promise<{ ok: boolean; name: string }> {
  const name = cleanAdditionName(confirmed);
  const employee = await currentSecretaryEmployee();
  if (!employee || !name) return { ok: false, name };
  // the same name already added (by anyone, not rejected): reuse it, no second review
  const { data: same } = await db().from("catalog_additions").select("id, name, status, created_by").eq("kind", kind).ilike("name", name).neq("status", "rejected").limit(1);
  if ((same ?? []).length) return { ok: true, name: (same as { name: string }[])[0].name };
  await insertAddition({ kind, typed, name, employee });
  return { ok: true, name };
}

/**
 * A hotel typed by the employee in a city: a /hotels row at once (found by
 * name first — ensureCatalogHotel), and, when it is new, the data team's.
 */
export async function addStaffHotel(input: { city: string; typed: string; name: string }): Promise<{ ok: true; hotel: { id: string; name: string } } | { ok: false }> {
  const name = cleanAdditionName(input.name);
  const employee = await currentSecretaryEmployee();
  if (!employee || !name || !input.city.trim()) return { ok: false };
  const supabase = db();
  const id = await ensureCatalogHotel(supabase, { name, city: input.city, by: employee.id, from: "typed" });
  if (!id) return { ok: false };
  const { data: hotel } = await supabase.from("hotels").select("id, arabic_name, city_id, country_id, created_at").eq("id", id).maybeSingle();
  const h = hotel as { id: string; arabic_name: string; city_id: string | null; country_id: string | null; created_at: string } | null;
  // made just now = new: reviewed by the data team; an existing namesake is just picked
  if (h && Date.now() - Date.parse(h.created_at) < 120_000) {
    await insertAddition({ kind: "hotel", typed: input.typed, name, refId: id, cityId: h.city_id, countryId: h.country_id, employee });
  }
  return { ok: true, hotel: { id, name: h?.arabic_name ?? name } };
}

/**
 * A country or a city made from the inline «أخرى» form (CatalogAddDialog) by
 * someone who is not the data team: on the review list too. Best-effort.
 */
export async function recordReferenceAddition(table: "countries" | "cities", row: DataRow): Promise<void> {
  try {
    if (await currentCan("settings.manage")) return;
    const employee = await currentSecretaryEmployee();
    const name = cleanAdditionName(String(row.arabic_name ?? ""));
    if (!employee || !name) return;
    await insertAddition({
      kind: table === "countries" ? "country" : "city",
      typed: name,
      name,
      refId: String(row.id),
      countryId: table === "cities" && row.country_id ? String(row.country_id) : table === "countries" ? String(row.id) : null,
      cityId: table === "cities" ? String(row.id) : null,
      employee,
    });
  } catch {
    /* the review list is a courtesy — the row exists either way */
  }
}

export type AdditionForReview = CatalogAddition & {
  typed_text: string;
  ref_id: string | null;
  author: string | null;
  country: string | null;
  city: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/** The data team's list: pending first, then the last decided. Null without the permission. */
export async function listCatalogAdditions(): Promise<{ rows: AdditionForReview[]; enabled: boolean } | null> {
  if (!(await currentCan("settings.manage"))) return null;
  const { data, error } = await db()
    .from("catalog_additions")
    .select("id, kind, name, typed_text, status, ref_id, created_by, created_at, reviewed_at, employees:created_by(arabic_name), countries(arabic_name), cities(arabic_name)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return { rows: [], enabled: (error as { code?: string }).code !== TABLE_MISSING };
  type Raw = Omit<AdditionForReview, "author" | "country" | "city"> & {
    employees: { arabic_name: string | null } | null;
    countries: { arabic_name: string | null } | null;
    cities: { arabic_name: string | null } | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map(({ employees, countries, cities, ...r }) => ({
    ...r,
    author: employees?.arabic_name ?? null,
    country: countries?.arabic_name ?? null,
    city: cities?.arabic_name ?? null,
  }));
  return { rows: [...rows.filter((r) => r.status === "pending"), ...rows.filter((r) => r.status !== "pending")], enabled: true };
}

/**
 * Approve (with the corrected name) or reject. A corrected hotel / city /
 * country is renamed through updateRow, so its own hooks run (a hotel's
 * waiting vouchers issue). A file that already used the old text keeps it.
 */
export async function reviewCatalogAddition(id: string, decision: { status: Exclude<AdditionStatus, "pending">; name?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "لا تملك صلاحية المراجعة" };
  const reviewer = await currentSecretaryEmployee();
  const supabase = db();
  const { data } = await supabase.from("catalog_additions").select("id, kind, name, ref_id").eq("id", id).maybeSingle();
  const row = data as { id: string; kind: AdditionKind; name: string; ref_id: string | null } | null;
  if (!row) return { ok: false, error: "الإضافة غير موجودة" };
  const name = decision.name ? cleanAdditionName(decision.name) : row.name;
  if (!name) return { ok: false, error: "اكتب الاسم" };
  if (decision.status === "approved" && name !== row.name && row.ref_id && row.kind !== "room" && row.kind !== "view") {
    const table = row.kind === "hotel" ? "hotels" : row.kind === "city" ? "cities" : "countries";
    const renamed = await updateRow(table, row.ref_id, { arabic_name: name });
    if (!renamed.ok) return { ok: false, error: "تعذّر تصحيح الاسم في الكتالوج" };
  }
  const { error } = await supabase
    .from("catalog_additions")
    .update({ status: decision.status, name, reviewed_by: reviewer?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: "تعذّر الحفظ" } : { ok: true };
}
