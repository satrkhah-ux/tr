"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { isStaffSession } from "@/lib/partners/session";
import { mayWork, opsAccess, type OpsAccess } from "@/lib/operations/access";
import {
  clientQuery,
  CONFIRMED_TRIP,
  mergeClients,
  phoneForms,
  phoneKey,
  readExternalTrip,
  sameClientTrips,
  type ClientRecord,
  type ExternalStatus,
  type ExternalTripInput,
  type TripClient,
} from "@/lib/leads/lifecycle-rules";

/**
 * «نظام البكجات ← المؤكدون خارج النظام» (the user, 2026-10-22: «اضف امكانية
 * ادخال ربط لعميل قبل النظام… رقمه تاريخ السفر عدد الايام الوجهة الحالة و
 * المبلغ المدفوع ماذا تم تأكديه يكون الادخال سهل جدا و يكون غير مرتبط مع
 * البكجات»): a confirmed client from before the system, entered by hand, so
 * the work is counted here and the client's conversation is handled as a
 * traveller's (leads/lifecycle.ts). offers.write; whoever entered a trip owns it.
 */
type Result = { ok: true } | { ok: false; error: string };
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type ExternalTripRow = {
  id: string;
  phone: string;
  travel_start: string;
  days: number;
  destination: string;
  status: ExternalStatus;
  paid_amount: number | null;
  confirmed_items: string[];
  employee_id: string | null;
  employee_name: string | null;
  /** the client's name from what we already have (clientNames) — the trip itself keeps only the mobile */
  client_name: string | null;
  created_at: string;
};

export async function listExternalTrips(): Promise<{ rows: ExternalTripRow[]; me: string | null; admin: boolean } | null> {
  if (!(await currentCan("offers.write"))) return null;
  const [{ data }, me, admin] = await Promise.all([
    db().from("external_trips").select("id, phone, travel_start, days, destination, status, paid_amount, confirmed_items, employee_id, created_at, employees(arabic_name)").order("travel_start", { ascending: false }).limit(500),
    getCurrentEmployeeId(),
    currentCan("settings.manage"),
  ]);
  const raw = (data ?? []) as unknown as (Omit<ExternalTripRow, "employee_name" | "paid_amount" | "client_name"> & { paid_amount: string | number | null; employees: { arabic_name: string | null } | null })[];
  const names = await clientNames(raw.map((r) => r.phone));
  const rows = raw.map(({ employees, ...r }) => ({
    ...r,
    paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
    employee_name: employees?.arabic_name ?? null,
    client_name: names.get(phoneKey(r.phone) ?? "") ?? null,
  }));
  return { rows, me, admin };
}

// ---------- «العميل»: pulled from what we already have (the owner, 2026-10-29: «رقم الجوال لا يتم سحبه من النظام!») ----------

/**
 * Whose clients this employee may be shown: Teletel's conversations («العملاء») with clients.view, else only the ones
 * they took; Basic files and offers as Basic lists them to staff — a partner's never; an operations file's own dates
 * only where operations/access.ts lets them work it. Null: no lookup (not staff, or no offers.write).
 */
type Scope = { me: string | null; leadsAll: boolean; ops: OpsAccess | null };
async function clientScope(): Promise<Scope | null> {
  if (!(await currentCan("offers.write")) || !(await isStaffSession())) return null;
  const [me, leadsAll, ops] = await Promise.all([getCurrentEmployeeId(), currentCan("clients.view"), opsAccess()]);
  return { me, leadsAll, ops };
}

type Match = { digits: string } | { name: string } | { phones: string[] };
type RawLead = { phone: string; name: string | null; destination: string | null; assigned_to: string | null; received_by: string | null; created_at: string; last_visit_at: string | null };
type RawFile = { updated_at: string; created_by: string | null; phone: string | null; name: string | null; country: string | null; destination: string | null; start: string | null; days: string | null };
type RawOffer = { employee_id: string | null; partner_company_id: string | null; destination: string | null; duration: string | null; created_at: string; operations: { travel_start: string | null; travel_end: string | null; execution_status: string } | { travel_start: string | null; travel_end: string | null; execution_status: string }[] | null };
type RawCustomer = { arabic_name: string | null; english_name: string | null; mobile: string | null; second_mobile: string | null; offers: RawOffer[] | null };

const riyadhToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const daysOf = (start: string | null, end: string | null) => (start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : null);

/** The client's records in every table this employee may see: by a number's digits, a name, or exact mobiles. */
async function clientRecords(s: Scope, m: Match): Promise<ClientRecord[]> {
  // one or-filter per table: its mobile columns for a number, its name columns for a name
  const where = (phones: string[], names: string[]) =>
    "phones" in m
      ? phones.map((c) => `${c}.in.(${m.phones.map((p) => `"${p}"`).join(",")})`).join(",")
      : ("digits" in m ? phones : names).map((c) => `${c}.ilike.%${"digits" in m ? m.digits : m.name}%`).join(",");
  const limit = "phones" in m ? 1000 : 30;
  const sb = db();
  const [leads, files, customers] = await Promise.all([
    sb.from("client_leads").select("phone, name, destination, assigned_to, received_by, created_at, last_visit_at").or(where(["phone"], ["name"])).order("created_at", { ascending: false }).limit(limit),
    sb
      .from("offer_drafts")
      .select("updated_at, created_by, phone:data->customer->>customer_phone, name:data->customer->>customer_name, country:data->trip->>country, destination:data->trip->>destination, start:data->trip->>arrival_date, days:data->trip->>days")
      .is("partner_company_id", null)
      .or(where(["data->customer->>customer_phone"], ["data->customer->>customer_name"]))
      .order("updated_at", { ascending: false })
      .limit(limit),
    sb
      .from("customers")
      .select("arabic_name, english_name, mobile, second_mobile, offers!offers_customer_id_fkey(employee_id, partner_company_id, destination, duration, created_at, operations(travel_start, travel_end, execution_status))")
      .or(where(["mobile", "second_mobile"], ["arabic_name", "english_name"]))
      .limit(limit),
  ]);
  const mine = (id: string | null) => Boolean(s.me) && id === s.me;
  const out: ClientRecord[] = [];
  for (const l of (leads.data ?? []) as RawLead[]) {
    const own = mine(l.assigned_to) || mine(l.received_by);
    if (own || s.leadsAll) out.push({ phone: l.phone, name: l.name, destination: l.destination, travelStart: null, days: null, at: l.last_visit_at ?? l.created_at, mine: own, source: "lead" });
  }
  for (const f of (files.data ?? []) as RawFile[]) {
    out.push({ phone: f.phone, name: f.name, destination: f.destination || f.country, travelStart: f.start || null, days: Number(f.days) || null, at: f.updated_at, mine: mine(f.created_by), source: "file" });
  }
  for (const c of (customers.data ?? []) as unknown as RawCustomer[]) {
    const offers = (c.offers ?? []).filter((o) => !o.partner_company_id);
    if (c.offers?.length && !offers.length) continue; // a partner's client is the partner's
    const name = c.arabic_name || c.english_name;
    const phones = [c.mobile, c.second_mobile];
    if (!offers.length) for (const phone of phones) out.push({ phone, name, destination: null, travelStart: null, days: null, at: null, mine: false, source: "offer" });
    for (const o of offers) {
      const op = Array.isArray(o.operations) ? (o.operations[0] ?? null) : o.operations;
      const trip =
        op && op.execution_status !== "cancelled" && mayWork(s.ops, o.employee_id)
          ? { travelStart: op.travel_start, days: daysOf(op.travel_start, op.travel_end), source: "operation" as const }
          : // «8 أيام / 7 ليالي» — an offer has no travel date of its own
            { travelStart: null, days: Number(o.duration?.match(/\d+/)?.[0]) || null, source: "offer" as const };
      for (const phone of phones) out.push({ phone, name, destination: o.destination, ...trip, at: o.created_at, mine: mine(o.employee_id) });
    }
  }
  return out;
}

/**
 * Every trip entered here and every confirmed operations file, with their mobiles — what sameClientTrips warns of
 * (the same phones heldSale reads, leads/lifecycle.ts saleFacts).
 * ponytail: all of them per lookup (hundreds); a normalized phone column when they run to thousands.
 */
