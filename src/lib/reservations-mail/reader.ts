import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { asSystem } from "@/lib/supabase/system-actor";
import { notifyOps } from "@/lib/data/ops-notify";
import { logAudit } from "@/lib/data/audit";
import { classify, type MailKind } from "./classify";
import { matchEmail, type MatchCandidate } from "./match";

/**
 * The reservations mailbox reader (the owner, 2026-10-26): supplier replies
 * arrive on reservations@traveliun.com (cPanel IMAP — not created yet; until
 * it exists /api/ops/mail answers not_configured and nothing runs).
 *
 * Read-only against the mailbox (BODY.PEEK — no flag ever changes; a human
 * still reads the same inbox), forward-only by uid (app_settings
 * reservations_mail_uid). Each new message is classified, matched against the
 * live hotel bookings and written once (unique message_uid); only a NEW row
 * raises the issue and the notice, so a rerun repeats nothing. NEVER sends
 * anything to a client and NEVER touches a voucher — a bad-news email only
 * marks the booking «الفوتشر قيد المراجعة» and tells the operations team.
 */

const service = (): SupabaseClient => createSupabaseServiceClient() as unknown as SupabaseClient;

const UID_KEY = "reservations_mail_uid";
const ENV_NAMES = ["RESERVATIONS_IMAP_HOST", "RESERVATIONS_IMAP_USER", "RESERVATIONS_IMAP_PASSWORD"] as const;

export function reservationsMailConfigured(): boolean {
  return ENV_NAMES.every((name) => Boolean(process.env[name]));
}

/** one parsed message, already free of mailparser — processMessage is testable without IMAP */
export type ParsedEmail = {
  uid: number;
  message_id: string | null;
  from: string | null;
  subject: string;
  text: string;
  received_at: string | null;
};

const KIND_AR: Record<MailKind, string> = {
  confirmation: "تأكيد حجز",
  hotel_change: "تغيير فندق",
  no_availability: "عدم توفر",
  cancellation: "إلغاء",
  other: "بريد مورّد",
};

/** the live hotel bookings an email could be about: non-cancelled cases only */
async function loadCandidates(db: SupabaseClient): Promise<MatchCandidate[]> {
  const { data } = await db
    .from("operation_bookings")
    .select("id, operation_id, title, confirmation_number, supplier_ref, client_reference, start_date, end_date, operations!inner(execution_status, offers(serial, customers(arabic_name)))")
    .eq("kind", "hotel")
    .neq("operations.execution_status", "cancelled")
    .limit(500);
  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  type Row = {
    id: string;
    operation_id: string;
    title: string | null;
    confirmation_number: string | null;
    supplier_ref: string | null;
    client_reference: string | null;
    start_date: string | null;
    end_date: string | null;
    operations: One<{ offers: One<{ serial: string | null; customers: One<{ arabic_name: string | null }> }> }>;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const offer = one(one(r.operations)?.offers ?? null);
    return {
      booking_id: r.id,
      operation_id: r.operation_id,
      confirmation_number: r.confirmation_number,
      supplier_ref: r.supplier_ref,
      // the booking's own reference, else the offer serial the supplier was quoted
      client_reference: r.client_reference ?? offer?.serial ?? null,
      hotel_title: r.title,
      guest_names: [one(offer?.customers ?? null)?.arabic_name ?? ""].filter(Boolean),
      check_in: r.start_date,
      check_out: r.end_date,
    };
  });
}

/** an issued, live voucher on the case — the one a bad-news email puts under review */
async function hasVoucher(db: SupabaseClient, operationId: string): Promise<boolean> {
  const { data } = await db.from("operation_documents").select("id").eq("operation_id", operationId).eq("kind", "hotel_voucher").is("revoked_at", null).limit(1);
  return Boolean(data?.length);
}

/**
 * One message: classify → match → write once. Exported for the tests and the
 * fixtures; the IMAP fetch below only feeds it. Returns what happened.
 */
