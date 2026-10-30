/**
 * «عروض الأسعار» in «الحسابات» (stage 4, 2026-10-30): the offers are the quotes — the sales pipeline in money.
 * The month's quotes sent and won, the conversion, and the open ones by how soon they lapse. Riyals
 * (offers.total_sar). Pure and clock-injected.
 */

export type Quote = {
  id: string;
  serial: string;
  client: string;
  seller: string;
  /** the day it was made, YYYY-MM-DD */
  date: string;
  valid_until: string | null;
  status: string;
  /** its value in riyals; null when it was never priced in riyals */
  sar: number | null;
};

export type QuotesView = {
  month: string;
  made: { count: number; value: number };
  won: { count: number; value: number };
  /** won ÷ made in the month, by count */
  conversion: number | null;
  open: (Quote & { lapse: "expired" | "soon" | null })[];
  openValue: number;
};

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export function quotesView(all: Quote[], month: string, today: string): QuotesView {
  const live = all.filter((q) => q.status !== "draft" && q.status !== "cancelled");
  const ofMonth = live.filter((q) => q.date.startsWith(month));
  const won = ofMonth.filter((q) => q.status === "confirmed");
  const sum = (qs: Quote[]) => Math.round(qs.reduce((s, q) => s + (q.sar ?? 0), 0) * 100) / 100;
  const soon = addDays(today, 3);
  const open = live
    .filter((q) => q.status === "sent")
    .map((q) => ({ ...q, lapse: q.valid_until && q.valid_until < today ? ("expired" as const) : q.valid_until && q.valid_until <= soon ? ("soon" as const) : null }))
    // the ones about to lapse first, then the newest
    .sort((a, b) => (a.lapse === "soon" ? 0 : a.lapse === null ? 1 : 2) - (b.lapse === "soon" ? 0 : b.lapse === null ? 1 : 2) || b.date.localeCompare(a.date));
  return {
    month,
    made: { count: ofMonth.length, value: sum(ofMonth) },
    won: { count: won.length, value: sum(won) },
    conversion: ofMonth.length ? Math.round((won.length / ofMonth.length) * 1000) / 10 : null,
    open,
    openValue: sum(open.filter((q) => q.lapse !== "expired")),
  };
}
