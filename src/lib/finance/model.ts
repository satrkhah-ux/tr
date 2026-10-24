/**
 * «الحسابات المالية» — the company's fixed costs and what it owes (the owner, 2026-10-24:
 * «افتح حسابات ماليا … اعمل محليا فقط … اجعل امكانية التعديل و الحساب و التنظيم من داخل النظام»).
 *
 * Pure: the page computes from it while editing, the server validates the saved book with it.
 * The book itself is a local file (FINANCE_DATA_FILE), never a table and never the repository.
 */

export type Rent = {
  id: string; name: string;
  /** the year's total, SAR */
  yearly: number;
  /** months between payments: 1, 3, 6 or 12 */
  every: number;
  /** the month (1–12) of the first payment in the cycle */
  startMonth: number;
  note: string;
};
export type Staff = {
  id: string; name: string; job: string; team: string; place: string; salary: number; note: string;
  /** "YYYY-MM": the first month with no salary (service stopped); "" = staying */
  stopFrom: string;
  /** "YYYY-MM": the first month paid (a salary that changed is two rows: the old one stops, the new one starts); "" = always */
  startFrom: string;
};
export type DebtKind = "supplier" | "rent" | "salary" | "installment" | "other";
export type DebtPayment = { id: string; date: string; amount: number; note: string };
export type Debt = {
  id: string; creditor: string; kind: DebtKind;
  /** what was owed when it was entered, SAR */
  amount: number;
  /** a fixed monthly instalment; 0 = paid when we can, not scheduled */
  monthly: number;
  payments: DebtPayment[]; note: string;
};
/** one sold booking: its net profit feeds the treasury share at once and the partners each quarter */
export type Booking = { id: string; date: string; title: string; seller: string; sale: number; cost: number; note: string };
export type Partner = { id: string; name: string; share: number };
/** any other cost (ads, bills, fees, an end-of-service settlement): deducted in its quarter before the partners' split */
export type Expense = { id: string; date: string; title: string; amount: number; note: string };
export type FinanceBook = {
  rents: Rent[]; staff: Staff[]; debts: Debt[];
  bookings: Booking[]; partners: Partner[]; expenses: Expense[];
  /** what was taken OUT of the treasury (a debt paid from it…) — the balance is what came in minus these */
  treasuryOut: Expense[];
  /** % of each booking's net profit that goes straight to the company treasury */
  reservePct: number;
  updatedAt: string;
};

export const DEBT_KINDS: Record<DebtKind, string> = {
  supplier: "موردون", rent: "إيجارات", salary: "رواتب متأخرة", installment: "أقساط", other: "أخرى",
};
export const EVERY: Record<number, string> = { 1: "شهرياً", 3: "كل 3 أشهر", 6: "كل 6 أشهر", 12: "سنوياً" };
export const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// `|| 0`: a sum that ends a hair below zero rounds to -0, which prints «-0»
export const sar = (n: number) => `${(Math.round(n) || 0).toLocaleString("en-US")} ريال`;

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const thisMonth = () => { const d = new Date(); return ym(d.getFullYear(), d.getMonth() + 1); };
/** is this salary paid in month `at` ("YYYY-MM")? */
export const paidIn = (s: Staff, at: string) => (!s.startFrom || s.startFrom <= at) && (!s.stopFrom || at < s.stopFrom);

/** every row (past and future ones too), each team's total counting only the salaries paid this month */
export function payrollByTeam(staff: Staff[], at = thisMonth()) {
  const teams = new Map<string, Staff[]>();
  for (const s of staff) teams.set(s.team || "بلا فريق", [...(teams.get(s.team || "بلا فريق") ?? []), s]);
  return [...teams].map(([team, people]) => ({ team, people, total: sum(people.filter((p) => paidIn(p, at)).map((p) => p.salary)) }));
}

/** what this rent asks for in this month (1–12): a share of the year on its payment months, else 0 */
export function rentDue(r: Rent, month: number): number {
  return (((month - r.startMonth) % r.every) + r.every) % r.every === 0 ? (r.yearly * r.every) / 12 : 0;
}

