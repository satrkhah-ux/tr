/**
 * A partner's account, in arithmetic only — pure, so it is tested without a
 * database. An invoice is what a confirmed file costs the partner; a payment is
 * money it paid us. Never summed across currencies.
 */

export type LedgerLine = {
  kind: "invoice" | "payment";
  /** ISO date or timestamp — sorted newest first for the statement. */
  at: string;
  /** invoice or receipt number. */
  ref: string;
  amount: number;
  currency: string;
  /** the offer an invoice is for. */
  serial?: string | null;
  /** how a payment was made. */
  method?: string | null;
};

/** What the partner owes per currency: invoices minus payments (negative = in credit). */
export function balances(lines: LedgerLine[]): { currency: string; owed: number }[] {
  const by = new Map<string, number>();
  for (const l of lines) {
    const sign = l.kind === "invoice" ? 1 : -1;
    by.set(l.currency, Math.round(((by.get(l.currency) ?? 0) + sign * l.amount) * 100) / 100);
  }
  return [...by.entries()].map(([currency, owed]) => ({ currency, owed }));
}

/**
 * Would confirming a file of `amount` take the partner past its limit? Counted
 * in the limit's own currency — a file in another currency is not converted
 * here (the limit is a business promise, not an FX estimate), so it does not
 * count against it. No limit, never over.
 */
export function overCredit(
  lines: LedgerLine[],
  next: { amount: number; currency: string },
  limit: { amount: number | null; currency: string },
): boolean {
  if (limit.amount == null || next.currency !== limit.currency) return false;
  const owed = balances(lines).find((b) => b.currency === limit.currency)?.owed ?? 0;
  return owed + next.amount > limit.amount;
}

/** «INV-AD-6-5866-20261013»: one invoice per offer, so the offer's serial numbers it. */
export const invoiceNoFor = (serial: string) => `INV-${serial}`;

/** «RCPT-261013-K7Q2»: the Riyadh day and four characters nobody misreads. */
export function receiptNo(now: Date, random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).replace(/-/g, "").slice(2);
  return `RCPT-${day}-${Array.from({ length: 4 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")}`;
}
