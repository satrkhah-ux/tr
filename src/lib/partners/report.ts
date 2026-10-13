/**
 * «تقريركم الشهري» (partner order 9) — pure: a month of a partner's offers,
 * how many its clients confirmed, what they were worth, where they went.
 */

export type ReportOffer = {
  issued_on: string; // YYYY-MM-DD
  destination: string | null;
  total: number | null;
  currency: string | null;
  confirmed: boolean;
};

export type MonthReport = {
  month: string; // YYYY-MM
  issued: number;
  confirmed: number;
  /** confirmed ÷ issued, whole percent; null with nothing issued. */
  conversion: number | null;
  /** confirmed value per currency — never summed across them. */
  value: { currency: string; total: number }[];
  top: { name: string; count: number }[];
};

export function monthReport(offers: ReportOffer[], month: string): MonthReport {
  const inMonth = offers.filter((o) => o.issued_on.slice(0, 7) === month);
  const confirmed = inMonth.filter((o) => o.confirmed);
  const value = new Map<string, number>();
  for (const o of confirmed) {
    if (o.total == null) continue;
    const cur = o.currency || "SAR";
    value.set(cur, Math.round(((value.get(cur) ?? 0) + o.total) * 100) / 100);
  }
  const places = new Map<string, number>();
  for (const o of inMonth) {
    const name = (o.destination ?? "").trim();
    if (name) places.set(name, (places.get(name) ?? 0) + 1);
  }
  return {
    month,
    issued: inMonth.length,
    confirmed: confirmed.length,
    conversion: inMonth.length ? Math.round((confirmed.length / inMonth.length) * 100) : null,
    value: [...value.entries()].map(([currency, total]) => ({ currency, total })),
    top: [...places.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"))
      .slice(0, 3),
  };
}

/** This month and the one before it, from a Riyadh date. */
export function lastTwoMonths(today: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return [today.slice(0, 7), prev];
}
