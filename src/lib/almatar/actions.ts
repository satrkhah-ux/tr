"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { db, getAlmatarCompany, getAlmatarSession, getMarginPct } from "./server";
import { bookingProblem, cancelFeePct, loginEmail, passwordProblem, profitOf, serviceInstant, unitPrice, type Vehicle } from "./rules";

type Result = { ok: true; message?: string } | { ok: false; message: string };

const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

// ----------------------------------------------------------------- Almatar ----

export type NewBooking = {
  service_id: string;
  vehicle: string;
  units: number;
  date: string;
  time: string;
  passengers: number;
  lead_name: string;
  lead_phone?: string;
  flight_no?: string;
  pickup?: string;
  dropoff?: string;
  notes?: string;
};

/** Almatar books a line of its list. Price and profit are computed here, never taken from the form. */
export async function createAlmatarBooking(input: NewBooking): Promise<Result> {
  const session = await getAlmatarSession();
  if (!session) return { ok: false, message: "انتهت الجلسة — سجّل الدخول مجدداً." };
  try {
    const { data } = await db()
      .from("almatar_services")
      .select("id, tz, price_small, price_medium, price_van10, valid_through")
      .eq("id", String(input.service_id))
      .eq("active", true)
      .maybeSingle();
    const service = data as { id: string; tz: string; price_small: number; price_medium: number; price_van10: number; valid_through: string } | null;
    if (!service) return { ok: false, message: "اختر خدمة من القائمة." };

    const form = {
      vehicle: String(input.vehicle),
      units: Number(input.units),
      date: String(input.date),
      time: String(input.time),
      passengers: Number(input.passengers),
      lead_name: String(input.lead_name ?? "").slice(0, 120),
    };
    const problem = bookingProblem(service, form, new Date());
    if (problem) return { ok: false, message: problem };

    const unit = unitPrice(service, form.vehicle as Vehicle);
    const total = unit * form.units;
    const margin = await getMarginPct();
    const { data: made, error } = await db()
      .from("almatar_bookings")
      .insert({
        partner_id: session.partner_id,
        service_id: service.id,
        vehicle: form.vehicle,
        units: form.units,
        service_date: form.date,
        service_time: form.time.slice(0, 5),
        service_at: serviceInstant(form.date, form.time, service.tz).toISOString(),
        passengers: form.passengers,
        lead_name: form.lead_name.trim(),
        lead_phone: clean(input.lead_phone, 40),
        flight_no: clean(input.flight_no, 40),
        pickup: clean(input.pickup),
        dropoff: clean(input.dropoff),
        notes: clean(input.notes, 1000),
        unit_price: unit,
        total_sar: total,
        margin_pct: margin,
        profit_sar: profitOf(total, margin),
        created_by: session.user_id,
      })
      .select("id, ref")
      .single();
    if (error || !made) return { ok: false, message: "تعذّر حفظ الحجز." };
    const row = made as { id: string; ref: string };
    await logAudit({ action: "almatar.booking_changed", entity: "almatar_bookings", entity_id: row.id, meta: { ref: row.ref, status: "pending", by: "partner" } });
    revalidatePath("/b2b");
    return { ok: true, message: `أُرسل الحجز ${row.ref} — بانتظار تأكيد ترافليون.` };
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

// ------------------------------------------------------------------- staff ----

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
  if (!company) return { ok: false, message: "شركة المطار غير موجودة — طبّق المهاجرة 0099 أولاً." };
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
