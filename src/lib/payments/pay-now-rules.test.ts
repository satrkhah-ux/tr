import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTamaraLimits, payButtonFor, payDecision, REFUSAL_AR, reusableLink, showsPayNow, TAMARA_REUSE_MS, withinTamara, type PayFile } from "./pay-now-rules";
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

describe("«ادفع بتمارا» — the Tamara button and page (the owner, 2026-10-29)", () => {
  it("one button per offer: the way it was issued with; Tabby and the office ways get none", () => {
    expect(payButtonFor("tamara")).toBe("tamara");
    expect(payButtonFor("link")).toBe("myfatoorah");
    expect(payButtonFor("card")).toBe("myfatoorah");
    for (const m of ["tabby", "cash", "transfer", "pos", null] as const) expect(payButtonFor(m)).toBeNull();
  });

  it("the Tamara session is for what is owed — the latest version less what was paid", () => {
    const tamara = file({ method: "tamara" });
    expect(payDecision(tamara, undefined, today, "tamara")).toEqual({ ok: true, amount: 16_869.61 });
    expect(payDecision({ ...tamara, total: 17_500, paid: 2_500 }, undefined, today, "tamara")).toEqual({ ok: true, amount: 15_000 });
    // a MyFatoorah offer's bare link cannot be opened as Tamara (its total carries no Tamara charge)
    expect(payDecision(file({ method: "link" }), undefined, today, "tamara")).toEqual({ ok: false, why: "method" });
    expect(payDecision(tamara, undefined, today, "myfatoorah")).toEqual({ ok: false, why: "method" });
    expect(payDecision(file({ method: "tamara", partner: true }), undefined, today, "tamara")).toEqual({ ok: false, why: "partner" });
  });

  it("a signed amount is bound to its gateway: a Tamara link's amount does not open MyFatoorah, nor back", () => {
    const secret = "s3cret";
    const now = Date.parse("2026-10-29T10:00:00Z");
    const t = signAmount(secret, "AD-7-1000", 4_000, now, "tamara");
    expect(readAmount(secret, "AD-7-1000", t, now, "tamara")).toBe(4_000);
    expect(readAmount(secret, "AD-7-1000", t, now)).toBeNull();
    expect(readAmount(secret, "AD-7-1000", signAmount(secret, "AD-7-1000", 4_000, now), now, "tamara")).toBeNull();
  });

  it("a pending Tamara session is reused for the same amount within half an hour only", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const young = { invoice_id: "o1", url: "t1", amount: 5_000, mock: false, created_at: "2026-10-29T11:45:00Z" };
    const old = { invoice_id: "o2", url: "t2", amount: 5_000, mock: false, created_at: "2026-10-29T11:00:00Z" };
    expect(reusableLink([young, old], 5_000, false, now, TAMARA_REUSE_MS)?.url).toBe("t1");
    expect(reusableLink([old], 5_000, false, now, TAMARA_REUSE_MS)).toBeNull();
    expect(reusableLink([young], 5_100, false, now, TAMARA_REUSE_MS)).toBeNull();
  });

  it("Tamara's limits, read from its payment types", () => {
    const limits = parseTamaraLimits([
      { name: "PAY_BY_INSTALMENTS", min_limit: { amount: 99, currency: "SAR" }, max_limit: { amount: 20_000, currency: "SAR" } },
      { name: "PAY_NOW", min_limit: { amount: 1, currency: "SAR" }, max_limit: { amount: 30_000, currency: "SAR" } },
    ]);
    expect(limits).toEqual({ min: 1, max: 30_000 });
    expect(withinTamara(31_000, limits)).toBe(false);
    expect(withinTamara(5_000, limits)).toBe(true);
    // unreadable limits never block — Tamara's own checkout decides
    expect(parseTamaraLimits({ message: "x" })).toBeNull();
    expect(withinTamara(31_000, null)).toBe(true);
  });

  it("the page Tamara returns to never records a payment — it reads and writes nothing", () => {
    const src = readFileSync(join(__dirname, "../../app/pay/[serial]/done/page.tsx"), "utf8");
    expect(src).not.toMatch(/supabase|payment_links|insert|update\(|@\/lib\/(data|payments|operations)/);
    expect(src).toContain("تم استلام طلبك");
    expect(src).toContain("لم يكتمل الدفع");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/رسوم|%/);
  });
});
