/**
 * «الشروط المالية» — the client PDF's financial section (the owner,
 * 2026-10-29): الحسابات البنكية، شروط الدفع، تقسيط المبلغ. The data team keeps
 * the rows on the terms table (kinds bank / payment / instalment), for every
 * country or one; this turns them into the three paragraphs for one offer.
 *
 * Pure: no database, no clock (the issue date comes in).
 */

export type DueWhen = "confirm" | "after_confirm" | "before_travel";

export type FinanceTerm = {
  kind: "bank" | "payment" | "instalment";
  text: string;
  country_id: string | null;
  /** a bank account: ticked = printed in client files; the others ignore it */
  checked: boolean;
  due_when?: DueWhen | null;
  due_days?: number | null;
  /** of the client's total */
  due_percent?: number | null;
  /** in the offer's currency */
  due_amount?: number | null;
};

export type FinanceSection = { banks: string[]; payments: string[]; instalment: string[] };

export const emptyFinance = (): FinanceSection => ({ banks: [], payments: [], instalment: [] });
export const hasFinance = (f: FinanceSection | undefined): f is FinanceSection =>
  Boolean(f && (f.banks.length || f.payments.length || f.instalment.length));

const days = (n: number) => (n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوماً`);
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * When a payment falls: on confirmation (no date until it is confirmed), N
 * days after it, or N days before travel — that one with its date, never
 * earlier than the day the offer is issued (a trip in a week cannot owe a
 * payment «30 days before travel» in the past: it is due now).
 */
export function dueText(term: Pick<FinanceTerm, "due_when" | "due_days">, travelDate: string | null, issueDate: string | null): string | null {
  const n = Math.max(0, Math.trunc(Number(term.due_days ?? 0)));
  if (term.due_when === "confirm") return "عند تأكيد الحجز";
  if (term.due_when === "after_confirm") return n > 0 ? `خلال ${days(n)} من تأكيد الحجز` : "عند تأكيد الحجز";
  if (term.due_when === "before_travel") {
    if (!travelDate) return n > 0 ? `قبل السفر بـ ${days(n)}` : "قبل السفر";
    let date = addDays(travelDate, -n);
    if (issueDate && date < issueDate) date = issueDate;
    return n > 0 ? `قبل السفر بـ ${days(n)} (${date})` : `قبل السفر (${date})`;
  }
  return null;
}

/** How much: the percent and what it comes to on the total, or the fixed amount. */
export function dueAmount(term: Pick<FinanceTerm, "due_percent" | "due_amount">, total: number | null, currency: string | null): string | null {
  const cur = currency ? ` ${currency}` : "";
  const p = Number(term.due_percent);
  if (term.due_percent != null && p > 0) return total != null && total > 0 ? `${money(p)}% (${money(Math.round(total * p) / 100)}${cur})` : `${money(p)}%`;
  const a = Number(term.due_amount);
  if (term.due_amount != null && a > 0) return `${money(a)}${cur}`;
  return null;
}

/** One offer's section: its country's rows and the all-countries ones, in the data team's order, once each. */
export function financeSection(
  terms: FinanceTerm[],
  ctx: { countryId: string | null; total: number | null; currency: string | null; travelDate: string | null; issueDate: string | null },
): FinanceSection {
  const out = emptyFinance();
  const push = (list: string[], line: string) => {
    if (line && !list.includes(line)) list.push(line);
  };
  for (const t of terms) {
    if (t.country_id !== null && t.country_id !== ctx.countryId) continue;
    const text = t.text.trim();
    if (t.kind === "bank") {
      if (t.checked && text) push(out.banks, text);
    } else if (t.kind === "instalment") {
      push(out.instalment, text);
    } else {
      const parts = [dueText(t, ctx.travelDate, ctx.issueDate), dueAmount(t, ctx.total, ctx.currency)].filter(Boolean);
      push(out.payments, parts.length ? (text ? `${text}: ${parts.join(" — ")}` : parts.join(" — ")) : text);
    }
  }
  return out;
}
