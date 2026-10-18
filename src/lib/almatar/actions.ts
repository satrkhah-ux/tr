"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { db, getAlmatarCompany, getAlmatarSession, getMarginPct } from "./server";
import { bookingProblem, cancelFeePct, loginEmail, MAX_LINES, passwordProblem, profitOf, REQUEST_KINDS, requestRefFor, serviceInstant, unitPrice, type Vehicle } from "./rules";

type Result = { ok: true; message?: string; request_ref?: string } | { ok: false; message: string };

const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

// ----------------------------------------------------------------- Almatar ----

export type RequestLine = {
  service_id: string;
  date: string;
  time: string;
  flight_no?: string;
  pickup?: string;
  dropoff?: string;
};

export type NewRequest = {
  kind: string;
  vehicle: string;
  units: number;
  passengers: number;
  lead_name: string;
  lead_phone?: string;
  notes?: string;
  lines: RequestLine[];
};

type ServiceRow = { id: string; tz: string; price_small: number; price_medium: number; price_van10: number; valid_through: string };

/**
 * Almatar books one REQUEST of several services (0101) — arrival, departure,
 * tours, transfers, a whole program. Every line is checked against the list's
 * rules; one bad line refuses the request, so nothing is half-booked. Prices and
 * profit are computed here, never taken from the form, and the rows go in as one
 * insert sharing request_ref.
 */
export async function createAlmatarRequest(input: NewRequest): Promise<Result> {
  const session = await getAlmatarSession();
  if (!session) return { ok: false, message: "انتهت الجلسة — سجّل الدخول مجدداً." };
  const kind = REQUEST_KINDS.some((k) => k.id === input.kind) ? input.kind : null;
  if (!kind) return { ok: false, message: "اختر نوع الحجز." };
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return { ok: false, message: "أضف خدمة واحدة على الأقل." };
  if (lines.length > MAX_LINES) return { ok: false, message: `الطلب الواحد حتى ${MAX_LINES} خدمة.` };
  try {
    const ids = [...new Set(lines.map((l) => String(l.service_id)))];
    const { data } = await db().from("almatar_services").select("id, tz, price_small, price_medium, price_van10, valid_through").in("id", ids).eq("active", true);
    const services = new Map(((data ?? []) as ServiceRow[]).map((s) => [s.id, s]));
    const shared = {
      vehicle: String(input.vehicle),
      units: Number(input.units),
      passengers: Number(input.passengers),
      lead_name: String(input.lead_name ?? "").slice(0, 120),
    };
    const now = new Date();
    const checked: { line: RequestLine; service: ServiceRow }[] = [];
    for (const [i, line] of lines.entries()) {
      const service = services.get(String(line.service_id));
      const at = `الخدمة ${i + 1}: `;
      if (!service) return { ok: false, message: `${at}اختر الخدمة من القائمة.` };
      const problem = bookingProblem(service, { ...shared, date: String(line.date), time: String(line.time) }, now);
      if (problem) return { ok: false, message: at + problem };
      checked.push({ line, service });
    }

    const margin = await getMarginPct();
    const requestRef = requestRefFor(new Date(), randomBytes(4));
    const rows = checked.map(({ line, service }) => {
      const unit = unitPrice(service, shared.vehicle as Vehicle);
      const total = unit * shared.units;
      return {
        partner_id: session.partner_id,
        request_ref: requestRef,
        request_kind: kind,
        service_id: service.id,
        vehicle: shared.vehicle,
        units: shared.units,
        service_date: String(line.date),
        service_time: String(line.time).slice(0, 5),
        service_at: serviceInstant(String(line.date), String(line.time), service.tz).toISOString(),
        passengers: shared.passengers,
        lead_name: shared.lead_name.trim(),
        lead_phone: clean(input.lead_phone, 40),
        flight_no: clean(line.flight_no, 40),
        pickup: clean(line.pickup),
        dropoff: clean(line.dropoff),
        notes: clean(input.notes, 1000),
        unit_price: unit,
        total_sar: total,
        margin_pct: margin,
        profit_sar: profitOf(total, margin),
        created_by: session.user_id,
      };
    });
    const { data: made, error } = await db().from("almatar_bookings").insert(rows).select("id, ref");
    if (error || !made?.length) return { ok: false, message: "تعذّر حفظ الحجز." };
    const refs = (made as { id: string; ref: string }[]).map((r) => r.ref);
    await logAudit({
      action: "almatar.booking_changed",
      entity: "almatar_bookings",
      entity_id: (made as { id: string }[])[0].id,
      meta: { request_ref: requestRef, refs, kind, status: "pending", by: "partner" },
    });
    revalidatePath("/b2b");
    return { ok: true, message: `أُرسل الطلب ${requestRef} (${refs.length} خدمة) — بانتظار تأكيد ترافليون.`, request_ref: requestRef };
  } catch {
    return { ok: false, message: "تعذّر حفظ الحجز." };
  }
}

