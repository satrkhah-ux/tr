import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSendPaymentBody, createInvoiceLink, parseSendPaymentResponse, parseStatusResponse, splitSaudiMobile } from "./myfatoorah";
import { buildCheckoutBody, createCheckout, parseCheckoutResponse } from "./tamara";

const ENV = ["PAYMENTS_MOCK", "MYFATOORAH_API_KEY", "TAMARA_API_TOKEN"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  // any network call is a failed test
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network call in a unit test"))));
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("MyFatoorah", () => {
  it("builds a link-only SendPayment body", () => {
    const body = buildSendPaymentBody({ amount: 1234.567, currency: "SAR", customerName: " عميل تجربة ", customerMobile: "0551234567", reference: "TV-1001" });
    expect(body).toEqual({
      CustomerName: "عميل تجربة",
      NotificationOption: "LNK",
      InvoiceValue: 1234.57,
      DisplayCurrencyIso: "SAR",
      CustomerReference: "TV-1001",
      Language: "AR",
      MobileCountryCode: "+966",
      CustomerMobile: "551234567",
    });
  });

  it("splits only Saudi mobiles", () => {
    expect(splitSaudiMobile("+966 55 123 4567")).toEqual({ MobileCountryCode: "+966", CustomerMobile: "551234567" });
    expect(splitSaudiMobile("+971501234567")).toBeNull();
    expect(splitSaudiMobile(null)).toBeNull();
  });

  it("parses a SendPayment success and a refusal", () => {
    expect(parseSendPaymentResponse({ IsSuccess: true, Message: "Invoice Created Successfully!", Data: { InvoiceId: 424242, InvoiceURL: "https://demo.example/invoice/abc" } })).toEqual({
      kind: "ok",
      data: { invoiceId: "424242", url: "https://demo.example/invoice/abc", mock: false },
    });
    const refused = parseSendPaymentResponse({ IsSuccess: false, Message: "Invalid data", ValidationErrors: [{ Name: "InvoiceValue", Error: "must be positive" }] });
    expect(refused).toEqual({ kind: "rejected", code: null, message: "InvoiceValue: must be positive" });
  });

  it("maps invoice statuses", () => {
    const status = (s: string) => {
      const r = parseStatusResponse({ IsSuccess: true, Data: { InvoiceStatus: s, InvoiceValue: 500 } });
      return r.kind === "ok" ? r.data.status : r.kind;
    };
    expect(status("Paid")).toBe("paid");
    expect(status("Pending")).toBe("pending");
    expect(status("Canceled")).toBe("failed");
    expect(status("Expired")).toBe("expired");
  });

  it("returns the deterministic mock link when the key is absent", async () => {
    const r = await createInvoiceLink({ amount: 100, currency: "SAR", customerName: "x", reference: "TV-1001" });
    expect(r).toEqual({ kind: "ok", data: { invoiceId: "mock-TV-1001", url: "https://pay.mock.local/myfatoorah/TV-1001", mock: true } });
  });

  it("stays mock under PAYMENTS_MOCK=1 even with a key", async () => {
    process.env.MYFATOORAH_API_KEY = "placeholder-not-a-key";
    process.env.PAYMENTS_MOCK = "1";
    const r = await createInvoiceLink({ amount: 100, currency: "SAR", customerName: "x", reference: "TV-1002" });
    expect(r.kind === "ok" && r.data.mock).toBe(true);
  });
});

describe("Tamara", () => {
  const input = {
    amount: 3000,
    currency: "SAR" as const,
    reference: "TV-2001",
    customer: { firstName: "عميل", lastName: "تجربة", phone: "0551234567" },
    description: "رحلة TV-2001",
    successUrl: "https://example.test/ok",
    failureUrl: "https://example.test/fail",
    cancelUrl: "https://example.test/cancel",
  };

  it("builds the documented checkout fields", () => {
    const body = buildCheckoutBody(input);
    expect(body).toMatchObject({
      order_reference_id: "TV-2001",
      total_amount: { amount: 3000, currency: "SAR" },
      description: "رحلة TV-2001",
      country_code: "SA",
      payment_type: "PAY_BY_INSTALMENTS",
      consumer: { first_name: "عميل", last_name: "تجربة", phone_number: "+966551234567" },
      shipping_amount: { amount: 0, currency: "SAR" },
      tax_amount: { amount: 0, currency: "SAR" },
      merchant_url: { success: "https://example.test/ok", failure: "https://example.test/fail", cancel: "https://example.test/cancel" },
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ quantity: 1, total_amount: { amount: 3000, currency: "SAR" } });
    expect(body.merchant_url).not.toHaveProperty("notification");
  });

  it("parses a checkout success and a refusal", () => {
    expect(parseCheckoutResponse(200, { order_id: "ord-1", checkout_id: "chk-1", checkout_url: "https://checkout.example/chk-1", status: "new" })).toEqual({
      kind: "ok",
      data: { checkoutId: "chk-1", orderId: "ord-1", url: "https://checkout.example/chk-1", mock: false },
    });
    expect(parseCheckoutResponse(400, { message: "Invalid", errors: [{ error_code: "total_amount_invalid" }] })).toEqual({
      kind: "rejected",
      code: 400,
      message: "total_amount_invalid",
    });
  });

  it("returns the deterministic mock link when the token is absent", async () => {
    const r = await createCheckout(input);
    expect(r).toEqual({ kind: "ok", data: { checkoutId: "mock-TV-2001", orderId: null, url: "https://pay.mock.local/tamara/TV-2001", mock: true } });
  });
});