async function knownTrips() {
  const sb = db();
  const [ext, ops] = await Promise.all([
    sb.from("external_trips").select("id, phone, destination, travel_start").neq("status", "cancelled"),
    sb.from("operations").select("offers(serial, destination, customers!offers_customer_id_fkey(mobile, second_mobile))").in("client_status", CONFIRMED_TRIP).neq("execution_status", "cancelled"),
  ]);
  type RawOp = { offers: { serial: string | null; destination: string | null; customers: { mobile: string | null; second_mobile: string | null } | null } | null };
  return {
    trips: (ext.data ?? []) as { id: string; phone: string; destination: string; travel_start: string }[],
    files: ((ops.data ?? []) as unknown as RawOp[]).map(({ offers: o }) => ({ serial: o?.serial ?? null, destination: o?.destination ?? null, phones: [o?.customers?.mobile ?? null, o?.customers?.second_mobile ?? null] })),
  };
}

/**
 * «العميل» — a name or a number → the clients we already have, each once by its mobile, the employee's own first,
 * with the trip to pre-fill; and, for a whole number, what that mobile already has here or in operations.
 */
export async function findTripClients(query: string, editingId?: string): Promise<{ hits: TripClient[]; warnings: string[] }> {
  const q = clientQuery(query);
  const s = q ? await clientScope() : null;
  if (!q || !s) return { hits: [], warnings: [] };
  const [records, known] = await Promise.all([clientRecords(s, q), "digits" in q && phoneKey(query) ? knownTrips() : null]);
  return { hits: mergeClients(records, riyadhToday()), warnings: known ? sameClientTrips(query, known.trips, known.files, editingId) : [] };
}

/** each trip's client name by its mobile (phoneKey), from the same records the lookup reads */
async function clientNames(phones: string[]): Promise<Map<string, string>> {
  const forms = [...new Set(phones.flatMap(phoneForms))];
  const s = forms.length ? await clientScope() : null;
  if (!s) return new Map();
  // a few hundred mobiles per request — the filter rides in the URL
  const chunks = Array.from({ length: Math.ceil(forms.length / 150) }, (_, i) => forms.slice(i * 150, i * 150 + 150));
  const records = (await Promise.all(chunks.map((c) => clientRecords(s, { phones: c })))).flat();
  return new Map(mergeClients(records, riyadhToday(), Infinity).flatMap((c) => (c.name ? [[phoneKey(c.phone) ?? "", c.name] as const] : [])));
}

/** a new trip, or an edit of one's own (the administration edits any) */
export async function saveExternalTrip(input: ExternalTripInput & { id?: string }): Promise<Result> {
  if (!(await currentCan("offers.write"))) return { ok: false, error: "لا صلاحية" };
  const read = readExternalTrip(input);
  if (!read.ok) return read;
  const me = await getCurrentEmployeeId();
  const now = new Date().toISOString();
  if (input.id) {
    if (!(await mayChange(input.id, me))) return { ok: false, error: "تعدّل ما أدخلته أنت فقط" };
    const { error } = await db().from("external_trips").update({ ...read.row, updated_at: now }).eq("id", input.id);
    if (error) return { ok: false, error: "تعذّر الحفظ" };
    await logAudit({ action: "data.updated", entity: "external_trips", entity_id: input.id, meta: read.row });
    return { ok: true };
  }
  const { data, error } = await db().from("external_trips").insert({ ...read.row, employee_id: me }).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "data.created", entity: "external_trips", entity_id: (data as { id: string }).id, meta: read.row });
  return { ok: true };
}

export async function deleteExternalTrip(id: string): Promise<Result> {
  if (!(await currentCan("offers.write"))) return { ok: false, error: "لا صلاحية" };
  if (!(await mayChange(id, await getCurrentEmployeeId()))) return { ok: false, error: "تحذف ما أدخلته أنت فقط" };
  const { data: before } = await db().from("external_trips").select("phone, travel_start, destination, status").eq("id", id).maybeSingle();
  const { error } = await db().from("external_trips").delete().eq("id", id);
  if (error) return { ok: false, error: "تعذّر الحذف" };
  await logAudit({ action: "data.deleted", entity: "external_trips", entity_id: id, meta: { before } });
  return { ok: true };
}

async function mayChange(id: string, me: string | null): Promise<boolean> {
  if (await currentCan("settings.manage")) return true;
  const { data } = await db().from("external_trips").select("employee_id").eq("id", id).maybeSingle();
  return Boolean(me && (data as { employee_id: string | null } | null)?.employee_id === me);
}
