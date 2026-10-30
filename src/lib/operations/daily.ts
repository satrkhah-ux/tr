import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyOps, notifyPartnerCase } from "@/lib/data/ops-notify";
import { sendWeeklyDataQuality } from "@/lib/data/quality-weekly";
import { sendClientMessage } from "@/lib/data/client-messages";
import { messagesDueToday } from "./client-messages";
import { passportAlerts, type AlertTraveler } from "./progress";
import { caseTotal, defaultSchedule, installmentStates, paidTotal } from "./payments";
import { canAdvanceClient, canAdvanceExecution, type ClientStatus, type ExecutionStatus } from "./state";
import { hotelAtRisk, type ClientBookingRow } from "./client-booking-state";
import { notifyDueWaits, travelBlockers } from "@/lib/data/wizard-case";
import { translate } from "@/lib/i18n";
import { readyLabel } from "./wizard/index";
import { BNPL_METHODS, settlementReminder } from "@/lib/payments/methods";
import { tellEmployee } from "./payment-links-poll";
import { notifyEmployee } from "@/lib/notifications/notify";
import { sendFinanceAlerts } from "@/lib/data/accounts";
import { endOfRiyadhDay, reminderStep, reminderText, riyadhDay } from "./refund-mode";
import { dueReminder } from "./agreement";

/**
 * The operations day (operations order 6), run once a morning by the server's
 * crontab through /api/ops/daily:
 *
 *  1. a trip whose last day has passed is «سافر»;
 *  2. a «سافر» case is closed (client «مكتمل») once rated, or seven days after;
 *  3. alerts — 7, 3 and 1 days before travel with what is still missing, a
 *     passport issue (missing, no expiry, expired by the travel day, under six
 *     months after the return, age not as sold) — each sent ONCE
 *     (operation_alerts), to the operations team on Telegram.
 */

export type DailyResult = { travelled: number; completed: number; alerts: number };

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

type Op = {
  id: string;
  offer_id: string;
  client_status: ClientStatus;
  execution_status: ExecutionStatus;
  travel_start: string | null;
  travel_end: string | null;
  offers: { serial: string; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null } | { serial: string; customers: unknown }[] | null;
};

const serialOf = (op: Op) => (Array.isArray(op.offers) ? op.offers[0]?.serial : op.offers?.serial) ?? "";

/** Send an alert unless this one (operation, kind, ref) already went out. */
async function alertOnce(supabase: SupabaseClient, operationId: string, kind: string, ref: string, text: string): Promise<boolean> {
  const { error } = await supabase.from("operation_alerts").insert({ operation_id: operationId, kind, ref });
  if (error) return false; // the unique key: already sent
  await notifyOps(text, `/operations/${operationId}`);
  return true;
}