/** Almatar cancels its own booking; inside 12 hours it costs the whole price (term 6). */
export async function cancelAlmatarBooking(id: string): Promise<Result> {
  const session = await getAlmatarSession();
  if (!session) return { ok: false, message: "انتهت الجلسة — سجّل الدخول مجدداً." };
  try {
    const { data } = await db()
      .from("almatar_bookings")
      .select("id, ref, status, service_at, total_sar")
      .eq("id", id)
      .eq("partner_id", session.partner_id)
      .maybeSingle();
    const b = data as { id: string; ref: string; status: string; service_at: string; total_sar: number } | null;
    if (!b) return { ok: false, message: "الحجز غير موجود." };
    if (b.status !== "pending" && b.status !== "confirmed") return { ok: false, message: "لا يمكن إلغاء هذا الحجز." };
    const now = new Date();
    if (new Date(b.service_at).getTime() <= now.getTime()) return { ok: false, message: "وقت الخدمة مضى." };
    const pct = cancelFeePct(new Date(b.service_at), now);
    const { error } = await db()
      .from("almatar_bookings")
      .update({ status: "cancelled", cancelled_at: now.toISOString(), cancel_fee_pct: pct, cancel_fee_sar: (Number(b.total_sar) * pct) / 100 })
      .eq("id", b.id)
      .in("status", ["pending", "confirmed"]);
    if (error) return { ok: false, message: "تعذّر الإلغاء." };
    await logAudit({ action: "almatar.booking_changed", entity: "almatar_bookings", entity_id: b.id, meta: { ref: b.ref, status: "cancelled", fee_pct: pct, by: "partner" } });
    revalidatePath("/b2b");
    return { ok: true, message: pct ? `أُلغي الحجز ${b.ref} — رسوم الإلغاء 100%.` : `أُلغي الحجز ${b.ref} دون رسوم.` };
  } catch {
    return { ok: false, message: "تعذّر الإلغاء." };
  }
}

/** «مخاطبة المورد»: Almatar writes to us (0102). */
export async function sendAlmatarMessage(body: string, requestRef?: string): Promise<Result> {
  const session = await getAlmatarSession();
  if (!session) return { ok: false, message: "انتهت الجلسة — سجّل الدخول مجدداً." };
  const text = clean(body, 2000);
  if (!text) return { ok: false, message: "اكتب الرسالة." };
  const { error } = await db()
    .from("almatar_messages")
    .insert({ partner_id: session.partner_id, sender: "partner", body: text, request_ref: clean(requestRef, 40), author_user: session.user_id });
  if (error) return { ok: false, message: "تعذّر الإرسال." };
  revalidatePath("/b2b");
  return { ok: true };
}

// ------------------------------------------------------------------- staff ----

