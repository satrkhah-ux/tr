"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { notifyPartnerRegistration } from "@/lib/data/ops-notify";

/**
 * A company asking to work with us, and what happens to that request.
 *
 * Registration writes through the SERVICE client rather than an anon policy.
 * Opening booking_partners to anonymous inserts would let anyone create rows —
 * and, worse, set their own brand colours and their own price adjustment before
 * a human ever looked at them. So the public form can only produce one thing: a
 * `pending` row carrying what they typed, with every commercial field left at
 * its default for an employee to decide.
 */

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

export type RegistrationResult = { ok: true } | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function registerPartnerCompany(input: {
  name: string;
  name_latin?: string;
  email: string;
  phone: string;
  website?: string;
  address?: string;
  contact_name?: string;
  note?: string;
}): Promise<RegistrationResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (name.length < 3) return { ok: false, message: "اسم الشركة مطلوب." };
  if (!EMAIL.test(email)) return { ok: false, message: "البريد الإلكتروني غير صحيح." };
  if (input.phone.replace(/\D/g, "").length < 8) return { ok: false, message: "رقم التواصل غير صحيح." };

  try {
    const supabase = db();

    // booking_partners already carries a unique index on lower(name); this check
    // exists to answer the company in words rather than with a database error,
    // and to say something useful when the name belongs to a live partner.
    const { data: clash } = await supabase
      .from("booking_partners")
      .select("id, status")
      .ilike("name", name)
      .maybeSingle();
    if (clash) {
      const row = clash as { status: string };
      return {
        ok: false,
        message:
          row.status === "pending"
            ? "طلب بهذا الاسم مسجّل وقيد المراجعة."
            : "هذا الاسم مسجّل لدينا. تواصل معنا إن كان يخصّ شركتك.",
      };
    }

    const { error } = await supabase.from("booking_partners").insert({
      name,
      name_latin: input.name_latin?.trim() || null,
      contact_email: email,
      email,
      phone: input.phone.trim(),
      contact_name: input.contact_name?.trim() || null,
      website: input.website?.trim() || null,
      address: input.address?.trim() || null,
      registration_note: input.note?.trim() || null,
      // Everything commercial stays at its default until an employee decides it.
      status: "pending",
      // A pending company is not a supplier we assign work to, and not a
      // reseller whose brand may be printed — both wait for approval.
      active: false,
      resells: false,
      kinds: ["reseller"],
    });
    if (error) return { ok: false, message: "تعذّر إرسال الطلب. حاول مرة أخرى." };

    // Nobody watches a table. Tell the office a request arrived.
    await notifyPartnerRegistration({ name, email, phone: input.phone.trim() });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر إرسال الطلب. حاول مرة أخرى." };
  }
}

export type ApprovalResult = { ok: true } | { ok: false; message: string };

/**
 * Approve a company and set its commercial terms — one deliberate act, recorded.
 *
 * The percentage is set HERE and nowhere else: a company can never influence
 * what it pays, because the only screen that writes this field is behind
 * `settings.manage`.
 */
export async function approvePartnerCompany(input: {
  id: string;
  price_adjust_kind: "markup" | "commission";
  price_adjust_pct: number;
  resells?: boolean;
}): Promise<ApprovalResult> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const pct = Number(input.price_adjust_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, message: "النسبة يجب أن تكون بين 0 و 100." };

  try {
    const employeeId = await getCurrentEmployeeId();
    const { error } = await db()
      .from("booking_partners")
      .update({
        status: "approved",
        active: true,
        resells: input.resells ?? true,
        price_adjust_kind: input.price_adjust_kind,
        price_adjust_pct: pct,
        approved_by: employeeId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { ok: false, message: "تعذّر الاعتماد." };

    await logAudit({
      action: "partner.approved",
      entity: "booking_partners",
      entity_id: input.id,
      meta: { price_adjust_kind: input.price_adjust_kind, price_adjust_pct: pct },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الاعتماد." };
  }
}

export async function setPartnerStatus(id: string, status: "rejected" | "suspended" | "approved"): Promise<ApprovalResult> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  try {
    const { error } = await db()
      .from("booking_partners")
      .update({ status, active: status === "approved" })
      .eq("id", id);
    if (error) return { ok: false, message: "تعذّر التحديث." };
    await logAudit({ action: "partner.status_changed", entity: "booking_partners", entity_id: id, meta: { status } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر التحديث." };
  }
}

/**
 * Issue the company a login.
 *
 * We create the account and send a set-your-password link. We do NOT generate a
 * password, do not put one in an email, and do not store one — the only person
 * who ever knows it is the person who chooses it.
 */
export async function issuePartnerAccount(input: {
  partner_id: string;
  email: string;
  name?: string;
}): Promise<{ ok: true; invited: boolean } | { ok: false; message: string }> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, message: "البريد الإلكتروني غير صحيح." };

  try {
    const supabase = db();

    const { data: company } = await supabase
      .from("booking_partners")
      .select("id, name, status")
      .eq("id", input.partner_id)
      .maybeSingle();
    const row = company as { id: string; name: string; status: string } | null;
    if (!row) return { ok: false, message: "الشركة غير موجودة." };
    // Order matters: an account for an unapproved company would be a login to a
    // portal with no terms behind it.
    if (row.status !== "approved") return { ok: false, message: "اعتمد الشركة أولاً ثم أصدر الحساب." };

    // An employee's address must never become a partner login — that account
    // would pass is_staff() and the partner policies at the same time.
    const { data: staff } = await supabase.from("employees").select("id").ilike("email", email).maybeSingle();
    if (staff) return { ok: false, message: "هذا البريد يخصّ موظفاً — استخدم بريداً آخر للشركة." };

    const { data: taken } = await supabase.from("partner_users").select("id").ilike("email", email).maybeSingle();
    if (taken) return { ok: false, message: "هذا البريد مُصدر له حساب بالفعل." };

    // WITHOUT redirectTo the invitation lands on the site root, which does
    // nothing at all: the account exists and there is no way to give it a
    // password. /b2b/welcome is the other half of this button.
    const site = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
    const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { partner_id: row.id, partner_name: row.name },
      redirectTo: `${site}/b2b/welcome`,
    });
    if (inviteError || !invite?.user) {
      return { ok: false, message: "تعذّر إنشاء الحساب — تأكد من إعدادات البريد لدى Supabase." };
    }

    const { error } = await supabase.from("partner_users").insert({
      partner_id: row.id,
      auth_user_id: invite.user.id,
      email,
      name: input.name?.trim() || null,
      created_by: await getCurrentEmployeeId(),
    });
    if (error) return { ok: false, message: "أُنشئ الحساب ولم يُربط بالشركة — راجع السجل." };

    await logAudit({
      action: "partner.account_issued",
      entity: "booking_partners",
      entity_id: row.id,
      // The address, never a credential.
      meta: { email },
    });
    return { ok: true, invited: true };
  } catch {
    return { ok: false, message: "تعذّر إصدار الحساب." };
  }
}
