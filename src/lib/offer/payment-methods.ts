import { normAr } from "@/lib/catalog/norm";
import { PAY_METHOD_AR, PAY_METHODS, quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";

/**
 * Where the data team's «تقسيط المبلغ» lines (finance-terms.ts) meet session
 * E's payment methods (Tabby / Tamara / MyFatoorah — E owns the list and the
 * fees; the coordinator, 2026-10-29). The country decides WHICH methods show:
 * a country's instalment line that names a method prints it with E's fee note
 * for the offer's total. Only this file will import E's module; the caller is
 * offerFinance (data/offers.ts), on FinanceSection.instalment.
 *
 * Pure: the fees come in (getPaymentFees, app-settings.ts).
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

/** E's methods by their printed Arabic names — «التقسيط عبر تابي» names تابي. */
export const methodsForFees = (): MethodLike[] => PAY_METHODS.map((m) => ({ id: m, name: PAY_METHOD_AR[m] }));

/** E's quote as the line's note; a method the administration left unset adds nothing. */
export const sessionEFee =
  (fees: PaymentFees): FeeFn =>
  (methodId, amount) => {
    const q = quoteMethod(amount, methodId as PayMethod, fees);
    if (q.unset || q.fee <= 0) return null;
    return { fee: q.fee, total: q.total, note: `الإجمالي عبر ${PAY_METHOD_AR[q.method]} ${q.total.toLocaleString("en-US")} ريال (يشمل رسوم ${q.fee.toLocaleString("en-US")} ريال)` };
  };
