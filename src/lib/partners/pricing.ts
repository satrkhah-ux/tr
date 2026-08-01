/**
 * What a partner company pays us.
 *
 * Pure and tested, because it is the one calculation whose mistakes reach an
 * invoice. It takes OUR SELL price and moves it by the percentage management set
 * for that company — never the buy price, which is not in scope here and is not
 * sent to a partner's browser at all.
 *
 * Two directions, decided per company:
 *   markup     — the partner pays our sell PLUS the percentage. We earn it on
 *                top; they add their own margin after.
 *   commission — the partner pays our sell MINUS the percentage. They sell at
 *                our published price and keep the difference.
 */

export type PriceAdjustKind = "markup" | "commission";

export type PartnerTerms = {
  kind: PriceAdjustKind;
  /** 0–100. Never negative: the direction is `kind`, not the sign. */
  pct: number;
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Our sell → the partner's cost.
 *
 * A commission can never take the price below zero, and a percentage outside
 * 0–100 is treated as no adjustment rather than being applied: a bad number in
 * the settings screen should show a partner our plain price, not a free trip.
 */
export function partnerPrice(ourSell: number, terms: PartnerTerms | null | undefined): number {
  if (!terms || !Number.isFinite(ourSell)) return round2(ourSell);
  const pct = Number(terms.pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return round2(ourSell);

  const factor = terms.kind === "commission" ? 1 - pct / 100 : 1 + pct / 100;
  return round2(Math.max(0, ourSell * factor));
}

/**
 * What the partner earns on a file, from their own point of view.
 *
 * Their margin is what their client pays minus what we charge them — our cost
 * and our margin play no part in it and are not knowable from here.
 */
export function partnerMargin(theirSell: number, theirCost: number): { amount: number; pct: number | null } {
  const amount = round2(theirSell - theirCost);
  const pct = theirSell > 0 ? round2((amount / theirSell) * 100) : null;
  return { amount, pct };
}

/** One line of a partner-facing price breakdown. */
export function describeTerms(terms: PartnerTerms | null | undefined): string {
  if (!terms || terms.pct <= 0) return "بسعرنا المعلن، بلا إضافة";
  return terms.kind === "commission"
    ? `خصم ${terms.pct}% من سعرنا`
    : `إضافة ${terms.pct}% على سعرنا`;
}
