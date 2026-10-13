/**
 * Links for the people outside the system (operations order 11): the supplier
 * who confirms a request himself, the driver who marks his day's pick-ups.
 *
 * The token is the gate (as /trip and /voucher): 24 random bytes, validated
 * server-side through the service role. This module holds only the rules —
 * when a link is open, what a supplier's answer must carry, what a driver's
 * step writes. Pure: no React, no Supabase.
 */

import { DRIVER_STEP, DRV, waNumber, type DriverStep, type ServiceKind } from "./drivers";

export type LinkKind = "supplier" | "driver";

/** A supplier gets a week to answer; a fresh link can be minted after. */
export const SUPPLIER_LINK_DAYS = 7;

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const supplierLinkExpiry = (now: Date): string => new Date(now.getTime() + SUPPLIER_LINK_DAYS * 86_400_000).toISOString();

/** A driver's day closes at the end of the following Riyadh day — a pick-up after midnight still counts. */
export const driverLinkExpiry = (serviceDate: string): string => new Date(`${addDays(serviceDate, 2)}T00:00:00+03:00`).toISOString();

export function linkOpen(row: { expires_at: string; revoked_at: string | null }, now: Date): boolean {
  return !row.revoked_at && Date.parse(row.expires_at) > now.getTime();
}

/** The same driver, however the number was typed («05…», «+966 5…», «00966…»). */
export function sameDriver(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = waNumber(a ?? "");
  return x.length >= 7 && x === waNumber(b ?? "");
}

// ---------------- the supplier's answer ----------------

export type SupplierAnswerInput = { ref: string; driver: string; phone: string; car: string; plate: string };

/** A public form: every field trimmed and capped, whatever the browser sent. */
const clean = (s: unknown, max = 120) => String(s ?? "").trim().slice(0, max);

/**
 * What the supplier's answer writes to the booking. A hotel, a flight, a visa:
 * the confirmation number. A drive or a tour: the driver and his phone (the
 * car and plate when known); its number is then optional — a DMC often has none.
 */
export function supplierAnswer(
  service: ServiceKind | null,
  input: SupplierAnswerInput,
): { ok: true; ref: string | null; detail: Record<string, string> } | { ok: false; error: "ref" | "driver" } {
  const ref = clean(input.ref, 60);
  if (!service) return ref ? { ok: true, ref, detail: {} } : { ok: false, error: "ref" };
  const fields: [string, string][] = [
    [DRV.driver, clean(input.driver)],
    [DRV.phone, clean(input.phone, 30)],
    [DRV.car, clean(input.car)],
    [DRV.plate, clean(input.plate, 30)],
  ];
  if (!fields[0][1] || !fields[1][1]) return { ok: false, error: "driver" };
  return { ok: true, ref: ref || null, detail: Object.fromEntries(fields.filter(([, v]) => v)) };
}

// ---------------- the driver's step ----------------

/** «في الطريق» then «تم الاستقبال» — never back: a guest picked up stays picked up. */
export function stepAllowed(current: DriverStep | null, next: DriverStep): boolean {
  return current !== "done" && current !== next;
}

/** The detail the step writes. `riyadhNow` is «YYYY-MM-DD HH:mm», the company's clock. */
export function stepDetail(detail: Record<string, string> | null, step: DriverStep, riyadhNow: string): Record<string, string> {
  const out: Record<string, string> = { ...(detail ?? {}), [DRV.status]: DRIVER_STEP[step] };
  if (step === "done") out[DRV.handedAt] = riyadhNow;
  return out;
}
