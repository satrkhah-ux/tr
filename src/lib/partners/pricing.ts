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

import { withPackageProfit } from "@/lib/offer/basic";
import { applyManualProfit } from "@/lib/offer/pricing";
import { syncSuggestions, type PriceSource, type SuggestedItem } from "@/lib/offer/pricing-suggest";
import type { DraftData, DraftHotel, DraftPricingItem, PackageProfit } from "@/lib/offer/draft-types";

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
 * A price as this viewer may see it. `terms` null is staff, or our own file: the
 * price goes through untouched. A partner gets partnerPrice — never ours.
 */
export function priceForViewer(ourPrice: number, terms: PartnerTerms | null | undefined): number {
  return terms ? partnerPrice(ourPrice, terms) : ourPrice;
}

/**
 * A pricing sheet for a partner's file (the owner's decision, 2026-10-13: a
 * partner may see prices, always at their own terms).
 *
 * A line WE price goes out at our sell moved by their terms:
 *   a supplier quote — its sell is already ours (markup rules, floor included),
 *     the same figure the stay card shows them;
 *   the lists, a remembered room, a figure staff typed — these hold what we
 *     PAY, so our sell is issuing's: the file's stated profit, else the
 *     administration's default margin, laid on the buy. With no margin to lay
 *     on, the line goes unpriced: cost × their terms is our cost to anyone who
 *     knows their own percentage, and a commission off it sells below cost.
 * A figure the partner typed is theirs and stays as typed — `byPartner` only:
 * staff typing on a partner's file type our cost. No line keeps a buy price or
 * a profit rule — both are ours, and with no buy the stored sell is final.
 */
export function partnerSheet<T extends DraftPricingItem & { source?: PriceSource }>(
  items: T[],
  terms: PartnerTerms,
  ours: { profit: PackageProfit | undefined; rates: Record<string, number>; quote: string; byPartner: boolean },
): T[] {
  const theirs = (item: T) => ours.byPartner && item.source === "typed";
  // neither takes a share of our margin: one is not ours, the other is already a sell
  const unmargined = (item: T) => theirs(item) || item.source === "supplier";
  const sold = withPackageProfit(
    items.map((item) => (unmargined(item) ? { ...item, buy_price: null } : item)),
    ours.profit,
    ours.rates,
    ours.quote,
  );
  return items.map((item, i) => {
    const s = sold[i];
    const sell = applyManualProfit(s.buy_price, s.sell_price, s.profit_pct, s.profit_amount);
    const atCost = s.buy_price != null && sell === s.buy_price;
    const out = {
      ...item,
      buy_price: null,
      buy_currency: "",
      sell_price: sell == null || atCost ? null : theirs(item) ? sell : partnerPrice(sell, terms),
    };
    delete out.profit_pct;
    delete out.profit_amount;
    return out;
  });
}

/**
 * A partner's own file, as issued — the sheet offers.partner_cost totals (0058).
 *
 * Their browser saves the sheet and can lower, drop, re-currency or negate any
 * line on it. So every line WE price (a supplier rate, our lists, a remembered
 * room) comes from `fresh`, the server's suggestion at their terms; only a line
 * we hold no price for (a figure they typed on a card, a visa, a line they
 * added) keeps the figure on their sheet, as they priced it — never negative,
 * never under one unit. One of theirs missing from the sheet comes back
 * unpriced, and the producer refuses it.
 */
export function issuedPartnerSheet(saved: DraftPricingItem[], fresh: SuggestedItem[]): DraftPricingItem[] {
  const key = (i: DraftPricingItem) => (i.ref ? `ref:${i.ref}` : `${i.item_type}:${i.description.trim()}`);
  const mine = (s: SuggestedItem) => s.source === "typed" || s.source === "none";
  // a stay id is free text from their browser: a key one of OUR lines holds stays ours
  const ours = new Set(fresh.filter((s) => !mine(s)).map(key));
  const theirs = new Set(fresh.filter((s) => mine(s) && !ours.has(key(s))).map(key));
  const price = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
  return syncSuggestions(
    saved.map((i) => ({
      ...i,
      overridden: theirs.has(key(i)),
      buy_price: null,
      buy_currency: "",
      sell_price: price(i.sell_price),
      quantity: Math.max(1, Number(i.quantity) || 1),
    })),
    fresh.map((s) => ({ ...s, sell_price: theirs.has(key(s)) ? null : price(s.sell_price) })),
  );
}

