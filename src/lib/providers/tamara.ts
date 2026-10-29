/**
 * Tamara — a checkout link the client pays in instalments.
 *
 * Env: TAMARA_API_TOKEN (Bearer token), TAMARA_BASE_URL. The default host is
 * Tamara's SANDBOX; live is https://api.tamara.co and must be set explicitly
 * with the live token.
 *
 * Mock: PAYMENTS_MOCK=1, or no token, returns a deterministic fake link flagged
 * `mock: true`.
 *
 * Never throws: every call returns a SupplierOutcome (ok / rejected / unreachable).
 */

import "server-only";
import type { SupplierOutcome } from "./hotel-supplier";

export const TAMARA_SANDBOX_URL = "https://api-sandbox.tamara.co";
const TIMEOUT_MS = 20_000;

export type CheckoutInput = {
  amount: number;
  currency: "SAR";
  /** our case serial — order_reference_id. */
  reference: string;
  customer: { firstName: string; lastName: string; phone: string };
  description: string;
  successUrl: string;
  failureUrl: string;
  cancelUrl: string;
  /** omitted when absent: we have no webhook route yet, and the docs mark it optional. */
  notificationUrl?: string;
};

export type Checkout = { checkoutId: string; orderId: string | null; url: string; mock: boolean };

const config = () => {
  const token = process.env["TAMARA_API_TOKEN"] || "";
  const mock = process.env["PAYMENTS_MOCK"] === "1" || !token;
  return { token, mock, base: (process.env["TAMARA_BASE_URL"] || TAMARA_SANDBOX_URL).replace(/\/$/, "") };
};

/** Tamara wants the number with its country code; a local 05… is read as Saudi. */
export function tamaraPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "");
  return `+${digits.startsWith("05") ? `966${digits.slice(1)}` : digits}`;
}

export function buildCheckoutBody(input: CheckoutInput) {
  const money = (amount: number) => ({ amount: Math.round(amount * 100) / 100, currency: input.currency });
  const phone = tamaraPhone(input.customer.phone);
  const name = { first_name: input.customer.firstName, last_name: input.customer.lastName || input.customer.firstName };
  return {
    order_reference_id: input.reference,
    total_amount: money(input.amount),
    description: input.description,
    country_code: "SA",
    payment_type: "PAY_BY_INSTALMENTS",
    locale: "ar_SA",
    items: [
      {
        reference_id: input.reference,
        type: "Digital",
        name: input.description,
        sku: input.reference,
        quantity: 1,
        total_amount: money(input.amount),
      },
    ],
    consumer: { ...name, phone_number: phone },
    // Unsure: the reference lists shipping_address as required even for services.
    // A trip ships nothing — the consumer's own name/phone and the office's city are sent.
    shipping_address: { ...name, line1: input.description, city: "Riyadh", country_code: "SA", phone_number: phone },
    tax_amount: money(0),
    shipping_amount: money(0),
    merchant_url: {
      success: input.successUrl,
      failure: input.failureUrl,
      cancel: input.cancelUrl,
      ...(input.notificationUrl ? { notification: input.notificationUrl } : {}),
    },
  };
}

export function parseCheckoutResponse(status: number, json: unknown): SupplierOutcome<Checkout> {
  const body = (json ?? {}) as { checkout_id?: string; order_id?: string; checkout_url?: string; message?: string; errors?: { error_code?: string }[] };
  if (status >= 200 && status < 300 && body.checkout_id && body.checkout_url) {
    return { kind: "ok", data: { checkoutId: body.checkout_id, orderId: body.order_id ?? null, url: body.checkout_url, mock: false } };
  }
  const message = body.errors?.map((e) => e.error_code).filter(Boolean).join("; ") || body.message || `HTTP ${status}`;
  return { kind: "rejected", code: status, message };
}

export async function createCheckout(input: CheckoutInput): Promise<SupplierOutcome<Checkout>> {
  const { token, mock, base } = config();
  if (mock) {
    return {
      kind: "ok",
      data: { checkoutId: `mock-${input.reference}`, orderId: null, url: `https://pay.mock.local/tamara/${encodeURIComponent(input.reference)}`, mock: true },
    };
  }
  try {
    const res = await fetch(`${base}/checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildCheckoutBody(input)),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: unknown = await res.json().catch(() => null);
    if (json === null && res.status >= 500) return { kind: "unreachable", message: `HTTP ${res.status}` };
    return parseCheckoutResponse(res.status, json);
  } catch (err) {
    return { kind: "unreachable", message: err instanceof Error ? err.name : "network" };
  }
}

export type OrderStatus = { status: "paid" | "pending" | "failed" | "expired"; paidAmount?: number; mock: boolean };

/**
 * Tamara's order states → ours. Paid only once Tamara has AUTHORISED it
 * (authorised / captured): «approved» still waits on the merchant's authorise
 * call (or auto-authorise on the account), so it stays pending — never a
 * payment recorded that may still fall through.
 */
export function parseOrderResponse(status: number, json: unknown): SupplierOutcome<OrderStatus> {
  const body = (json ?? {}) as { status?: string; total_amount?: { amount?: number | string }; message?: string };
  if (status < 200 || status >= 300 || !body.status) return { kind: "rejected", code: status, message: body.message || `HTTP ${status}` };
  const s = body.status.toLowerCase();
  const amount = Number(body.total_amount?.amount);
  if (["authorised", "fully_captured", "partially_captured"].includes(s)) {
    return { kind: "ok", data: { status: "paid", ...(Number.isFinite(amount) && amount > 0 ? { paidAmount: amount } : {}), mock: false } };
  }
  if (s === "expired") return { kind: "ok", data: { status: "expired", mock: false } };
  if (s === "declined" || s === "canceled" || s === "cancelled") return { kind: "ok", data: { status: "failed", mock: false } };
  return { kind: "ok", data: { status: "pending", mock: false } };
}

export async function getOrderStatus(orderId: string): Promise<SupplierOutcome<OrderStatus>> {
  const { token, mock, base } = config();
  if (mock) return { kind: "ok", data: { status: "pending", mock: true } };
  try {
    const res = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: unknown = await res.json().catch(() => null);
    if (json === null && res.status >= 500) return { kind: "unreachable", message: `HTTP ${res.status}` };
    return parseOrderResponse(res.status, json);
  } catch (err) {
    return { kind: "unreachable", message: err instanceof Error ? err.name : "network" };
  }
}