export const debtPaid = (d: Debt) => sum(d.payments.map((p) => p.amount));
export const debtLeft = (d: Debt) => Math.max(0, d.amount - debtPaid(d));

export type PlanMonth = { year: number; month: number; salaries: number; rents: { name: string; amount: number }[]; installments: number; total: number };

/** the next `count` months from (year, month): salaries, the rents due, and the instalments while a debt lasts */
/** salaries owed for that month: whoever has started and not stopped by then */
export const salariesIn = (staff: Staff[], y: number, m: number) => sum(staff.filter((s) => paidIn(s, ym(y, m))).map((s) => s.salary));

export function monthPlan(book: FinanceBook, year: number, month: number, count = 12): PlanMonth[] {
  const left = book.debts.map((d) => (d.monthly > 0 ? debtLeft(d) : 0));
  const out: PlanMonth[] = [];
  for (let i = 0; i < count; i++) {
    const m = ((month - 1 + i) % 12) + 1;
    const y = year + Math.floor((month - 1 + i) / 12);
    const rents = book.rents.map((r) => ({ name: r.name, amount: rentDue(r, m) })).filter((r) => r.amount > 0);
    const salaries = salariesIn(book.staff, y, m);
    let installments = 0;
    book.debts.forEach((d, k) => { const pay = Math.min(d.monthly, left[k]); left[k] -= pay; installments += pay; });
    out.push({ year: y, month: m, salaries, rents, installments, total: salaries + installments + sum(rents.map((r) => r.amount)) });
  }
  return out;
}

export function summary(book: FinanceBook, at = thisMonth()) {
  const paid = book.staff.filter((s) => paidIn(s, at));
  const salaries = sum(paid.map((s) => s.salary));
  const stopping = paid.filter((s) => s.stopFrom);
  const salariesAfter = salaries - sum(stopping.map((s) => s.salary));
  const rentsMonthly = sum(book.rents.map((r) => r.yearly / 12));
  const installments = sum(book.debts.map((d) => Math.min(d.monthly, debtLeft(d))));
  const byKind = (Object.keys(DEBT_KINDS) as DebtKind[])
    .map((kind) => ({ kind, label: DEBT_KINDS[kind], left: sum(book.debts.filter((d) => d.kind === kind).map(debtLeft)) }))
    .filter((k) => k.left > 0);
  return { salaries, salariesAfter, stopping: stopping.length, rentsMonthly, installments, monthly: salaries + rentsMonthly + installments, debtLeft: sum(book.debts.map(debtLeft)), debtPaid: sum(book.debts.map(debtPaid)), byKind };
}

// ── profits: 20% of each booking to the treasury, the rest after the quarter's fixed costs to the partners ──
export const bookingProfit = (b: Booking) => b.sale - b.cost;
export const bookingReserve = (b: Booking, pct: number) => (Math.max(0, bookingProfit(b)) * pct) / 100;

/** what the company must pay in a month regardless of sales: salaries then, rents due then, running instalments */
export function fixedCostIn(book: FinanceBook, y: number, m: number): number {
  return salariesIn(book.staff, y, m) + sum(book.rents.map((r) => rentDue(r, m))) + sum(book.debts.filter((d) => debtLeft(d) > 0).map((d) => d.monthly));
}

