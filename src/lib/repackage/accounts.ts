/**
 * The full accounts of a repackaged file: what the client pays and has paid and
 * still owes, what we owe the supplier and have paid it, and the profit — sell
 * less the supplier's cost — expected at issue and as it stands in cash.
 *
 * Nothing is computed here that the case already computes: the figures are the
 * case's own (operations/money.ts caseProfit, the payments' remainingBalance);
 * this only gives a repackaged file one shape to show them in, before its case
 * exists (the file's own prices) and after (the case's facts). All of it is
 * cost or profit — read only behind pricing.internal. Pure: no React, no Supabase.
 */

import { caseProfit, type CaseFacts, type CaseProfit, type Money } from "@/lib/operations/money";
import { remainingBalance } from "@/lib/operations/payments";
import { clientTotal, type RepackageData } from "./repackage-types";

export type RepackageAccounts = CaseProfit & {
  /** what the client pays — the offer's total. */
  sale: Money | null;
  /** what the client has paid so far, net of refunds. */
  paid: number;
  /** what the client still owes (sale − paid); null before the file is priced. */
  remaining: number | null;
};

/** A confirmed file: the case's own facts (operation-money.ts loadCases). */
export function caseAccounts(c: { facts: CaseFacts; total: number | null; currency: string; paid: number }): RepackageAccounts {
  return {
    ...caseProfit(c.facts),
    sale: c.total != null ? { amount: c.total, currency: c.currency } : null,
    paid: c.paid,
    remaining: remainingBalance(c.total, c.paid),
  };
}

/**
 * A file with no case yet: the sale and the supplier's cost as the file holds
 * them. `cost` is the supplier's price in the sale's currency (offer-input.ts
 * costInSellCurrency) — a profit is a difference, so both sides share one.
 */
export function fileAccounts(data: RepackageData, cost: number | null): RepackageAccounts {
  const total = clientTotal(data);
  const currency = data.final_currency || "SAR";
  return caseAccounts({
    total,
    currency,
    paid: 0,
    facts: {
      sale: total != null ? { amount: total, currency } : null,
      expectedCost: cost != null ? [{ amount: cost, currency }] : [],
      partner: false,
      invoice: null,
      clientPayments: [],
      supplierPayments: [],
      bookings: [],
    },
  });
}
