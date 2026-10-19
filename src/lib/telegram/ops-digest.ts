import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { operationSignals, severityRank, type OperationSignal, type OperationSnapshot } from "@/lib/operations/signals";
import { defaultSchedule, installmentStates, riyadhDate } from "@/lib/operations/payments";
import { isLiveCase, summarizeOperations, type OpsCase } from "@/lib/operations/summary";
import { isClientStatus, isExecutionStatus } from "@/lib/operations/state";
import { mayWork, type OpsAccess } from "@/lib/operations/access";
import { escapeHtml } from "./ops-bot";

/**
 * «ما يحتاج إجراءً» for the bot.
 *
 * A webhook has no session cookie, so the ordinary loader — which resolves the
 * signed-in user from a cookie — cannot run here. This reads with the service
 * client AFTER the caller has resolved the Telegram account to an employee and
 * their operations access (access.ts accessOf): every file on operations.write,
 * only the files they issued on operations.own — the same mayWork the board
 * scopes by. The permission check is the caller's, the reading is this
 * module's, and neither is skippable.
 *
 * The rules themselves are NOT re-implemented: the same pure signals and the same
 * summariser the board and the dashboard use are called here, so the bot cannot
 * disagree with the screen about what is urgent.
 */

const SIGNAL_AR: Record<string, string> = {
  travel_approaching_incomplete: "السفر يقترب والحجوزات ناقصة",
  cancellation_deadline_near: "الإلغاء المجاني ينتهي",
  passport_expiring: "جواز على وشك الانتهاء",
  hotel_awaiting_confirmation: "فندق بانتظار التأكيد",
  unpaid_confirmed: "مؤكّد وغير مسدّد",
  vouchers_pending: "فاوتشر لم يصدر",
  installment_overdue: "قسط متأخر",
};

export type DigestCase = { id: string; serial: string; customer: string | null; worst: string };

export type OpsDigest = {
  today: string;
  /** only the reader's own files (operations.own) */
  own: boolean;
  liveCases: number;
  needsAction: number;
  critical: number;
  openBookings: number;
  travelSoon: number;
  /** the board's own two lists (OperationsBoard): travel near with bookings missing, confirmed and not paid in full */
  travelIncomplete: number;
  unpaid: number;
  urgent: DigestCase[];
  /** every live case with its signals and the dates its next steps fall on — what «قناة المدير» calls due today */
  live: DigestLive[];
};

export type DigestLive = {
  id: string;
  serial: string;
  customer: string | null;
  travel_start: string | null;
  signals: OperationSignal[];
  /** the earliest free-cancellation deadline of a confirmed booking, from today on */
  deadline: string | null;
  /** the earliest installment still owed, from today on (an overdue one is the board's «قسط متأخر») */
  payment: string | null;
};