/** Our answer in Almatar's thread. */
export async function replyAlmatarMessage(body: string): Promise<Result> {
  if (!(await currentCan("operations.write")) && !(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const text = clean(body, 2000);
  if (!text) return { ok: false, message: "اكتب الرد." };
  const company = await getAlmatarCompany();
  if (!company) return { ok: false, message: "شركة المطار غير موجودة." };
  const { error } = await db()
    .from("almatar_messages")
    .insert({ partner_id: company.id, sender: "staff", body: text, author_employee: await getCurrentEmployeeId() });
  if (error) return { ok: false, message: "تعذّر الإرسال." };
  revalidatePath("/almatar-bookings");
  return { ok: true };
}

/** Confirm a pending booking: what the voucher prints (driver, car, phone) and its link. */
export async function confirmAlmatarBooking(id: string, driverInfo: string): Promise<Result> {
  if (!(await currentCan("operations.write"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  try {
    const { data, error } = await db()
      .from("almatar_bookings")
      .update({
        status: "confirmed",
        driver_info: clean(driverInfo, 500),
        voucher_token: randomBytes(24).toString("base64url"),
        confirmed_by: await getCurrentEmployeeId(),
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("ref")
      .maybeSingle();
    if (error || !data) return { ok: false, message: "الحجز ليس بانتظار التأكيد." };
    await logAudit({ action: "almatar.booking_changed", entity: "almatar_bookings", entity_id: id, meta: { ref: (data as { ref: string }).ref, status: "confirmed" } });
    revalidatePath("/almatar-bookings");
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر التأكيد." };
  }
}

export async function rejectAlmatarBooking(id: string, note: string): Promise<Result> {
  if (!(await currentCan("operations.write"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const reason = clean(note, 500);
  if (!reason) return { ok: false, message: "اكتب سبب الرفض — يظهر للمطار." };
  try {
    const { data, error } = await db()
      .from("almatar_bookings")
      .update({ status: "rejected", status_note: reason })
      .eq("id", id)
      .eq("status", "pending")
      .select("ref")
      .maybeSingle();
    if (error || !data) return { ok: false, message: "الحجز ليس بانتظار التأكيد." };
    await logAudit({ action: "almatar.booking_changed", entity: "almatar_bookings", entity_id: id, meta: { ref: (data as { ref: string }).ref, status: "rejected" } });
    revalidatePath("/almatar-bookings");
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الرفض." };
  }
}

/** Our margin inside Almatar's prices — new bookings only; a taken booking keeps its own. */
export async function setAlmatarMargin(pct: number): Promise<Result> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const value = Number(pct);
  if (!Number.isFinite(value) || value < 0 || value >= 100) return { ok: false, message: "النسبة بين 0 و 99." };
  try {
    const before = await getMarginPct();
    const { error } = await db()
      .from("almatar_settings")
      .update({ margin_pct: value, updated_by: await getCurrentEmployeeId(), updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) return { ok: false, message: "تعذّر الحفظ." };
    await logAudit({ action: "almatar.margin_changed", entity: "almatar_settings", entity_id: "almatar", meta: { from: before, to: value } });
    revalidatePath("/almatar-bookings");
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}

/**
 * A login for Almatar by USERNAME, with the temporary password the employee
 * types — never generated, stored or logged here. The account must change it
 * at its first page load (app_metadata.must_change_password, the root layout's
 * forced dialog), and can change it any time after from the portal.
 */
export async function createAlmatarLogin(input: { username: string; password: string }): Promise<Result> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const username = String(input.username ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return { ok: false, message: "اسم المستخدم حروف إنجليزية وأرقام فقط." };
  const password = String(input.password ?? "");
  const weak = passwordProblem(password, username);
  if (weak) return { ok: false, message: weak };

  const company = await getAlmatarCompany();
  if (!company) return { ok: false, message: "شركة المطار غير موجودة — طبّق المهاجرة 0100 أولاً." };
  const email = loginEmail(username);
  try {
    const admin = createSupabaseServiceClient();
    const { data: made, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // the proxy reads these to keep the login on /b2b (route-guard.ts); RLS does not trust them
      user_metadata: { partner_id: company.id, partner_portal: "transport", name: company.name },
      app_metadata: { must_change_password: true },
    });
    if (error || !made.user) {
      return { ok: false, message: error?.message.toLowerCase().includes("already") ? "اسم المستخدم مستخدم من قبل." : "تعذّر إنشاء الحساب." };
    }
    const { error: linkError } = await db()
      .from("partner_users")
      .insert({ partner_id: company.id, auth_user_id: made.user.id, email, name: company.name, role: "owner", created_by: await getCurrentEmployeeId() });
    if (linkError) {
      // a login that belongs to no company is worse than none
      await admin.auth.admin.deleteUser(made.user.id);
      return { ok: false, message: "تعذّر ربط الحساب بالشركة." };
    }
    await logAudit({ action: "partner.account_issued", entity: "booking_partners", entity_id: company.id, meta: { email, kind: "username_login", must_change_password: true } });
    revalidatePath("/almatar-bookings");
    return { ok: true, message: `أُنشئ الحساب «${username}» — سيُطلب منه تغيير كلمة المرور عند أول دخول.` };
  } catch {
    return { ok: false, message: "تعذّر إنشاء الحساب." };
  }
}