/**
 * A supplier-priced stay as a partner sees it. The draft keeps OUR sell on the
 * sourcing (the server's record of the rate); the stay card shows theirs.
 */
export function partnerStays(hotels: DraftHotel[], terms: PartnerTerms): DraftHotel[] {
  return hotels.map((h) =>
    h.sourcing ? { ...h, sourcing: { ...h.sourcing, sell_base: partnerPrice(h.sourcing.sell_base, terms) } } : h,
  );
}

/**
 * A partner's save: each stay's sourcing as stored, so the price they were shown
 * never becomes our sell — and a partner cannot invent a supplier rate.
 */
export function keepOurStays(hotels: DraftHotel[], stored: DraftHotel[]): DraftHotel[] {
  return hotels.map((h) => {
    if (!h.sourcing) return h;
    // the server wrote the rate (selectHotelRate): none of it comes from their browser
    return { ...h, sourcing: stored.find((s) => s.id === h.id)?.sourcing ?? null };
  });
}

/**
 * A staff save of a partner's file: the prices it shows the partner stay theirs.
 *
 * What staff type is ours — a room's cost, a fare, a tour's price, and what the
 * boxes fill in by themselves from our memory and our tours list — and the
 * partner reads these fields back exactly as stored. Our figures reach their
 * file only through the server, at their terms (the pricing suggestion, a
 * supplier rate). So each card's price is the stored one (none when the room
 * or tour itself was changed), and a sheet line carrying a buy — a cost typed
 * at its source — goes unpriced for the suggestion to quote. A sell typed on
 * the sheet itself is a quote to the partner: that sheet is already theirs.
 */
export function keepTheirPrices(sent: Partial<DraftData>, stored: DraftData): Partial<DraftData> {
  const out: Partial<DraftData> = { ...sent };
  if (sent.hotels) {
    out.hotels = sent.hotels.map((h) => {
      const was = stored.hotels.find((s) => s.id === h.id);
      return {
        ...h,
        manual_price: was?.manual_price ?? null,
        manual_currency: was?.manual_currency ?? h.manual_currency,
        rooms: h.rooms.map((r, i) => {
          const same = was?.rooms[i];
          const kept = same && same.room_type_name === r.room_type_name && same.board_type === r.board_type;
          return { ...r, price: kept ? same.price : null };
        }),
      };
    });
  }
  if (sent.flight_booking) {
    const { intl_price, intl_currency, dom_price, dom_currency } = stored.flight_booking;
    out.flight_booking = { ...sent.flight_booking, intl_price, intl_currency, dom_price, dom_currency };
  }
  if (sent.cities) {
    out.cities = sent.cities.map((c, ci) => {
      if (!c.tour_picks) return c;
      const was = (stored.cities[ci]?.city_name === c.city_name ? stored.cities[ci] : stored.cities.find((s) => s.city_name === c.city_name))?.tour_picks;
      return { ...c, tour_picks: c.tour_picks.map((p, i) => ({ ...p, price: was?.[i]?.title === p.title ? was[i].price : null })) };
    });
  }
  if (sent.pricing) {
    out.pricing = {
      ...sent.pricing,
      items: sent.pricing.items.map((item) => (item.buy_price == null ? item : { ...item, buy_price: null, buy_currency: "", sell_price: null })),
    };
  }
  return out;
}

/** A ready offer's seed for a partner: the package price at their terms. */
export function partnerSeed(seed: Partial<DraftData> | null, terms: PartnerTerms): Partial<DraftData> | null {
  if (!seed?.pricing) return seed;
  const { final_total, items, display_currency } = seed.pricing;
  return {
    ...seed,
    pricing: {
      ...seed.pricing,
      final_total: final_total == null ? final_total : partnerPrice(final_total, terms),
      // the package price is already our sell: no margin goes on it
      items: partnerSheet(items ?? [], terms, { profit: undefined, rates: {}, quote: display_currency || "SAR", byPartner: false }),
    },
  };
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
