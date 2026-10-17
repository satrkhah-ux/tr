import type { PaymentKind } from "@/lib/data/operations";
import { derivedClient } from "@/lib/operations/progress";
import type { ClientStatus } from "@/lib/operations/state";
import { defaultSchedule, installmentStates, paidTotal, remainingBalance, riyadhDate } from "@/lib/operations/payments";
import type { ReadinessItem, StepState, WizardCase } from "./types";

/**
 * Step 5 — «الدفع»: what the client pays next, already in the form. The money
 * arithmetic is payments.ts's (the schedule the case agreed, else the house
 * terms; payments settle the earliest line first) — this only reads off it the
 * amount and kind the employee would otherwise work out and type.
 */

export type PaymentPrefill = { amount: number; kind: Exclude<PaymentKind, "refund">; remaining: number; due_date: string | null };

type Money = Pick<WizardCase, "operation" | "payments" | "installments" | "today">;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The next amount owed and its kind; null when nothing is owed or there is no total to owe against. */
export function paymentPrefill(data: Money): PaymentPrefill | null {
  const { total, confirmed_at, travel_start } = data.operation;
  const paid = paidTotal(data.payments);
  const remaining = remainingBalance(total, paid);
  if (total == null || remaining == null || remaining <= 0) return null;
  const schedule = data.installments.length
    ? data.installments.map((r) => ({ due_date: r.due_date, amount: Number(r.amount) }))
    : defaultSchedule({ total, confirmed_on: riyadhDate(confirmed_at), travel_start });
  const next = installmentStates(schedule, paid, data.today).find((r) => r.state !== "paid");
  const amount = round2(Math.min(next ? next.amount - next.covered : remaining, remaining));
  return {
    amount,
    kind: paid <= 0 ? "deposit" : amount >= remaining ? "final" : "installment",
    remaining,
    due_date: next?.due_date ?? null,
  };
}

/** Settled = nothing left of a known total. */
export function paymentSettled(data: Money): boolean {
  const remaining = remainingBalance(data.operation.total, paidTotal(data.payments));
  return remaining != null && remaining <= 0;
}

/**
 * Paid / partly paid / unpaid — from the RECORDED payments against the sell
 * total, never from client_status: that one can be set by hand (a case read
 * «مسدّد جزئياً» on 0 SAR recorded, 2026-10-17), and the wizard and the gate
 * must not believe it.
 */
export type PaidState = "paid" | "partial" | "unpaid";

export function paidState(total: number | null, paid: number): PaidState {
  const derived = derivedClient(paid, total);
  return derived === "paid_full" ? "paid" : derived === "paid_partial" ? "partial" : "unpaid";
}

/**
 * The client track says more money came in than the payments show — «مسدّد»
 * or «مسدّد جزئياً» picked by hand. Warned (amber), never blocked: the money
 * may have arrived and not been recorded yet.
 */
export function clientStatusUnbacked(status: ClientStatus, total: number | null, paid: number): boolean {
  const state = paidState(total, paid);
  return (status === "paid_full" && state !== "paid") || (status === "paid_partial" && state === "unpaid");
}

export function paymentState(data: WizardCase): StepState {
  return paymentSettled(data) ? "done" : "todo";
}

/** Settled, or a manager let it travel before (operations.ready_exceptions.payment — gateCaseManager only). */
export function paymentReadiness(data: WizardCase): ReadinessItem[] {
  return [{ step: "payment", key: "settled", ok: paymentSettled(data) || Boolean(data.readyExceptions.payment) }];
}
