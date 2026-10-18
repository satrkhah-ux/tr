"use server";

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { notifyPartnerRegistration } from "@/lib/data/ops-notify";
import {
  PARTNER_TERMS_VERSION,
  SAME_EMAIL_WINDOW_MS,
  allowAttempt,
  newReferenceNo,
  readRegistration,
} from "./registration-form";
import { getPartnerSession } from "./session";
import { loginName, passwordProblem } from "@/lib/auth/password-rule";
import { setTemporaryPassword } from "@/lib/auth/temp-password";

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

export type RegistrationResult = { ok: true; reference: string } | { ok: false; message: string };

/** Valid submissions per network origin — see allowAttempt for its ceiling. */
const attemptsByOrigin = new Map<string, number[]>();
const FAILED = "تعذّر إرسال الطلب. حاول مرة أخرى.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BUCKET = "partner-documents";

/**
 * The public form, as FormData — it carries the company's documents. Read and
 * checked by readRegistration (pure, tested); the documents go to the PRIVATE
 * bucket under the request's reference number, then the pending row is written
 * pointing at them. A failed insert takes its uploads back out.
 */
export async function registerPartnerCompany(form: FormData): Promise<RegistrationResult> {
  const read = readRegistration(form);
  if (!read.ok) return read;
  const input = read.value;
  const { name, email } = input;

  try {
    // Each valid submission can store 3×5MB and ping Telegram: cap it per origin
    // before anything is read or written.
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
    if (ip && !allowAttempt(attemptsByOrigin, ip, Date.now())) {
      return { ok: false, message: "وصلتنا طلبات كثيرة من هذا الجهاز. حاول مرة أخرى بعد ساعة." };
    }

    const supabase = db();

    // booking_partners already carries a unique index on lower(name); this check
    // exists to answer the company in words rather than with a database error,
    // and to say something useful when the name belongs to a live partner.
    // readRegistration refused every ilike wildcard, so this is an exact,
    // case-insensitive match — never a prefix probe. A failed lookup is a
    // failure, not a pass (it used to let junk rows through).
    const since = new Date(Date.now() - SAME_EMAIL_WINDOW_MS).toISOString();
    const [byName, byEmail] = await Promise.all([
      supabase.from("booking_partners").select("status").ilike("name", name).limit(1),
      supabase.from("booking_partners").select("id").eq("email", email).gte("created_at", since).limit(1),
    ]);
    if (byName.error || byEmail.error) return { ok: false, message: FAILED };
    if ((byEmail.data ?? []).length > 0) {
      return { ok: false, message: "وصلنا طلب بهذا البريد قبل قليل وهو قيد المراجعة." };
    }
    const clash = (byName.data ?? [])[0];
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

    const reference = newReferenceNo(new Date());
    const documents: { kind: string; path: string; name: string; size: number; type: string }[] = [];
    for (const doc of input.documents) {
      const path = `${reference}/${doc.kind}.${doc.ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, doc.file, { contentType: doc.file.type, upsert: false });
      if (upErr) {
        if (documents.length) await supabase.storage.from(BUCKET).remove(documents.map((d) => d.path));
        return { ok: false, message: "تعذّر رفع المستندات. حاول مرة أخرى." };
      }
      documents.push({ kind: doc.kind, path, name: doc.file.name, size: doc.file.size, type: doc.file.type });
    }

    const { error } = await supabase.from("booking_partners").insert({
      name,
      name_latin: input.name_latin,
      contact_email: email,
      email,
      phone: input.phone,
      contact_name: input.contact_name,
      website: input.website,
      address: input.address,
      registration_note: input.note,
      commercial_register: input.commercial_register,
      tourism_license: input.tourism_license,
      vat_number: input.vat_number,
      city: input.city,
      country: input.country,
      terms_accepted_at: new Date().toISOString(),
      terms_version: PARTNER_TERMS_VERSION,
      reference_no: reference,
      documents,
      // Everything commercial stays at its default until an employee decides it.
      status: "pending",
      // A pending company is not a supplier we assign work to, and not a
      // reseller whose brand may be printed — both wait for approval.
      active: false,
      resells: false,
      kinds: ["reseller"],
    });
    if (error) {
      if (documents.length) await supabase.storage.from(BUCKET).remove(documents.map((d) => d.path));
      return { ok: false, message: "تعذّر إرسال الطلب. حاول مرة أخرى." };
    }

    // Nobody watches a table. Tell the office a request arrived.
    await notifyPartnerRegistration({ name, email, phone: input.phone });
    return { ok: true, reference };
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

    const made = await inviteToCompany(supabase, row, email, input.name ?? null, "owner", await getCurrentEmployeeId());
    if (!made.ok) return made;

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

/**
 * Send a fresh password link to a company that already has an account.
 *
 * An invitation is single-use, so «هذا البريد مُصدر له حساب بالفعل» used to be a
 * dead end: the company had lost or never finished the first link and there was
 * no way to give them another. This is the way out, and it is the only one an
 * employee needs — we still never see or set the password.
 *
 * A RECOVERY link rather than a second invitation: the account exists, so this
 * is a reset, and Supabase refuses to re-invite an existing user anyway.
 */
export async function resendPartnerPasswordLink(input: {
  partner_id: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, message: "البريد الإلكتروني غير صحيح." };

  try {
    const supabase = db();

    // Only for an account that belongs to THIS company. Without this check the
    // screen would become a way to send a password link to any address at all.
    const { data } = await supabase
      .from("partner_users")
      .select("id, status")
      .eq("partner_id", input.partner_id)
      .ilike("email", email)
      .maybeSingle();
    const account = data as { id: string; status: string } | null;
    if (!account) return { ok: false, message: "لا يوجد حساب بهذا البريد لهذه الشركة — أصدر حساباً أولاً." };
    if (account.status !== "active") return { ok: false, message: "هذا الحساب موقوف — فعّله قبل إرسال الرابط." };

    const site = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
    const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
    const anon = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
    if (!url || !anon) return { ok: false, message: "إعدادات الاتصال غير مكتملة على الخادم." };

    // The public recovery endpoint, deliberately: it is what sends the mail
    // through the configured SMTP. The admin API can only mint a link, which
    // would leave us holding a credential-equivalent and mailing it ourselves.
    //
    // The landing page rides in the QUERY STRING — this endpoint takes
    // redirect_to there, not in the body, and without it the link drops the
    // company on the site root instead of the page that sets a password.
    const recoverUrl = `${url}/auth/v1/recover?redirect_to=${encodeURIComponent(`${site}/b2b/welcome`)}`;
    const res = await fetch(recoverUrl, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        message: body.toLowerCase().includes("rate")
          ? "أُرسل رابط قبل قليل — انتظر دقيقة ثم أعد المحاولة."
          : "تعذّر إرسال الرابط — تأكد من إعدادات البريد لدى Supabase.",
      };
    }

    await logAudit({
      action: "partner.account_issued",
      entity: "booking_partners",
      entity_id: input.partner_id,
      meta: { email, kind: "password_link_resent", redirect: `${site}/b2b/welcome` },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر إرسال الرابط." };
  }
}

/**
 * A temporary password for the company's login, typed by the administration
 * (the owner, 2026-10-19: the last company to register never received the
 * set-your-password mail — «اجعل إمكانية عمل كلمة مرور من داخل النظام»).
 *
 * The account that exists (an invitation sent and never opened) gets the
 * password; a company with no login yet gets one made with it — no mail at all.
 * Either way the address is confirmed and the first sign-in forces a password
 * of the company's own. The value is never stored, returned or logged.
 */
export async function setPartnerPassword(input: {
  partner_id: string;
  email: string;
  password: string;
}): Promise<{ ok: true; created: boolean } | { ok: false; message: string }> {
  if (!(await currentCan("settings.manage"))) return { ok: false, message: "غير مصرّح لك بهذا الإجراء." };
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, message: "البريد الإلكتروني غير صحيح." };
  const password = String(input.password ?? "");
  const weak = passwordProblem(password, loginName(email));
  if (weak) return { ok: false, message: weak };

  try {
    const supabase = db();
    const { data: company } = await supabase.from("booking_partners").select("id, name, status").eq("id", input.partner_id).maybeSingle();
    const row = company as { id: string; name: string; status: string } | null;
    if (!row) return { ok: false, message: "الشركة غير موجودة." };
    if (row.status !== "approved") return { ok: false, message: "اعتمد الشركة أولاً ثم أصدر الحساب." };

    // Only a login of THIS company — else the screen would set the password of any account at all.
    const { data: linked } = await supabase
      .from("partner_users")
      .select("auth_user_id, status")
      .eq("partner_id", row.id)
      .ilike("email", email)
      .maybeSingle();
    const account = linked as { auth_user_id: string; status: string } | null;
    if (account) {
      if (account.status !== "active") return { ok: false, message: "هذا الحساب موقوف — فعّله قبل تعيين كلمة المرور." };
      if (!(await setTemporaryPassword(supabase, account.auth_user_id, password))) return { ok: false, message: "تعذّر تعيين كلمة المرور." };
      await logAudit({
        action: "partner.account_issued",
        entity: "booking_partners",
        entity_id: row.id,
        meta: { email, kind: "temp_password", must_change_password: true },
      });
      return { ok: true, created: false };
    }

    const made = await inviteToCompany(supabase, row, email, null, "owner", await getCurrentEmployeeId(), password);
    if (!made.ok) return made;
    await logAudit({
      action: "partner.account_issued",
      entity: "booking_partners",
      entity_id: row.id,
      meta: { email, kind: "temp_password_login", must_change_password: true },
    });
    return { ok: true, created: true };
  } catch {
    return { ok: false, message: "تعذّر تعيين كلمة المرور." };
  }
}

/**
 * Open one of an applicant's documents — staff only, a five-minute signed URL
 * from the private bucket, and only a path that row actually lists (a crafted
 * path cannot reach another company's file).
 */
export async function partnerDocumentUrl(partnerId: string, path: string): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!(await currentCan("data.write"))) return { ok: false, message: "لا تملك صلاحية." };
  try {
    const supabase = db();
    const { data } = await supabase.from("booking_partners").select("documents").eq("id", partnerId).maybeSingle();
    const listed = ((data as { documents: { path: string }[] } | null)?.documents ?? []).some((d) => d.path === path);
    if (!listed) return { ok: false, message: "المستند غير موجود." };
    const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    return error || !signed ? { ok: false, message: "تعذّر فتح المستند." } : { ok: true, url: signed.signedUrl };
  } catch {
    return { ok: false, message: "تعذّر فتح المستند." };
  }
}

/**
 * A login for a company — the one path, for our «إصدار حساب» and for the
 * company's own owner inviting a colleague. Supabase sends a set-your-password
 * link; no password is ever generated, stored or sent here — except the
 * administration's temporary one (`password`, setPartnerPassword): then the
 * account is made with it, confirmed, no mail, and must change it at sign-in.
 */
async function inviteToCompany(
  supabase: SupabaseClient,
  company: { id: string; name: string },
  email: string,
  name: string | null,
  role: "owner" | "sales",
  createdBy: string | null,
  password?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
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
  const metadata = { partner_id: company.id, partner_name: company.name };
  const { data: invite, error: inviteError } = password
    ? await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata, app_metadata: { must_change_password: true } })
    : await supabase.auth.admin.inviteUserByEmail(email, { data: metadata, redirectTo: `${site}/b2b/welcome` });
  if (inviteError || !invite?.user) {
    if (password && inviteError?.message.toLowerCase().includes("already")) {
      return { ok: false, message: "لهذا البريد حساب دخول ليس لهذه الشركة — استخدم بريداً آخر." };
    }
    return { ok: false, message: password ? "تعذّر إنشاء الحساب." : "تعذّر إنشاء الحساب — تأكد من إعدادات البريد لدى Supabase." };
  }

  const { error } = await supabase.from("partner_users").insert({
    partner_id: company.id,
    auth_user_id: invite.user.id,
    email,
    name: name?.trim() || null,
    role,
    created_by: createdBy,
  });
  if (error && password) {
    // a login with a known password that belongs to no company is worse than none
    await supabase.auth.admin.deleteUser(invite.user.id);
    return { ok: false, message: "تعذّر ربط الحساب بالشركة." };
  }
  return error ? { ok: false, message: "أُنشئ الحساب ولم يُربط بالشركة — راجع السجل." } : { ok: true };
}

export type TeamMember = { id: string; email: string; name: string | null; role: "owner" | "sales"; status: string; me: boolean };

/** The company's logins — its owner's to see (partner_users shows a partner only its own row, so the service role reads them by the session's company). */
export async function listMyTeam(): Promise<TeamMember[]> {
  const partner = await getPartnerSession();
  if (!partner || partner.role !== "owner") return [];
  try {
    const { data } = await db()
      .from("partner_users")
      .select("id, email, name, role, status, auth_user_id")
      .eq("partner_id", partner.partner_id)
      .order("created_at");
    return ((data ?? []) as { id: string; email: string; name: string | null; role: string; status: string; auth_user_id: string }[]).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role === "sales" ? "sales" : "owner",
      status: u.status,
      me: u.auth_user_id === partner.user_id,
    }));
  } catch {
    return [];
  }
}

/** The owner invites a colleague to its own company — never another's. */
export async function invitePartnerUser(input: { email: string; name?: string; role: "owner" | "sales" }): Promise<{ ok: true } | { ok: false; message: string }> {
  const partner = await getPartnerSession();
  if (!partner || partner.role !== "owner") return { ok: false, message: "إضافة المستخدمين لمدير حساب الشركة." };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, message: "البريد الإلكتروني غير صحيح." };
  try {
    const made = await inviteToCompany(db(), { id: partner.partner_id, name: partner.partner_name }, email, input.name ?? null, input.role === "owner" ? "owner" : "sales", null);
    if (!made.ok) return made;
    await logAudit({ action: "partner.account_issued", entity: "booking_partners", entity_id: partner.partner_id, meta: { email, role: input.role, by: partner.email } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر إرسال الدعوة." };
  }
}

/** The owner stops or restores a colleague's login (never its own); the company stays open. */
export async function setPartnerUserActive(userId: string, active: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const partner = await getPartnerSession();
  if (!partner || partner.role !== "owner") return { ok: false, message: "لمدير حساب الشركة فقط." };
  try {
    const { data, error } = await db()
      .from("partner_users")
      .update({ status: active ? "active" : "suspended" })
      .eq("id", userId)
      .eq("partner_id", partner.partner_id)
      .neq("auth_user_id", partner.user_id)
      .select("id");
    if (error || !data || data.length === 0) return { ok: false, message: "تعذّر الحفظ." };
    await logAudit({ action: "partner.updated", entity: "booking_partners", entity_id: partner.partner_id, meta: { user: userId, user_active: active, by: partner.email } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}
