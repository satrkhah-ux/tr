// NOT "use server": as a server-actions module every export was callable from any
// signed-in browser — a partner could write a forged audit row, or read the log
// (who changed what, before and after). Server code imports it; nothing else can.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";

/**
 * The audit trail. Promoted out of suppliers.ts, where it was a file-private
 * helper that hardcoded `entity: "hotel_suppliers"` and never populated
 * `actor_id` — so the one table meant to answer "who did this" could only ever
 * answer it by email.
 *
 * Three deliberate differences from the original:
 *
 * 1. It takes NO supabase client. `audit_logs` is RLS-locked (0017), so a caller
 *    passing the ordinary user client writes nothing and the catch swallows it —
 *    silent audit loss is precisely the footgun to remove. This module builds
 *    the service client itself.
 * 2. `actor_id` is filled.
 * 3. The action vocabulary is a typed union, so a typo is a compile error rather
 *    than a row nobody will ever find again.
 */

export type AuditAction =
  // supplier vault (pre-existing)
  | "supplier.credentials_changed"
  | "supplier.updated"
  | "supplier.test_connection"
  // the generic data screens (actions.ts) and «الفندق المعتمد» — a record's change log
  | "data.created"
  | "data.updated"
  | "data.deleted"
  | "data.verified"
  | "data.unverified"
  // a hotel's data asked of the data team (hotel-data-request.ts; meta: reason, serial)
  | "data.requested"
  // «مراجعة الأسعار»: a price set or kept (meta: kind, label, before, after)
  | "price.reviewed"
  // operations
  | "operation.confirmed"
  | "operation.client_status"
  | "operation.execution_status"
  | "operation.cancelled"
  | "operation.issue"
  | "operation.rated"
  // «معالج الحجوزات»: «ينتظر» set or cleared on a step, and a manager's exception to «جاهز للسفر»'s payment rule
  | "operation.waiting"
  | "operation.ready_exception"
  | "payment.recorded"
  | "payment.updated"
  | "payment.deleted"
  | "payment.proof_viewed"
  | "payment.schedule_set"
  // «الحسابات»: an internal invoice checked and confirmed by the accounts team (accounts-actions.ts)
  | "invoice.confirmed"
  // «المصروفات»: a company expense recorded or removed by the accounts team (meta: category — never the amount)
  | "expense.recorded"
  // «الخصومات»: a coupon campaign made, a batch sent, a coupon used (meta: counts, the file it was used on)
  | "discounts.campaign_created"
  | "discounts.sent"
  | "discounts.redeemed"
  | "expense.deleted"
  | "payment.agreed_total_set"
  | "payment.agreement_set"
  | "payment.agreement_later"
  // the case itself: its owner, what the client page says, and the team's notes
  // (a note IS an audit row — locked to the service role, shown in the activity log)
  | "operation.assigned"
  | "operation.client_info"
  | "operation.note"
  | "booking.retimed"
  // passports — every one of these is a read of identity data
  | "passport.saved"
  | "passport.viewed"
  | "passport.scan_viewed"
  | "passport.decrypt_failed"
  | "passport.mrz_read"
  // the client's own uploads from the trip link, and staff's decision on each
  | "passport.client_uploaded"
  | "passport.client_reviewed"
  // travelers and their visas (0061)
  | "traveler.created"
  | "traveler.deleted"
  | "visa.updated"
  | "visa.file_viewed"
  // «ملفات التأشيرات» (visa-files): the file, who holds it, money received, the papers, and every read of identity data
  | "visa.file.created"
  | "visa.file.updated"
  | "visa.file.status"
  | "visa.file.assigned"
  | "visa.file.payment"
  | "visa.file.document"
  | "visa.file.doc_viewed"
  | "visa.file.passport.read"
  | "visa.file.passport.revealed"
  // execution
  | "booking.created"
  | "booking.confirmed"
  // a flight's ticket on file («معالج الحجوزات»): its PNR, ticket numbers and legs
  | "booking.ticketed"
  | "booking.cancelled"
  // logged BEFORE the row (and its cascaded vouchers) is gone
  | "booking.deleted"
  | "dispatch.sent"
  // a message to the client that WhatsApp held back (24 hours since they last wrote) — left as a Teletel note
  | "dispatch.held"
  // a MyFatoorah / Tamara link for a case (payment-links.ts): created, then sent on the employee's press
  | "payment_link.prepared"
  | "payment_link.client_opened"
  | "payment_link.paid_before_case"
  | "payment_link.sent"
  | "payment_link.failed"
  | "voucher.issued"
  | "voucher.revoked"
  // partner companies (identity + branding)
  | "partner.created"
  | "partner.updated"
  // sections, permissions and who is in them
  | "role.created"
  | "role.updated"
  | "role.deleted"
  | "employee.created"
  | "employee.updated"
  | "employee.role_changed"
  // «تنبيهاتي» (staff bot, 2026-10-22): the Telegram link, the Teletel agent, the test message, the bot's token
  | "employee.telegram_changed"
  | "employee.teletel_agent_changed"
  | "employee.telegram_test"
  | "bot.token_changed"
  | "bot.webhook_registered"
  // «تنبيهاتي» stage c: an employee's own Teletel token linked or refused, and every reply sent from the bot
  | "staff_bot.token_linked"
  | "staff_bot.token_refused"
  | "staff_bot.reply_sent"
  | "staff_bot.broadcast_sent"
  | "staff_bot.alert_sent"
  // «الخطاب الرسمي»: issued by the system, signed by the employee in the bot
  | "staff_letter.issued"
  | "staff_letter.signed"
  | "staff_letter.withdrawn"
  // presence (the owner, 2026-10-29): leaves, meetings, the status buttons' limits
  | "presence.leave_added"
  | "presence.leave_cancelled"
  | "presence.meeting_called"
  | "presence.meeting_ended"
  | "presence.limits_saved"
  | "presence.shift_saved"
  // «البدّالة»: a client moved by the sweep, or by hand, and its rules
  | "switchboard.moved"
  | "switchboard.reassigned"
  | "switchboard.rules_saved"
  // «القرارات الإدارية»: issued, acknowledged by a recipient, its settings
  | "admin_decision.issued"
  | "admin_decision.acknowledged"
  | "admin_decision.settings_saved"
  | "employee.extra_permissions"
  | "employee.deleted"
  // «عين الإدارة» — what it said, and what management did about it
  | "eye.report_sent"
  | "eye.note_acked"
  // «عين الإدارة» — what management actually reaches for. The bot reported for
  // days without recording a single interaction, so "which part do they use?"
  // had no answer at all. These four give it one.
  | "eye.opened"
  | "eye.report_requested"
  | "eye.notes_viewed"
  | "eye.asked"
  // the Mini App bridge — a bot with no webhook and no buttons, whose only act
  // IS the sign-in. auth.users.last_sign_in_at cannot tell a Mini App from a
  // browser, so without these two the bot had no measurable use at all.
  | "tg.signed_in"
  | "tg.linked"
  // supplier API bookings — the calls that move money
  | "supplier.prebooked"
  | "supplier.booked"
  | "supplier.cancelled"
  // the B2B portal: who let a company in, on what terms, and who gave it a login
  | "partner.approved"
  | "partner.status_changed"
  | "partner.account_issued"
  // «المطار» (0100): a transport booking taken, confirmed, refused or cancelled; the margin
  | "almatar.booking_changed"
  | "almatar.margin_changed"
  // staff logins — an employees row is a personnel record, the account is
  // separate, and who issued one is worth knowing
  | "employee.account_issued"
  | "employee.account_linked"
  // a new temporary password on a login already in use — every session ended (temp-password.ts)
  | "employee.password_reset"
  | "partner.password_reset"
  // staff self-registration: who asked, and who let them in (or didn't)
  | "staff_registration.submitted"
  | "staff_registration.approved"
  | "staff_registration.rejected"
  // the reference catalogue was exported/imported as a whole
  // managers changing what the system says or shows (guides, message templates)
  | "settings.updated"
  | "management.decision.created"
  | "management.decision.updated"
  // «قواعد مراد بين الموظفين» decided on /management-decisions (murad-staff-rules.ts)
  | "murad.staff_rules.saved"
  // «سكرتيري الخاص»: an employee asked their secretary / got the day plan (secretary/*)
  | "secretary.chat"
  | "secretary.plan_sent"
  // the administration opened an employee's secretary read-only (who, in meta)
  | "secretary.admin_view"
  // the secretary prepared a review-ready COPY of a file from the client's request (phase ب)
  | "secretary.file_prepared"
  // cheaper same-star proposals prepared beside the offer (phase ج; drafts in meta)
  | "secretary.suggested"
  // «قارن»: a price the employee read on a public site, typed by their hand into their proposal draft
  | "secretary.compare_applied"
  // «أرسل الخطأ لمُراد»: an error explained to the employee / reported once to the developers (cleaned message, page, action, time in meta)
  | "secretary.error_explained"
  | "secretary.error_reported"
  // «إشراف المتابعة»: a case opened / moved up the chain / closed on a real act, and every supervisor action (old/new/reason in meta)
  | "supervision.case_opened"
  | "supervision.case_escalated"
  | "supervision.case_closed"
  | "supervision.directed"
  | "supervision.rescheduled"
  | "supervision.reassigned"
  | "supervision.escalated"
  | "supervision.supervisors_saved"
  | "supervision.settings_saved"
  // «الحسابات المالية» saved (developer only; the figures stay out of the log)
  | "finance.saved"
  // «المفاتيح والتوكنات»: a key saved / replaced / cleared from «المطوّر» — the name only, never the value
  | "secrets.saved"
  | "secrets.cleared"
  | "catalog.imported"
  // «استعادة نسخة سابقة»: an older version's draft put back and issued as the next version
  | "offer.version_restored"
  // «إصدار نسخة محدّثة»: an issued offer's next version, from its corrected draft
  | "offer.reissued"
  // «مطوّر»: a system service switched off or on (/developer)
  | "feature.toggled"
  // the programme sent to its client by the employee («أرسل إلى العميل عبر واتساب», or «أرسلته يدوياً»)
  | "offer.client_sent"
  // Murad's «عرض آلي» taken over by the first colleague to answer the client (teletel-pull claimAutoFile)
  | "offer.claimed"
  // «إلغاء الملف» from Basic, before any booking or payment
  | "offer.cancelled"
  // Basic's «حذف» — the draft as it was kept in meta (file-status.ts deleteFiles)
  | "offer.deleted"
  // «SLA»: the rules' moves turned on or off (data/sla.ts setSlaApply)
  | "sla.rules_toggled"
  // «لا طلب بلا صاحب»: a client waiting on a shared Teletel login handed to a seller (routing/shared-sweep.ts)
  | "teletel.shared_reassigned"
  // «ربط الإضافة»: a device of the staff browser extension linked, or revoked (data/extension-links.ts)
  | "ext.linked"
  | "ext.revoked"
  // from the extension's client panel beside Teletel: the employee's own reminder and note on a conversation
  | "ext.reminder_set"
  | "ext.note_saved"
  | "draft.deleted";

