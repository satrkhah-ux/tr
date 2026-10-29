import { describe, expect, it } from "vitest";
import { parseOrderResponse } from "@/lib/providers/tamara";
import { linkNotice, pollLinks, type LinkRow, type LinkStatus, type PollDeps } from "./payment-links-rules";

const link = (over: Partial<LinkRow> = {}): LinkRow => ({
  id: "l1",
  offer_id: "of1",
  operation_id: "op1",
  serial: "AD-7-1000",
  provider: "myfatoorah",
  invoice_id: "777",
  amount: 16_869.61,
  currency: "SAR",
  partner: false,
  employee_id: "e1",
  client: "محمد أحمد",
  ...over,
});

/** The database as the job sees it: links that leave «pending» once moved, and a payment table unique on provider_ref. */
function world(links: LinkRow[], answer: (l: LinkRow) => LinkStatus, opts: { markFails?: boolean; noCase?: boolean } = {}) {
  const state = new Map(links.map((l) => [l.id, "pending"]));
  const payments: { ref: string; amount: number }[] = [];
  const notices: string[] = [];
  const deps: PollDeps = {
    pending: async () => links.filter((l) => state.get(l.id) === "pending"),
    status: async (l) => answer(l),
    recordPaid: async (l, amount) => {
      const ref = `${l.provider}:${l.invoice_id}`;
      const dup = payments.some((p) => p.ref === ref);
      if (!dup) payments.push({ ref, amount });
      // the link update failing leaves it pending — the next run must still not record twice
      if (!opts.markFails) state.set(l.id, "paid");
      if (opts.noCase) return dup ? "duplicate" : "held";
      return dup ? "duplicate" : "created";
    },
    close: async (l, to) => {
      if (state.get(l.id) !== "pending") return false;
      state.set(l.id, to);
      return true;
    },
    touch: async () => {},
    notify: async (l, what) => {
      notices.push(linkNotice(l, what));
    },
  };
  return { deps, payments, notices, state };
}

describe("payment links recorded by themselves (the owner, 2026-10-29)", () => {
  it("records a paid link ONCE and tells the seller once — even after 3 polls", async () => {
    const w = world([link()], () => ({ status: "paid", paidAmount: 16_869.61 }));
    for (let i = 0; i < 3; i++) await pollLinks(w.deps);
    expect(w.payments).toEqual([{ ref: "myfatoorah:777", amount: 16_869.61 }]);
    expect(w.notices).toEqual(["دفع محمد أحمد مبلغ 16,869.61 ريال عبر ماي فاتورة"]);
  });

  it("still one row when marking the link paid failed and the gateway keeps saying paid", async () => {
    const w = world([link()], () => ({ status: "paid" }), { markFails: true });
    for (let i = 0; i < 3; i++) await pollLinks(w.deps);
    expect(w.payments).toHaveLength(1);
    expect(w.notices).toHaveLength(1);
  });

  it("never touches a partner's case", async () => {
    const w = world([link({ partner: true })], () => ({ status: "paid" }));
    const out = await pollLinks(w.deps);
    expect(out).toEqual({ checked: 0, paid: 0, closed: 0 });
    expect(w.payments).toEqual([]);
    expect(w.notices).toEqual([]);
  });

  it("expired or failed → a staff notice once, nothing recorded; pending or no answer → asked again", async () => {
    const answers: Record<string, LinkStatus> = { a: { status: "expired" }, b: { status: "failed" }, c: { status: "pending" }, d: null };
    const w = world(["a", "b", "c", "d"].map((id) => link({ id, invoice_id: id, provider: "tamara" })), (l) => answers[l.id]);
    await pollLinks(w.deps);
    await pollLinks(w.deps);
    expect(w.payments).toEqual([]);
    expect(w.notices).toEqual([
      "رابط سداد محمد أحمد عبر تمارا انتهت صلاحيته دون دفع — لم يُسجَّل شيء",
      "رابط سداد محمد أحمد عبر تمارا لم يكتمل دون دفع — لم يُسجَّل شيء",
    ]);
    expect([w.state.get("c"), w.state.get("d")]).toEqual(["pending", "pending"]);
  });

  it("records the amount the gateway says was paid, else the link's", async () => {
    const w = world([link({ id: "x", invoice_id: "1" }), link({ id: "y", invoice_id: "2", amount: 500 })], (l) => (l.id === "x" ? { status: "paid", paidAmount: 1000.005 } : { status: "paid" }));
    await pollLinks(w.deps);
    expect(w.payments.map((p) => p.amount)).toEqual([1000.01, 500]);
  });

  it("a link paid before the file has a case: kept once, the seller told it waits for the confirmation", async () => {
    const w = world([link({ operation_id: null })], () => ({ status: "paid", paidAmount: 5_000 }), { noCase: true });
    for (let i = 0; i < 3; i++) await pollLinks(w.deps);
    expect(w.payments).toHaveLength(1);
    expect(w.notices).toEqual(["دفع محمد أحمد مبلغ 5,000 ريال عبر ماي فاتورة — قبل تأكيد الملف؛ يُسجَّل في العمليات عند التأكيد"]);
  });

  it("no staff notice says «رسوم» — and the client gets nothing from this job at all", () => {
    expect(linkNotice(link(), { kind: "paid", amount: 10 })).not.toMatch(/رسوم|%/);
  });
});

describe("Tamara order states", () => {
  it("is paid only once Tamara authorised it", () => {
    expect(parseOrderResponse(200, { status: "authorised", total_amount: { amount: 1200 } })).toEqual({ kind: "ok", data: { status: "paid", paidAmount: 1200, mock: false } });
    expect(parseOrderResponse(200, { status: "fully_captured" })).toMatchObject({ data: { status: "paid" } });
    expect(parseOrderResponse(200, { status: "approved" })).toMatchObject({ data: { status: "pending" } });
    expect(parseOrderResponse(200, { status: "new" })).toMatchObject({ data: { status: "pending" } });
    expect(parseOrderResponse(200, { status: "expired" })).toMatchObject({ data: { status: "expired" } });
    expect(parseOrderResponse(200, { status: "declined" })).toMatchObject({ data: { status: "failed" } });
    expect(parseOrderResponse(404, { message: "not found" })).toMatchObject({ kind: "rejected" });
  });
});