export async function runOpsDaily(today: string): Promise<DailyResult> {
  // Sundays: the data-quality counts and their week's change (data order 11.4)
  await sendWeeklyDataQuality(today);
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
  const result: DailyResult = { travelled: 0, completed: 0, alerts: 0 };
  const { data } = await supabase
    .from("operations")
    .select("id, offer_id, client_status, execution_status, travel_start, travel_end, offers(serial, customers(arabic_name))")
    .neq("execution_status", "cancelled")
    .limit(2000);
  const ops = (data ?? []) as unknown as Op[];

  const ratings = new Set(
    (((await supabase.from("operation_ratings").select("operation_id")).data ?? []) as { operation_id: string }[]).map((r) => r.operation_id),
  );

  for (const op of ops) {
    // 1. back home
    if (op.travel_end && op.travel_end < today && canAdvanceExecution(op.execution_status, "travelled")) {
      await supabase.from("operations").update({ execution_status: "travelled", updated_at: new Date().toISOString() }).eq("id", op.id);
      await supabase.from("offers").update({ pipeline_stage: "completed" }).eq("id", op.offer_id);
      await logAudit({ action: "operation.execution_status", entity: "operations", entity_id: op.id, meta: { from: op.execution_status, to: "travelled", auto: true }, actor: { id: null, label: "ops-daily" } });
      await notifyPartnerCase({ offerId: op.offer_id, what: "سافر" });
      await sendClientMessage(op.id, "rate_trip");
      op.execution_status = "travelled";
      result.travelled += 1;
    }
    // 2. closed: rated, or a week after the return
    if (
      op.execution_status === "travelled" &&
      op.travel_end &&
      (ratings.has(op.id) || addDays(op.travel_end, 7) <= today) &&
      canAdvanceClient(op.client_status, "completed")
    ) {
      await supabase.from("operations").update({ client_status: "completed", updated_at: new Date().toISOString() }).eq("id", op.id);
      await logAudit({ action: "operation.client_status", entity: "operations", entity_id: op.id, meta: { from: op.client_status, to: "completed", auto: true }, actor: { id: null, label: "ops-daily" } });
      result.completed += 1;
      continue;
    }
    // the client's dated messages — three days before, the day before, the
    // travel day, the morning after it, mid-trip (each once: sendClientMessage keeps count)
    if (op.execution_status !== "travelled") {
      for (const key of messagesDueToday(op.travel_start, op.travel_end, today)) await sendClientMessage(op.id, key);
    }

    // 3. before travel
    if (!op.travel_start || op.travel_start < today || op.execution_status === "travelled") continue;
    const days = Math.round((Date.parse(op.travel_start) - Date.parse(today)) / 86_400_000);
    const name = (() => {
      const o = Array.isArray(op.offers) ? op.offers[0] : op.offers;
      const c = o?.customers as { arabic_name: string | null } | { arabic_name: string | null }[] | null | undefined;
      return (Array.isArray(c) ? c[0]?.arabic_name : c?.arabic_name) ?? "";
    })();
    const head = `${serialOf(op)}${name ? ` — ${name}` : ""}`;

    if ([7, 3, 1].includes(days)) {
      // what still blocks «جاهز للسفر» — the wizard's own rules, in its tiles' words
      const missing = (await travelBlockers(op.id)) ?? [];
      const lines = missing.map((i) => `• ${translate("ar", `wz.step.${i.step}`)}: ${translate("ar", readyLabel(i))}`);
      if (missing.length && (await alertOnce(supabase, op.id, "before_travel", String(days), [`⏰ السفر بعد ${days === 1 ? "يوم" : `${days} أيام`}: ${head}`, "", ...lines].join("\n")))) {
        result.alerts += 1;
      }
    }

    // a late installment — the agreed schedule, or the house default (operations order 7)
    {
      const [{ data: rows }, { data: pays }, { data: meta }] = await Promise.all([
        supabase.from("operation_installments").select("due_date, amount").eq("operation_id", op.id),
        supabase.from("operation_payments").select("amount, kind").eq("operation_id", op.id),
        supabase.from("operations").select("confirmed_at, agreed_total, offers(total)").eq("id", op.id).maybeSingle(),
      ]);
      const m = meta as unknown as { confirmed_at: string; agreed_total: number | string | null; offers: { total: number | string | null } | { total: number | string | null }[] | null } | null;
      const total = caseTotal((Array.isArray(m?.offers) ? m?.offers[0] : m?.offers)?.total, m?.agreed_total);
      const schedule = (rows ?? []).length
        ? ((rows ?? []) as { due_date: string | null; amount: number | string }[]).map((r) => ({ due_date: r.due_date, amount: Number(r.amount) }))
        : defaultSchedule({ total, confirmed_on: (m?.confirmed_at ?? today).slice(0, 10), travel_start: op.travel_start });
      const paid = paidTotal(((pays ?? []) as { amount: number | string; kind: string }[]).map((p) => ({ amount: Number(p.amount), kind: p.kind })));
      for (const row of installmentStates(schedule, paid, today)) {
        // overdue, due soon (3 days) and due today — to operations and to «الحسابات», who collect it (the owner, 2026-10-30)
        const due = row.state === "overdue" ? "overdue" : dueReminder(row, today);
        if (!due || !row.due_date) continue;
        const left = (row.amount - row.covered).toLocaleString("en-US");
        const text = due === "overdue" ? `💳 قسط متأخر منذ ${row.due_date}: ${left} — ${head}` : `💳 قسط مستحق ${due === "today" ? "اليوم" : "بعد ٣ أيام"} (${row.due_date}): ${left} — ${head}`;
        const kind = due === "overdue" ? "installment_overdue" : `installment_due_${due}`;
        if (!(await alertOnce(supabase, op.id, kind, row.due_date, text))) continue;
        result.alerts += 1;
        await notifyEmployee({ permission: ACCOUNTS_PERMISSION, kind: "ops", title: text, href: `/operations/${op.id}`, source: "operations", dedupeKey: `${kind}:${op.id}:${row.due_date}` });
      }
    }

    // the passports — the ops screen's and /trip's own decision (passportAlerts → passportIssues)
    const { data: travelers } = await supabase
      .from("operation_travelers")
      .select("id, display_name, traveler_kind, passport_encrypted, passport_expiry, birth_date, age")
      .eq("operation_id", op.id);
    const people = ((travelers ?? []) as (Omit<AlertTraveler, "has_passport"> & { passport_encrypted: string | null })[]).map(
      // the ciphertext is read only to become a yes/no, here, server-side
      ({ passport_encrypted, ...t }) => ({ ...t, has_passport: Boolean(passport_encrypted) }),
    );
    for (const alert of passportAlerts(people, op, today)) {
      if (await alertOnce(supabase, op.id, "passport", alert.ref, `${alert.text} — ${head}`)) result.alerts += 1;
    }
  }
  result.alerts += await provisionalHotelAlerts(supabase, ops, today);
  // «قائمة متابعتك اليوم» — the waits whose day has come, once per case a day (wizard-case.ts)
  result.alerts += await notifyDueWaits(supabase, today);
  result.alerts += await settlementReminders(supabase, today);
  result.alerts += await refundDeadlineReminders(supabase, ops, today);
  // «الإنذارات المالية» to the management and the accounts team (accounts stage 6); never holds up the operations morning
  try {
    result.alerts += await sendFinanceAlerts(today);
  } catch (e) {
    console.error("[finance-alerts]", e);
  }
  return result;
}