export type AuditInput = {
  action: AuditAction;
  entity: string;
  entity_id: string;
  /** NON-SECRET context only. Never a passport number, never a credential. */
  meta?: Record<string, unknown>;
  /**
   * Who did it, when there is no web session to ask.
   *
   * A Telegram webhook has no cookie — the actor is resolved from the chat id
   * instead. Without this the bots' rows would all land with actor_id null,
   * which is an audit trail that records everything except who.
   */
  actor?: { id: string | null; label: string | null };
};

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

/**
 * Append one audit row. Returns whether it was written.
 *
 * Callers normally ignore the result — audit must not block the work it records.
 * The ONE exception is reading passport data, where the caller checks this
 * boolean and refuses to hand over the data if the trail could not be written.
 * "We can prove who read the passports" and "we think we can" are different
 * claims, and that check is the whole difference. It costs nothing real: the
 * audit insert and the passport read share one service client, so a failure here
 * means the database is unreachable anyway.
 */
export async function logAudit(input: AuditInput): Promise<boolean> {
  try {
    // An explicit actor short-circuits the session lookup entirely — a webhook
    // has no cookie to read, and asking anyway would cost a round trip to learn
    // nothing.
    const user = input.actor ? null : await getServerUser();
    const employeeId = input.actor ? input.actor.id : await getCurrentEmployeeId();
    const { error } = await db()
      .from("audit_logs")
      .insert({
        actor_id: employeeId,
        actor_email: input.actor ? input.actor.label : (user?.email ?? null),
        action: input.action,
        entity: input.entity,
        entity_id: input.entity_id,
        meta: input.meta ?? {},
      });
    return !error;
  } catch {
    return false;
  }
}

export type AuditEntry = {
  id: string;
  action: string;
  actor_email: string | null;
  entity: string;
  entity_id: string;
  meta: Record<string, unknown>;
  created_at: string;
};

/** The audit trail for ONE entity — powers the per-operation timeline. */
export async function listEntityAudit(entity: string, entityId: string, limit = 100): Promise<AuditEntry[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const { data } = await db()
      .from("audit_logs")
      .select("id, action, actor_email, entity, entity_id, meta, created_at")
      .eq("entity", entity)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as AuditEntry[];
  } catch {
    return [];
  }
}