export type Quarter = {
  year: number; q: number; bookings: number; profit: number; reserve: number; fixed: number; other: number;
  /** profit − treasury share − fixed costs − other expenses (the owner: «بعد خصم كل المصاريف»); split only when positive */
  distributable: number; shares: { name: string; amount: number }[];
};
export function quarter(book: FinanceBook, year: number, q: number): Quarter {
  const first = (q - 1) * 3 + 1;
  const months = [first, first + 1, first + 2];
  const within = (date: string) => date.startsWith(`${year}-`) && months.includes(Number(date.slice(5, 7)));
  const inQ = book.bookings.filter((b) => within(b.date));
  const profit = sum(inQ.map(bookingProfit));
  const reserve = sum(inQ.map((b) => bookingReserve(b, book.reservePct)));
  const fixed = sum(months.map((m) => fixedCostIn(book, year, m)));
  const other = sum(book.expenses.filter((e) => within(e.date)).map((e) => e.amount));
  const distributable = profit - reserve - fixed - other;
  return { year, q, bookings: inQ.length, profit, reserve, fixed, other, distributable,
    shares: book.partners.map((p) => ({ name: p.name, amount: distributable > 0 ? (distributable * p.share) / 100 : 0 })) };
}
export const treasuryIn = (book: FinanceBook) => sum(book.bookings.map((b) => bookingReserve(b, book.reservePct)));
export const treasuryOut = (book: FinanceBook) => sum(book.treasuryOut.map((x) => x.amount));
/** the treasury's balance today: every booking's share in, every withdrawal out (the owner, 2026-10-24: «خزينة الشركة 0 حاليا لانها سددت ديون سابقة») */
export const treasury = (book: FinanceBook) => treasuryIn(book) - treasuryOut(book);
/** the bookings' monthly net profit that covers this month's fixed costs after the treasury share */
export const breakEven = (book: FinanceBook, y: number, m: number) => fixedCostIn(book, y, m) / (1 - book.reservePct / 100);

// ── the server's check of a saved book: everything it writes passes through here ──
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
const id = (v: unknown): v is string => str(v, 64) && v.length > 0;
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = <T>(v: unknown, ok: (x: unknown) => x is T, max = 2000): v is T[] => Array.isArray(v) && v.length <= max && v.every(ok);

const isRent = (r: unknown): r is Rent => rec(r) && id(r.id) && str(r.name) && money(r.yearly) && [1, 3, 6, 12].includes(r.every as number)
  && Number.isInteger(r.startMonth) && (r.startMonth as number) >= 1 && (r.startMonth as number) <= 12 && str(r.note, 1000);
const isStaff = (s: unknown): s is Staff => rec(s) && id(s.id) && str(s.name) && str(s.job) && str(s.team) && str(s.place) && money(s.salary) && str(s.note, 1000)
  && [s.stopFrom, s.startFrom].every((v) => v === undefined || v === "" || (str(v, 7) && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)));
const isPayment = (p: unknown): p is DebtPayment => rec(p) && id(p.id) && str(p.date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(p.date as string) && money(p.amount) && str(p.note, 1000);
const isBooking = (b: unknown): b is Booking => rec(b) && id(b.id) && str(b.date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(b.date as string)
  && str(b.title) && str(b.seller) && money(b.sale) && money(b.cost) && str(b.note, 1000);
const isExpense = (e: unknown): e is Expense => rec(e) && id(e.id) && str(e.date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(e.date as string) && str(e.title) && money(e.amount) && str(e.note, 1000);
const isPartner = (p: unknown): p is Partner => rec(p) && id(p.id) && str(p.name) && typeof p.share === "number" && p.share >= 0 && p.share <= 100;
const isDebt = (d: unknown): d is Debt => rec(d) && id(d.id) && str(d.creditor) && typeof d.kind === "string" && d.kind in DEBT_KINDS
  && money(d.amount) && money(d.monthly) && list(d.payments, isPayment) && str(d.note, 1000);

export function parseBook(v: unknown): FinanceBook | null {
  if (!rec(v) || !list(v.rents, isRent) || !list(v.staff, isStaff) || !list(v.debts, isDebt) || !str(v.updatedAt, 40)) return null;
  // books saved before the profits tab carry no bookings, partners or treasury share
  const bookings = v.bookings ?? [], partners = v.partners ?? [], expenses = v.expenses ?? [], reservePct = v.reservePct ?? 20, out = v.treasuryOut ?? [];
  if (!list(bookings, isBooking, 20000) || !list(partners, isPartner, 20) || !list(expenses, isExpense, 20000) || !list(out, isExpense, 20000)
    || typeof reservePct !== "number" || reservePct < 0 || reservePct > 100) return null;
  // books saved before «يتوقف من» / «يبدأ من» existed carry no stopFrom / startFrom
  return { rents: v.rents, staff: v.staff.map((s) => ({ ...s, stopFrom: s.stopFrom ?? "", startFrom: s.startFrom ?? "" })), debts: v.debts, bookings, partners, expenses, treasuryOut: out, reservePct, updatedAt: v.updatedAt };
}
