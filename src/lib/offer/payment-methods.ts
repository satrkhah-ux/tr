import { normAr } from "@/lib/catalog/norm";

/**
 * Where the data team's «تقسيط المبلغ» lines (finance-terms.ts) meet session
 * E's payment methods (Tabby / Tamara / MyFatoorah — E owns the list and the
 * fees; the coordinator, 2026-10-29). The country decides WHICH methods show:
 * a country's instalment line that names a method prints it with E's fee note
 * for the offer's total. Only this file will import E's module; the caller is
 * offerFinance (data/offers.ts), on FinanceSection.instalment.
 *
 * Pure: E's list and fee function come in as arguments until they land.
 */
export type MethodLike = { id: string; name: string };
export type FeeFn = (methodId: string, amount: number) => { fee: number; total: number; note: string } | null;

export function withMethodFees(lines: string[], total: number | null, methods: MethodLike[], fee: FeeFn): string[] {
  if (total == null || total <= 0 || methods.length === 0) return lines;
  return lines.map((line) => {
    const text = normAr(line);
    const method = methods.find((m) => {
      const name = normAr(m.name);
      return name.length >= 3 && (text === name || text.startsWith(`${name} `) || text.includes(` ${name} `) || text.endsWith(` ${name}`));
    });
    const quote = method ? fee(method.id, total) : null;
    return quote?.note ? `${line} — ${quote.note}` : line;
  });
}
