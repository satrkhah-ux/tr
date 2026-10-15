/**
 * The `offers` columns a session may not UPDATE since 0073 (audit H2): who owns
 * the file and what it costs, bills and belongs to.
 *
 *  · OWNER — the partner company and what it owes us: written once, by the
 *    producer (offer-insert.ts), never edited afterwards through any screen.
 *  · MONEY — the total (and its riyal figure) and the customer: editable on
 *    /offers by offers.write, through the service role (actions.ts updateRow).
 *
 * Pure — actions.ts compares a submitted row against the stored one with it.
 */
export const OFFER_OWNER_COLUMNS = ["partner_company_id", "partner_cost"] as const;
export const OFFER_MONEY_COLUMNS = ["total", "total_sar", "customer_id"] as const;
export const OFFER_LOCKED_COLUMNS: readonly string[] = [...OFFER_OWNER_COLUMNS, ...OFFER_MONEY_COLUMNS];

const NUMERIC = new Set(["partner_cost", "total", "total_sar"]);

function norm(column: string, value: unknown): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (NUMERIC.has(column)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : String(value);
  }
  return String(value);
}

/**
 * The locked columns this submission would actually change. A form sends every
 * field it shows, `total` included, so an untouched total is not a change —
 * "1200" from the form and 1200 from the row are the same figure.
 */
export function changedLockedColumns(values: Record<string, unknown>, stored: Record<string, unknown> | null): string[] {
  return OFFER_LOCKED_COLUMNS.filter((column) => column in values && norm(column, values[column]) !== norm(column, stored?.[column]));
}