/**
 * Who answers for paying a supplier (the owner, 2026-10-30: «الموظف المسؤول والحسابات»):
 * «الحسابات», the financial section's staff — the owner assigns finance.accounts on the employees screen.
 */
export const ACCOUNTS_PERMISSION = "finance.accounts" as const;

/**
 * «ادفع قبل … وإلا يُلغى الحجز» / «آخر يوم للإلغاء المجاني …» (the owner, 2026-10-30):
 * 3 days, 1 day and the day itself before an unpaid booking's pay_by or
 * refundable_until day — each step once per booking and day (operation_alerts
 * «refund_deadline», ref booking:day:step; a new day re-arms them). To operations
 * (notifyOps), the booking's «ينفّذه» else the case's «مسؤول الحالة» else its seller,
 * and accounts. With the first, a case note tagging that employee: the client's
 * reminder waits in «رسائل جاهزة للإرسال» — prepared, never sent from here.
 */
async function refundDeadlineReminders(supabase: SupabaseClient, ops: Op[], today: string): Promise<number> {
  const live = new Map(ops.map((op) => [op.id, op]));
  if (live.size === 0) return 0;
  const { data } = await supabase
    .from("operation_bookings")
    .select("id, operation_id, title, city_name, cancellation_deadline, assignee_employee_id, refund_mode:detail->>refund_mode, operations(assignee_id, offers(employee_id))")
    .in("detail->>refund_mode", ["pay_by", "refundable_until"])
    .eq("is_paid", false)
    .neq("status", "cancelled")
    .gte("cancellation_deadline", new Date(`${today}T00:00:00+03:00`).toISOString())
    .lte("cancellation_deadline", endOfRiyadhDay(addDays(today, 3)) ?? today);
  type Row = { id: string; operation_id: string; title: string; city_name: string; cancellation_deadline: string; assignee_employee_id: string | null; refund_mode: "pay_by" | "refundable_until"; operations: unknown };
  const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
  let sent = 0;
  for (const b of (data ?? []) as Row[]) {
    const op = live.get(b.operation_id);
    const day = riyadhDay(b.cancellation_deadline);
    const step = day ? reminderStep(day, today) : null;
    if (!op || !day || step === null) continue;
    const head = `${b.title}${b.city_name ? ` — ${b.city_name}` : ""}`;
    const text = `${reminderText(b.refund_mode, head, day, today)} — ${serialOf(op)}`;
    if (!(await alertOnce(supabase, op.id, "refund_deadline", `${b.id}:${day}:${step}`, text))) continue;
    sent += 1;
    const caseRow = one(b.operations as { assignee_id: string | null; offers: unknown } | null);
    const owner = b.assignee_employee_id ?? caseRow?.assignee_id ?? one(caseRow?.offers as { employee_id: string | null } | null)?.employee_id ?? null;
    const href = `/operations/${op.id}`;
    if (owner) await tellEmployee(supabase, owner, text, href, `refund:${b.id}:${day}:${step}`);
    await notifyEmployee({ permission: ACCOUNTS_PERMISSION, kind: "ops", title: text, href, source: "operations", dedupeKey: `refund:${b.id}:${day}:${step}` });
    // the case note, once per booking and day — naming who sends the client's reminder
    const { error } = await supabase.from("operation_alerts").insert({ operation_id: op.id, kind: "refund_note", ref: `${b.id}:${day}` });
    if (error) continue;
    const { data: who } = owner ? await supabase.from("employees").select("arabic_name").eq("id", owner).maybeSingle() : { data: null };
    const name = (who as { arabic_name: string | null } | null)?.arabic_name?.trim();
    await logAudit({
      action: "operation.note",
      entity: "operations",
      entity_id: op.id,
      meta: { note: `📌 ${name ? `@${name}: ` : ""}${text}. جاهز للإرسال: تذكير السداد للعميل في «رسائل جاهزة للإرسال» (إن بقي عليه مبلغ) — راجعه وأرسله.` },
      actor: { id: null, label: "ops-daily" },
    });
  }
  return sent;
}