export async function buildOpsDigest(limit = 5, access: OpsAccess = { all: true }): Promise<OpsDigest> {
  // the company's day, as the board reads it (operations-work.ts) — the UTC date was yesterday until 03:00 Riyadh
  const today = riyadhDate();
  const empty: OpsDigest = { today, own: !access.all, liveCases: 0, needsAction: 0, critical: 0, openBookings: 0, travelSoon: 0, travelIncomplete: 0, unpaid: 0, urgent: [], live: [] };

  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;

    const { data: opsRows } = await supabase
      .from("operations")
      .select("id, client_status, execution_status, travel_start, confirmed_at, offers(serial, total, currency, employee_id, customers(arabic_name))");
    const operations = (
      (opsRows ?? []) as unknown as {
        id: string;
        client_status: string;
        execution_status: string;
        travel_start: string | null;
        confirmed_at: string | null;
        offers: { serial: string; total: number | null; currency: string | null; employee_id: string | null; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null } | null;
      }[]
    ).filter((o) => mayWork(access, (Array.isArray(o.offers) ? o.offers[0] : o.offers)?.employee_id));
    if (operations.length === 0) return empty;

    const ids = operations.map((o) => o.id);
    const [bookingsRes, docsRes, paysRes, travRes, instRes] = await Promise.all([
      supabase.from("operation_bookings").select("id, operation_id, kind, title, status, cancellation_deadline, confirmed_at, confirmation_number, company_ref").in("operation_id", ids),
      supabase.from("operation_documents").select("operation_id, kind, booking_id, created_at").is("revoked_at", null).in("operation_id", ids),
      supabase.from("operation_payments").select("operation_id, amount, kind").in("operation_id", ids),
      supabase.from("operation_travelers").select("operation_id, display_name, passport_expiry").in("operation_id", ids),
      supabase.from("operation_installments").select("operation_id, due_date, amount").in("operation_id", ids),
    ]);

    const group = <T extends { operation_id: string }>(rows: readonly T[] | null | undefined) => {
      const out = new Map<string, T[]>();
      for (const r of rows ?? []) {
        const list = out.get(r.operation_id);
        if (list) list.push(r);
        else out.set(r.operation_id, [r]);
      }
      return out;
    };
    const bookings = group((bookingsRes.data ?? []) as unknown as { operation_id: string; id: string; kind: string; title: string; status: string; cancellation_deadline: string | null; confirmed_at: string | null; confirmation_number: string | null; company_ref: string | null }[]);
    const documents = group((docsRes.data ?? []) as unknown as { operation_id: string; kind: string; booking_id: string | null; created_at: string }[]);
    const travelers = group((travRes.data ?? []) as unknown as { operation_id: string; display_name: string; passport_expiry: string | null }[]);
    const installments = group((instRes.data ?? []) as unknown as { operation_id: string; due_date: string | null; amount: number }[]);

    const paid = new Map<string, number>();
    for (const p of (paysRes.data ?? []) as { operation_id: string; amount: number; kind: string }[]) {
      const delta = p.kind === "refund" ? -Number(p.amount) : Number(p.amount);
      paid.set(p.operation_id, (paid.get(p.operation_id) ?? 0) + delta);
    }

    const cases: OpsCase[] = [];
    const live: DigestLive[] = [];
    const named: { id: string; serial: string; customer: string | null; signals: ReturnType<typeof operationSignals>; travel: string | null }[] = [];

    for (const op of operations) {
      if (!isClientStatus(op.client_status) || !isExecutionStatus(op.execution_status)) continue;
      const offer = Array.isArray(op.offers) ? op.offers[0] : op.offers;
      const customer = Array.isArray(offer?.customers) ? offer?.customers[0] : offer?.customers;

      const bs = bookings.get(op.id) ?? [];
      const ds = documents.get(op.id) ?? [];
      const ts = travelers.get(op.id) ?? [];

      const snapshot: OperationSnapshot = {
        client_status: op.client_status,
        execution_status: op.execution_status,
        travel_start: op.travel_start,
        total: offer?.total != null ? Number(offer.total) : null,
        paid: paid.get(op.id) ?? 0,
        bookings: bs,
        documents: ds,
        travelers: ts,
        // the schedule staff set, else the house terms — as the board checks «قسط متأخر» (operations-work.ts)
        installments: installments.has(op.id)
          ? (installments.get(op.id) ?? []).map((i) => ({ due_date: i.due_date, amount: Number(i.amount) }))
          : defaultSchedule({ total: offer?.total != null ? Number(offer.total) : null, confirmed_on: riyadhDate(op.confirmed_at ?? undefined), travel_start: op.travel_start }),
      };
      const signals = operationSignals(snapshot, today);

      const entry: OpsCase = {
        client_status: op.client_status,
        execution_status: op.execution_status,
        travel_start: op.travel_start,
        total: snapshot.total,
        paid: snapshot.paid,
        currency: offer?.currency ?? null,
        bookings: bs.map((b) => ({ id: b.id, status: b.status })),
        signals,
      };
      cases.push(entry);
      if (isLiveCase(entry)) {
        const fromToday = (dates: (string | null | undefined)[]) => dates.map((d) => d?.slice(0, 10)).filter((d): d is string => Boolean(d) && d! >= today).sort()[0] ?? null;
        live.push({
          id: op.id,
          serial: offer?.serial ?? "",
          customer: customer?.arabic_name ?? null,
          travel_start: op.travel_start,
          signals,
          deadline: fromToday(bs.filter((b) => b.status === "confirmed").map((b) => b.cancellation_deadline)),
          payment: fromToday(installmentStates(snapshot.installments ?? [], snapshot.paid, today).filter((r) => r.state !== "paid").map((r) => r.due_date)),
        });
      }
      if (isLiveCase(entry) && signals.length > 0) {
        named.push({ id: op.id, serial: offer?.serial ?? "", customer: customer?.arabic_name ?? null, signals, travel: op.travel_start });
      }
    }

    const counts = summarizeOperations(cases, today);
    const liveWith = (code: string) => cases.filter((c) => isLiveCase(c) && c.signals.some((s) => s.code === code)).length;
    const urgent = named
      .sort((a, b) => {
        const rank = severityRank(a.signals) - severityRank(b.signals);
        return rank !== 0 ? rank : (a.travel ?? "9999").localeCompare(b.travel ?? "9999");
      })
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        serial: c.serial,
        customer: c.customer,
        worst: SIGNAL_AR[c.signals[0]?.code ?? ""] ?? "",
      }));

    return {
      today,
      own: !access.all,
      liveCases: counts.liveCases,
      needsAction: counts.needsAction,
      critical: counts.critical,
      openBookings: counts.openBookings,
      travelSoon: counts.travelSoon,
      travelIncomplete: liveWith("travel_approaching_incomplete"),
      unpaid: liveWith("unpaid_confirmed"),
      urgent,
      live,
    };
  } catch {
    return empty;
  }
}

/** The digest as the message the bot sends. */
export function digestText(digest: OpsDigest, name: string): string {
  if (digest.liveCases === 0) {
    return [`🗂️ <b>قسم العمليات</b>`, "", `أهلاً ${escapeHtml(name)} — لا توجد ${digest.own ? "لك " : ""}ملفات جارية الآن.`].join("\n");
  }
  const lines = [
    digest.own ? "🗂️ <b>ملفاتك — ما يحتاج إجراءً</b>" : "🗂️ <b>قسم العمليات — ما يحتاج إجراءً</b>",
    `<code>${digest.today}</code>`,
    "",
    `• يحتاج إجراءً: <b>${digest.needsAction}</b>${digest.critical > 0 ? ` (منها <b>${digest.critical}</b> حرِج)` : ""}`,
    `• حجوزات لم تُؤكَّد: <b>${digest.openBookings}</b>`,
    `• سفر خلال ٧ أيام: <b>${digest.travelSoon}</b>`,
    `• ملفات جارية: <b>${digest.liveCases}</b>`,
  ];
  if (digest.urgent.length > 0) {
    lines.push("", "<b>الأكثر إلحاحاً</b>");
    for (const c of digest.urgent) {
      lines.push(`— ${escapeHtml(c.customer ?? "—")} · <code>${escapeHtml(c.serial)}</code>${c.worst ? `\n   ${escapeHtml(c.worst)}` : ""}`);
    }
  }
  return lines.join("\n");
}
