/**
 * The operations list: who finds which case, and what is moving this week.
 *
 * Pure and clock-injected (like signals.ts): "arriving tomorrow" turns true with
 * no UPDATE anywhere, so the date is an argument a test can move.
 */

import { isLiveCase } from "./summary";
import type { ClientStatus, ExecutionStatus } from "./state";

export type ListedCase = {
  serial: string;
  destination: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  partner_name: string | null;
  travel_start: string | null;
  travel_end: string | null;
  client_status: ClientStatus;
  execution_status: ExecutionStatus;
  assignee_id?: string | null;
};

/** "" means "any". status "" = the live cases only; assignee "none" = nobody owns it. */
export type ListFilters = { from: string; to: string; destination: string; assignee: string; status: string };

export const NO_FILTERS: ListFilters = { from: "", to: "", destination: "", assignee: "", status: "" };

/** The phone digits that identify a number however it was typed: no +966 / 00966 / leading 0. */
const significant = (s: string) => s.replace(/\D/g, "").replace(/^(00)?966/, "").replace(/^0+/, "");

/** Name, serial, destination, partner — and the phone, written any way the agent types it. */
export function matchesQuery(op: ListedCase, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = [op.serial, op.destination, op.customer_name, op.customer_phone, op.partner_name]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
  if (text || !/^[\d\s+()-]+$/.test(q)) return text;
  const digits = significant(q);
  return digits.length >= 4 && Boolean(op.customer_phone) && significant(op.customer_phone ?? "").includes(digits);
}

/** Cancelled and travelled cases stay out of the list unless their status is asked for (or a search reaches them). */
export function matchesFilters(op: ListedCase, f: ListFilters, includeClosed = false): boolean {
  if (f.status) {
    if (op.execution_status !== f.status && !(f.status === "cancelled" && op.client_status === "cancelled")) return false;
  } else if (!includeClosed && !isLiveCase(op)) return false;
  if (f.from && (!op.travel_start || op.travel_start < f.from)) return false;
  if (f.to && (!op.travel_start || op.travel_start > f.to)) return false;
  if (f.destination && op.destination !== f.destination) return false;
  if (f.assignee === "none" ? Boolean(op.assignee_id) : Boolean(f.assignee) && op.assignee_id !== f.assignee) return false;
  return true;
}

export type Span = "today" | "tomorrow" | "week";

/** Calendar arithmetic on a plain date — UTC midnight, so no timezone can move it. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Who lands and who flies home today, tomorrow, or in the seven days from today. */
export function movements<T extends ListedCase>(ops: T[], today: string, span: Span): { arrivals: T[]; departures: T[] } {
  const lo = span === "tomorrow" ? addDays(today, 1) : today;
  const hi = span === "week" ? addDays(today, 6) : lo;
  const within = (d: string | null) => Boolean(d) && d! >= lo && d! <= hi;
  const live = ops.filter((o) => o.client_status !== "cancelled" && o.execution_status !== "cancelled");
  const by = (key: "travel_start" | "travel_end") => (a: T, b: T) => (a[key] ?? "").localeCompare(b[key] ?? "");
  return {
    arrivals: live.filter((o) => within(o.travel_start)).sort(by("travel_start")),
    departures: live.filter((o) => within(o.travel_end)).sort(by("travel_end")),
  };
}

/** What the client's page says about reaching us — typed by ops on the case, shown on /trip. */
export type ClientInfo = { emergency_phone: string; agent_name: string; agent_phone: string; pay_note: string };

export function toClientInfo(raw: unknown): ClientInfo {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = (k: string, max: number) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, max) : "");
  return { emergency_phone: s("emergency_phone", 40), agent_name: s("agent_name", 120), agent_phone: s("agent_phone", 40), pay_note: s("pay_note", 1000) };
}
