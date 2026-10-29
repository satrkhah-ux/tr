import { describe, expect, it } from "vitest";
import { payDecision, REFUSAL_AR, reusableLink, showsPayNow, type PayFile } from "./pay-now-rules";
import { readAmount, signAmount } from "./pay-token";

const file = (over: Partial<PayFile> = {}): PayFile => ({
  status: "sent",
  partner: false,
  validUntil: "2026-11-05",
  total: 16_869.61,
  currency: "SAR",
  method: "link",
  paid: 0,
  ...over,
});
const today = "2026-10-29";

describe("«ادفع الآن» — what /pay/<serial> charges (the owner, 2026-10-29)", () => {
  it("charges the latest version's total, less what was paid", () => {
    expect(payDecision(file(), undefined, today)).toEqual({ ok: true, amount: 16_869.61 });
    // a re-issue moved the total: the file's NEW total is what the page reads (loadPayFile takes the latest render)
    expect(payDecision(file({ total: 17_500 }), undefined, today)).toEqual({ ok: true, amount: 17_500 });
    expect(payDecision(file({ paid: 5_000 }), undefined, today)).toEqual({ ok: true, amount: 11_869.61 });
  });

  it("refuses a partner's file, a cancelled one, a fully paid one, an expired one", () => {
    expect(payDecision(file({ partner: true }), undefined, today)).toEqual({ ok: false, why: "partner" });
    expect(payDecision(file({ status: "cancelled" }), undefined, today)).toEqual({ ok: false, why: "cancelled" });
    expect(payDecision(file({ paid: 16_869.61 }), undefined, today)).toEqual({ ok: false, why: "paid" });
    expect(payDecision(file({ validUntil: "2026-10-28" }), undefined, today)).toEqual({ ok: false, why: "expired" });
    // a confirmed file's price is fixed — its validity no longer matters
    expect(payDecision(file({ validUntil: "2026-10-28", status: "confirmed" }), undefined, today)).toMatchObject({ ok: true });
    expect(payDecision(null, undefined, today)).toEqual({ ok: false, why: "missing" });
    expect(payDecision(file({ currency: "USD" }), undefined, today)).toEqual({ ok: false, why: "currency" });
  });

  it("the bare link only for a MyFatoorah way; a signed amount works whatever the way", () => {
    expect(showsPayNow("link")).toBe(true);
    expect(showsPayNow("card")).toBe(true);
    expect(showsPayNow("tamara")).toBe(false);
    expect(payDecision(file({ method: "tamara" }), undefined, today)).toEqual({ ok: false, why: "method" });
    expect(payDecision(file({ method: "tamara" }), 2_000, today)).toEqual({ ok: true, amount: 2_000 });
  });

  it("a signed custom amount: honoured up to what is owed; a tampered one is refused", () => {
    const secret = "s3cret";
    const now = Date.parse("2026-10-29T10:00:00Z");
    const token = signAmount(secret, "AD-7-1000", 3_000, now);
    expect(readAmount(secret, "AD-7-1000", token, now)).toBe(3_000);
    // the client edits the amount part of the link
    const [, exp, sig] = token.split(".");
    expect(readAmount(secret, "AD-7-1000", `${(10).toString(36)}.${exp}.${sig}`, now)).toBeNull();
    // moved to another file, or forged without the secret, or past its 30 days
    expect(readAmount(secret, "AD-7-2000", token, now)).toBeNull();
    expect(readAmount("other", "AD-7-1000", token, now)).toBeNull();
    expect(readAmount(secret, "AD-7-1000", token, now + 31 * 86_400_000)).toBeNull();
    expect(readAmount(secret, "AD-7-1000", "garbage", now)).toBeNull();
    // the page: a bad token never falls back to the full total
    expect(payDecision(file(), null, today)).toEqual({ ok: false, why: "badAmount" });
    expect(payDecision(file({ paid: 15_000 }), 3_000, today)).toEqual({ ok: false, why: "badAmount" });
  });

  it("reuses a young invoice of the same amount; a new amount or an old invoice gets a fresh one", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const links = [
      { invoice_id: "1", url: "u1", amount: 16_869.61, mock: false, created_at: "2026-10-29T08:00:00Z" },
      { invoice_id: "2", url: "u2", amount: 16_869.61, mock: false, created_at: "2026-10-27T08:00:00Z" },
      { invoice_id: "3", url: "u3", amount: 16_869.61, mock: true, created_at: "2026-10-29T11:00:00Z" },
    ];
    expect(reusableLink(links, 16_869.61, false, now)?.url).toBe("u1");
    expect(reusableLink(links, 17_500, false, now)).toBeNull();
    expect(reusableLink(links.slice(1), 16_869.61, false, now)).toBeNull();
  });

  it("no refusal the client reads says «رسوم», a fee or a %", () => {
    for (const text of Object.values(REFUSAL_AR)) expect(text).not.toMatch(/رسوم|fee|%/i);
  });
});