export async function processMessage(mail: ParsedEmail): Promise<"linked" | "new" | "duplicate"> {
  const db = service();
  const { kind, refs } = await classify(mail.subject, mail.text);
  const match = matchEmail(refs, await loadCandidates(db));
  const { data: inserted } = await db
    .from("reservation_emails")
    .upsert(
      {
        message_uid: String(mail.uid),
        message_id: mail.message_id,
        received_at: mail.received_at,
        from_address: mail.from,
        subject: mail.subject.slice(0, 500),
        body_excerpt: mail.text.slice(0, 2000),
        kind,
        refs: refs as unknown as Record<string, unknown>,
        operation_id: match?.operation_id ?? null,
        booking_id: match?.booking_id ?? null,
        matched_by: match?.matched_by ?? null,
        status: match ? "linked" : "new",
      },
      { onConflict: "message_uid", ignoreDuplicates: true },
    )
    .select("id");
  // already read on an earlier run — none of the side effects repeat
  if (!inserted?.length) return "duplicate";
  if (!match) return "new";
  await raiseIssue(db, match.operation_id, match.booking_id, kind, mail);
  return "linked";
}

/** the issue, the notice, the audit line — and the voucher put under review on bad news */
async function raiseIssue(db: SupabaseClient, operationId: string, bookingId: string, kind: MailKind, mail: ParsedEmail): Promise<void> {
  const badNews = kind === "no_availability" || kind === "cancellation";
  const lines = [
    `📧 بريد مورّد (${KIND_AR[kind]}): ${mail.subject.slice(0, 200)} — من ${mail.from ?? "—"}`,
    // the house rule (client-send-review): prepare → review → a human presses the button
    ...(badNews ? ["الخطوة المقترحة: بديل / إعادة إصدار / إبلاغ العميل — تحضير ثم مراجعة ثم زر"] : []),
  ];
  await db.from("operation_issues").insert({ operation_id: operationId, description: lines.join("\n") });
  await notifyOps(lines[0], `/operations/${operationId}`);
  await logAudit({ action: "operation.issue", entity: "reservation_emails", entity_id: bookingId, meta: { kind, from: mail.from, subject: mail.subject.slice(0, 200) } });
  if (badNews && (await hasVoucher(db, operationId))) {
    const { data } = await db.from("operation_bookings").select("detail").eq("id", bookingId).maybeSingle();
    const detail = ((data as { detail: Record<string, string> | null } | null)?.detail ?? {}) as Record<string, string>;
    // merged, never replaced — the room lines and the pull's keys stay; the voucher itself is NOT touched
    await db.from("operation_bookings").update({ detail: { ...detail, "الفوتشر قيد المراجعة": "بريد مورّد" } }).eq("id", bookingId);
  }
}

/** the last uid already read, from its app_settings row */
async function lastUid(db: SupabaseClient): Promise<number> {
  const { data } = await db.from("app_settings").select("value").eq("key", UID_KEY).maybeSingle();
  const n = Number((data as { value?: string } | null)?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export type MailRunResult = { read: number; linked: number; unmatched: number } | { skipped: "not_configured" };

/** The IMAP fetch, kept small: connect, read what is newer than the last uid, feed processMessage. */
async function fetchNewMail(): Promise<MailRunResult> {
  const db = service();
  const since = await lastUid(db);
  const client = new ImapFlow({
    host: process.env["RESERVATIONS_IMAP_HOST"]!,
    port: 993,
    secure: true,
    auth: { user: process.env["RESERVATIONS_IMAP_USER"]!, pass: process.env["RESERVATIONS_IMAP_PASSWORD"]! },
    logger: false,
  });
  const result = { read: 0, linked: 0, unmatched: 0 };
  let newest = since;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // uid fetch with {source} downloads BODY.PEEK — read-only, no \Seen set
      for await (const msg of client.fetch(`${since + 1}:*`, { uid: true, source: true, envelope: true }, { uid: true })) {
        // IMAP quirk: `${n}:*` always returns the last message, even below n
        if (msg.uid <= since || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const when = parsed.date ?? msg.envelope?.date ?? null;
        const out = await processMessage({
          uid: msg.uid,
          message_id: parsed.messageId ?? null,
          from: parsed.from?.value?.[0]?.address ?? null,
          subject: parsed.subject ?? "",
          text: parsed.text ?? "",
          received_at: when ? new Date(when).toISOString() : null,
        });
        result.read += 1;
        if (out === "linked") result.linked += 1;
        if (out === "new") result.unmatched += 1;
        newest = Math.max(newest, msg.uid);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  if (newest > since) {
    await db.from("app_settings").upsert({ key: UID_KEY, value: String(newest), updated_at: new Date().toISOString() });
  }
  return result;
}

/** The whole pass — /api/ops/mail calls it. No mailbox configured: skipped, not an error. */
export async function runReservationsMail(): Promise<MailRunResult> {
  if (!reservationsMailConfigured()) return { skipped: "not_configured" };
  return asSystem({ name: "reservations-mail", can: [] }, fetchNewMail);
}
