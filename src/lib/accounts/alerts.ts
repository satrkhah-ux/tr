/**
 * «الإنذارات المالية» (stage 6, the owner, 2026-10-30: «إصدار قرارات مالية تنبه الادارة اين الاستنزاف
 * المالي و ما اكثر موظف لا يأتي بنتائج مالية»; limits the owner approved the same day). Pure and
 * clock-injected: the home shows them, the morning job sends each new one once (finance_alerts).
 *
 * Every alert carries what a suggested decision needs («اقترح قراراً» → «القرارات الإدارية», issued by
 * the management's own press — never automatically).
 */

export const ALERT_LIMITS = {
  /** a confirmed file of the month earning under this margin, % (a loss always) */
  lowMargin: 5,
  /** a client late on a payment for more than this many days */
  lateDays: 7,
  /** a supplier booking unpaid with its pay-by day this close */
  supplierDays: 3,
  /** expenses up by more than this % on last month while sales are not */
  expensesRise: 20,
  /** a seller under this % of the month's target … */
  targetShare: 50,
  /** … once the month is past this day */
  targetFromDay: 15,
} as const;

export type AlertKind = "expenses" | "margin" | "late" | "supplier" | "target";
export type FinanceAlert = {
  /** unique: one alert, sent once */
  key: string;
  kind: AlertKind;
  title: string;
  detail: string;
  href: string;
  /** what «اقترح قراراً» opens with; null = a matter for the accounts team, not a decision */
  decision: { text: string; employee_id: string | null } | null;
  /** already sent by the operations morning (refund deadlines) — shown here, not sent twice */
  sentElsewhere?: boolean;
};

export type AlertInput = {
  today: string;
  month: string;
  /** this month so far and the whole of last month, riyals */
  expenses: { now: number; last: number };
  sales: { now: number; last: number };
  cases: { id: string; serial: string; client: string; month: string; sale: number; profit: number }[];
  /** clients late on a payment: the oldest day passed */
  late: { id: string; serial: string; client: string; seller: string; due: number; lateDays: number }[];
  /** confirmed supplier bookings not paid yet, with their pay-by day */
  unpaidBookings: { id: string; operation_id: string; serial: string; title: string; supplier: string; payBy: string | null; cost: number }[];
  /** each seller this month against the target */
  sellers: { employee_id: string; name: string; sales: number; target: number | null }[];
};

const sar = (n: number) => `${Math.round(n).toLocaleString("en-US")} ر.س`;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function financeAlerts(i: AlertInput): FinanceAlert[] {
  const L = ALERT_LIMITS;
  const out: FinanceAlert[] = [];

  // the drain: what we spend climbing while what we sell does not
  if (i.expenses.last > 0 && i.expenses.now > i.expenses.last * (1 + L.expensesRise / 100) && i.sales.now <= i.sales.last) {
    const rise = Math.round(((i.expenses.now - i.expenses.last) / i.expenses.last) * 100);
    out.push({
      key: `expenses:${i.month}`,
      kind: "expenses",
      title: `📈 المصروفات أعلى من الشهر الماضي بـ${rise}% والمبيعات لم تزد`,
      detail: `المصروفات ${sar(i.expenses.now)} مقابل ${sar(i.expenses.last)}، والمبيعات ${sar(i.sales.now)} مقابل ${sar(i.sales.last)}.`,
      href: `/accounts/expenses?month=${i.month}`,
      decision: { text: `إيقاف أي مصروف تشغيلي غير ضروري حتى نهاية الشهر، ومراجعة بنود المصروفات (${sar(i.expenses.now)}) مع الإدارة قبل أي صرف جديد، لأن المصروفات زادت ${rise}% عن الشهر الماضي والمبيعات لم تزد.`, employee_id: null },
    });
  }

  // a file sold at a loss, or too thin to carry the company
  for (const c of i.cases) {
    if (c.month !== i.month || !(c.sale > 0)) continue;
    const margin = (c.profit / c.sale) * 100;
    if (margin >= L.lowMargin) continue;
    out.push({
      key: `margin:${c.id}`,
      kind: "margin",
      title: c.profit < 0 ? `🔻 ملف بخسارة: ${c.serial}` : `🔻 هامش ضعيف (${margin.toFixed(1)}%): ${c.serial}`,
      detail: `${c.client || c.serial} — البيع ${sar(c.sale)}، ${c.profit < 0 ? `خسارة ${sar(-c.profit)}` : `الربح ${sar(c.profit)}`}.`,
      href: `/accounts/invoices/${c.id}`,
      decision: { text: `لا يُعتمد بيع بهامش ربح أقل من ${L.lowMargin}% إلا بموافقة الإدارة المسبقة. (الملف ${c.serial} بيع بهامش ${margin.toFixed(1)}%.)`, employee_id: null },
    });
  }

  // money owed past the limit
  for (const d of i.late) {
    if (d.lateDays <= L.lateDays) continue;
    out.push({
      key: `late:${d.id}`,
      kind: "late",
      title: `💳 عميل متأخر ${d.lateDays} يوماً: ${d.client || d.serial}`,
      detail: `الملف ${d.serial} — المتأخر ${sar(d.due)}${d.seller ? `، البائع ${d.seller}` : ""}.`,
      href: `/accounts/invoices/${d.id}`,
      decision: null,
    });
  }

  // a supplier to pay before the booking is lost (the operations morning already reminds — shown, not re-sent)
  for (const b of i.unpaidBookings) {
    if (!b.payBy) continue;
    const left = dayDiff(i.today, b.payBy);
    if (left < 0 || left > L.supplierDays) continue;
    out.push({
      key: `supplier:${b.id}:${b.payBy}`,
      kind: "supplier",
      title: `⏰ ادفع للمورد ${left === 0 ? "اليوم" : left === 1 ? "خلال يوم" : left === 2 ? "خلال يومين" : `خلال ${left} أيام`}: ${b.supplier || b.title}`,
      detail: `${b.title} — الملف ${b.serial}، ${sar(b.cost)}، آخر يوم ${b.payBy}.`,
      href: `/operations/${b.operation_id}`,
      decision: null,
      sentElsewhere: true,
    });
  }

  // the seller furthest from the month's target, once the month is half gone
  if (Number(i.today.slice(8, 10)) >= L.targetFromDay) {
    for (const s of i.sellers) {
      if (!s.target || !(s.target > 0)) continue;
      const share = Math.round((s.sales / s.target) * 100);
      if (share >= L.targetShare) continue;
      out.push({
        key: `target:${s.employee_id}:${i.month}`,
        kind: "target",
        title: `👤 ${s.name} عند ${share}% من هدفه`,
        detail: `المبيعات ${sar(s.sales)} من هدف ${sar(s.target)} وقد مضى نصف الشهر.`,
        href: `/accounts/reports?period=${i.month}`,
        decision: { text: `إنذار أول: مبيعات هذا الشهر ${sar(s.sales)} من هدف ${sar(s.target)} (${share}%). المطلوب الوصول إلى ${L.targetShare}% على الأقل قبل نهاية الشهر، مع خطة متابعة يومية مع مدير المبيعات.`, employee_id: s.employee_id },
      });
    }
  }

  const order: Record<AlertKind, number> = { expenses: 0, supplier: 1, late: 2, margin: 3, target: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