/**
 * Tabby/Tamara pay us out weekly (the owner, 2026-10-29): on the day a
 * payment's money should land (operation_payments.expected_settlement_on), the
 * case's seller is reminded to check it with finance — once per payment
 * (operation_alerts «bnpl_settlement», ref = the payment), in-app and on «تنبيهاتي».
 */
async function settlementReminders(supabase: SupabaseClient, today: string): Promise<number> {
  const { data } = await supabase
    .from("operation_payments")
    .select("id, method, operation_id, operations(offers(employee_id, customers(arabic_name)))")
    .in("method", [...BNPL_METHODS])
    .eq("expected_settlement_on", today)
    .neq("kind", "refund");
  type Row = { id: string; method: string; operation_id: string; operations: unknown };
  const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
  let sent = 0;
  for (const p of (data ?? []) as Row[]) {
    const offer = one(one(p.operations as { offers: unknown } | null)?.offers as { employee_id: string | null; customers: unknown } | null);
    const name = one(offer?.customers as { arabic_name: string | null } | null)?.arabic_name ?? "";
    if (!offer?.employee_id) continue;
    const { error } = await supabase.from("operation_alerts").insert({ operation_id: p.operation_id, kind: "bnpl_settlement", ref: p.id });
    if (error) continue; // the unique key: already reminded
    await tellEmployee(supabase, offer.employee_id, settlementReminder(name, p.method), `/operations/${p.operation_id}`, `bnpl:${p.id}`);
    sent += 1;
  }
  return sent;
}

/**
 * Red (the owner, 2026-10-17): a hotel still holding only OUR number from the
 * day before travel — the client is about to arrive at a desk with no
 * confirmation of the hotel's own. To the case's issuer and operations.write
 * (notifyOps), once per booking.
 */
async function provisionalHotelAlerts(supabase: SupabaseClient, ops: Op[], today: string): Promise<number> {
  const tomorrow = addDays(today, 1);
  const soon = ops.filter((op) => op.travel_start && op.travel_start <= tomorrow && (op.travel_end ?? op.travel_start) >= today);
  if (soon.length === 0) return 0;
  const { data } = await supabase
    .from("operation_bookings")
    .select("id, operation_id, kind, title, city_name, start_date, end_date, status, confirmation_number, company_ref, detail")
    .eq("kind", "hotel")
    .in("operation_id", soon.map((op) => op.id));
  let sent = 0;
  for (const b of (data ?? []) as (ClientBookingRow & { id: string; operation_id: string })[]) {
    const op = soon.find((o) => o.id === b.operation_id);
    if (!op || !hotelAtRisk(b, op.travel_start, today)) continue;
    const text = `🔴 فندق بلا تأكيد نهائي و${op.travel_start && op.travel_start > today ? "السفر غداً" : "الرحلة بدأت"}: ${b.title}${b.city_name ? ` — ${b.city_name}` : ""} (رقم حجزنا ${b.company_ref ?? "—"}) — ${serialOf(op)}`;
    if (await alertOnce(supabase, op.id, "hotel_provisional", b.id, text)) sent += 1;
  }
  return sent;
}
