/**
 * The decisions of the payment-links job (payment-links-poll.ts), apart from
 * the database and the gateways so they can be tested: which link is asked,
 * when a payment is recorded, who hears what. Pure.
 */

export type LinkRow = {
  id: string;
  operation_id: string;
  provider: "myfatoorah" | "tamara";
  invoice_id: string;
  amount: number;
  currency: string;
  partner: boolean;
  employee_id: string | null;
  client: string;
};

/** null = the gateway did not answer: state unknown, ask again next time. */
export type LinkStatus = { status: "paid" | "pending" | "failed" | "expired"; paidAmount?: number } | null;

export type LinkEvent = { kind: "paid"; amount: number } | { kind: "failed" } | { kind: "expired" };

export type PollDeps = {
  pending(): Promise<LinkRow[]>;
  status(link: LinkRow): Promise<LinkStatus>;
  /** insert the payment ONCE (provider_ref unique) and mark the link paid */
  recordPaid(link: LinkRow, amount: number): Promise<"created" | "duplicate" | "error">;
  /** true only when THIS call moved the link out of pending */
  close(link: LinkRow, to: "failed" | "expired"): Promise<boolean>;
  touch(link: LinkRow): Promise<void>;
  notify(link: LinkRow, what: LinkEvent): Promise<void>;
};

const PROVIDER_AR = { myfatoorah: "ماي فاتورة", tamara: "تمارا" } as const;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** What the seller reads (staff only — the client never gets a message from this job). */
export function linkNotice(link: LinkRow, what: LinkEvent): string {
  const client = link.client.trim() || "العميل";
  const via = PROVIDER_AR[link.provider];
  if (what.kind === "paid") return `دفع ${client} مبلغ ${money(what.amount)} ${link.currency === "SAR" ? "ريال" : link.currency} عبر ${via}`;
  return `رابط سداد ${client} عبر ${via} ${what.kind === "expired" ? "انتهت صلاحيته" : "لم يكتمل"} دون دفع — لم يُسجَّل شيء`;
}

export async function pollLinks(deps: PollDeps): Promise<{ checked: number; paid: number; closed: number }> {
  const out = { checked: 0, paid: 0, closed: 0 };
  for (const link of await deps.pending()) {
    // a partner's client is the partner's (payment-links.ts refuses them too) — never recorded from here
    if (link.partner) continue;
    out.checked += 1;
    const s = await deps.status(link);
    if (!s || s.status === "pending") {
      if (s) await deps.touch(link);
      continue;
    }
    if (s.status === "paid") {
      const amount = s.paidAmount && s.paidAmount > 0 ? Math.round(s.paidAmount * 100) / 100 : link.amount;
      const res = await deps.recordPaid(link, amount);
      // a duplicate was recorded (and announced) by an earlier run — silence
      if (res === "created") {
        out.paid += 1;
        await deps.notify(link, { kind: "paid", amount });
      }
      continue;
    }
    if (await deps.close(link, s.status)) {
      out.closed += 1;
      await deps.notify(link, { kind: s.status });
    }
  }
  return out;
}
