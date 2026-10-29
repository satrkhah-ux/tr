/**
 * MyFatoorah — an invoice link the client pays by card / mada / Apple Pay.
 *
 * Env: MYFATOORAH_API_KEY (Bearer token), MYFATOORAH_BASE_URL. The default host
 * is MyFatoorah's TEST host; the Saudi live host is https://api-sa.myfatoorah.com
 * and must be set explicitly with the live key — a live key on the test host
 * (or the reverse) is refused by MyFatoorah, never silently mixed.
 *
 * Mock: PAYMENTS_MOCK=1, or no key, returns a deterministic fake link flagged
 * `mock: true` — the flow works before the owner puts a real key on the server.
 *
 * Never throws: every call returns a SupplierOutcome (ok / rejected / unreachable).
 */

import "server-only";
import type { SupplierOutcome } from "./hotel-supplier";

export const MYFATOORAH_TEST_URL = "https://apitest.myfatoorah.com";
const TIMEOUT_MS = 20_000;

export type InvoiceLinkInput = {
  amount: number;
  currency: string;
  customerName: string;
  customerMobile?: string | null;
  /** our case serial — MyFatoorah echoes it back as CustomerReference. */
  reference: string;
  language?: "ar" | "en";
};

export type InvoiceLink = { invoiceId: string; url: string; mock: boolean };

export type InvoiceStatus = { status: "paid" | "pending" | "failed" | "expired"; paidAmount?: number; mock: boolean };

type MfEnvelope<T> = { IsSuccess?: boolean; Message?: string | null; ValidationErrors?: { Name?: string; Error?: string }[] | null; Data?: T | null };

const config = () => {
  const key = process.env["MYFATOORAH_API_KEY"] || "";
  const mock = process.env["PAYMENTS_MOCK"] === "1" || !key;
  return { key, mock, base: (process.env["MYFATOORAH_BASE_URL"] || MYFATOORAH_TEST_URL).replace(/\/$/, "") };
};

/** MyFatoorah wants the country code and the local number apart (max 11 digits); only a Saudi number is split, anything else is left out (it is optional). */
export function splitSaudiMobile(phone: string | null | undefined): { MobileCountryCode: string; CustomerMobile: string } | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  const local = digits.startsWith("966") ? digits.slice(3) : digits.startsWith("05") ? digits.slice(1) : null;
  return local && /^5\d{8}$/.test(local) ? { MobileCountryCode: "+966", CustomerMobile: local } : null;
}

export function buildSendPaymentBody(input: InvoiceLinkInput) {
  return {
    CustomerName: input.customerName.trim() || "—",
    // LNK: MyFatoorah only creates the link and sends nothing — we send it ourselves after review
    NotificationOption: "LNK",
    InvoiceValue: Math.round(input.amount * 100) / 100,
    DisplayCurrencyIso: input.currency,
    CustomerReference: input.reference,
    Language: input.language === "en" ? "EN" : "AR",
    ...(splitSaudiMobile(input.customerMobile) ?? {}),
  };
}

const reason = (env: MfEnvelope<unknown>) =>
  env.ValidationErrors?.map((e) => `${e.Name ?? ""}: ${e.Error ?? ""}`).join("; ") || env.Message || "MyFatoorah";

export function parseSendPaymentResponse(json: unknown): SupplierOutcome<InvoiceLink> {
  const env = (json ?? {}) as MfEnvelope<{ InvoiceId?: number | string; InvoiceURL?: string }>;
  if (!env.IsSuccess || !env.Data?.InvoiceURL || env.Data.InvoiceId == null) return { kind: "rejected", code: null, message: reason(env) };
  return { kind: "ok", data: { invoiceId: String(env.Data.InvoiceId), url: env.Data.InvoiceURL, mock: false } };
}

/** InvoiceStatus is Pending / Paid / Canceled per the docs; "Expired" is mapped too in case an account reports it. */
export function parseStatusResponse(json: unknown): SupplierOutcome<InvoiceStatus> {
  const env = (json ?? {}) as MfEnvelope<{ InvoiceStatus?: string; InvoiceValue?: number }>;
  if (!env.IsSuccess || !env.Data) return { kind: "rejected", code: null, message: reason(env) };
  const s = (env.Data.InvoiceStatus ?? "").toLowerCase();
  if (s === "paid") return { kind: "ok", data: { status: "paid", paidAmount: env.Data.InvoiceValue, mock: false } };
  const status = s === "expired" ? "expired" : s === "canceled" || s === "cancelled" || s === "failed" ? "failed" : "pending";
  return { kind: "ok", data: { status, mock: false } };
}

async function post(path: string, body: unknown): Promise<SupplierOutcome<unknown>> {
  const { key, base } = config();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: unknown = await res.json().catch(() => null);
    // a refused key / bad body comes back as a JSON envelope with IsSuccess false; no JSON at all is "never reached"
    if (json === null) return { kind: "unreachable", message: `HTTP ${res.status}` };
    return { kind: "ok", data: json };
  } catch (err) {
    return { kind: "unreachable", message: err instanceof Error ? err.name : "network" };
  }
}

export async function createInvoiceLink(input: InvoiceLinkInput): Promise<SupplierOutcome<InvoiceLink>> {
  if (config().mock) {
    return { kind: "ok", data: { invoiceId: `mock-${input.reference}`, url: `https://pay.mock.local/myfatoorah/${encodeURIComponent(input.reference)}`, mock: true } };
  }
  const res = await post("/v2/SendPayment", buildSendPaymentBody(input));
  return res.kind === "ok" ? parseSendPaymentResponse(res.data) : res;
}

export async function getInvoiceStatus(invoiceId: string): Promise<SupplierOutcome<InvoiceStatus>> {
  if (config().mock) return { kind: "ok", data: { status: "pending", mock: true } };
  const res = await post("/v2/GetPaymentStatus", { Key: invoiceId, KeyType: "InvoiceId" });
  return res.kind === "ok" ? parseStatusResponse(res.data) : res;
}
