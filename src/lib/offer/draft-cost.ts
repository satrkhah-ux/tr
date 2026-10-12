import { applyManualProfit } from "./pricing";
import type { DraftData, DraftHotel, DraftHotelSourcing, DraftPricingItem } from "./draft-types";

/**
 * The cost side of a draft, for anyone without pricing.internal.
 *
 * A draft keeps what we pay next to what we charge: every pricing line's buy
 * price and manual profit, and a supplier-priced stay's net, markup and margin.
 * 0047 closed `offer_drafts` to direct reads, so the generator's own actions
 * are the only way out, and these two functions are what they apply — the
 * figures come off on the way to such a browser and are put back from the
 * stored draft on the way in, so hiding them can never wipe them.
 *
 * The supplier's NAME stays: the stay card shows where a price came from, and
 * that is not what it cost.
 */

const SOURCING_COST_KEYS = [
  "rate_key",
  "net_base",
  "net_source_currency",
  "fx_rate",
  "fx_date",
  "ref_sell_base",
  "markup_amount",
  "markup_pct",
  "margin_pct",
  "min_margin_pct",
] as const satisfies readonly (keyof DraftHotelSourcing)[];

type SourcingCostKey = (typeof SOURCING_COST_KEYS)[number];

function withoutSourcingCost(sourcing: DraftHotelSourcing): DraftHotelSourcing {
  const out: Partial<DraftHotelSourcing> = { ...sourcing };
  for (const key of SOURCING_COST_KEYS) delete out[key];
  // The one contained lie: the browser gets the shape minus the cost, and every
  // reader of these keys is behind pricing.internal (StaySummary) or server-side.
  return out as DraftHotelSourcing;
}

function sourcingCost(sourcing: DraftHotelSourcing): Pick<DraftHotelSourcing, SourcingCostKey> {
  return Object.fromEntries(SOURCING_COST_KEYS.map((key) => [key, sourcing[key]])) as Pick<
    DraftHotelSourcing,
    SourcingCostKey
  >;
}

/** The sell the agent sees: a manual profit is applied, exactly as issuing applies it. */
function effectiveSell(item: DraftPricingItem): number | null {
  return applyManualProfit(item.buy_price, item.sell_price, item.profit_pct, item.profit_amount);
}

function withoutItemCost(item: DraftPricingItem): DraftPricingItem {
  // The sell is MATERIALIZED before the buy goes: a line priced as «buy + 15%»
  // would otherwise read as unpriced to someone who cannot see the buy.
  const out: DraftPricingItem = { ...item, buy_price: null, buy_currency: "", sell_price: effectiveSell(item) };
  delete out.profit_pct;
  delete out.profit_amount;
  return out;
}

/** What a viewer without pricing.internal receives. */
export function redactDraftCost(data: DraftData): DraftData {
  // The package-level margin is cost too — the same figure as a line's manual
  // profit, set once for the whole file.
  const { profit: _packageProfit, ...pricing } = data.pricing;
  return {
    ...data,
    hotels: data.hotels.map((h) => (h.sourcing ? { ...h, sourcing: withoutSourcingCost(h.sourcing) } : h)),
    pricing: { ...pricing, items: data.pricing.items.map(withoutItemCost) },
  };
}

const itemKey = (item: DraftPricingItem): string => item.ref || `${item.item_type}|${item.description}`;

/**
 * Pair each incoming line with the stored line it came from.
 *
 * By stay ref / type+description first (in order, so two identical lines pair
 * one-to-one), then by position for a line renamed in place. A line with no
 * partner is new — it was written by someone who could not see a buy price, so
 * it has none.
 */
function pairItems(incoming: DraftPricingItem[], stored: DraftPricingItem[]): (DraftPricingItem | null)[] {
  const used = new Set<number>();
  const byKey = new Map<string, number[]>();
  stored.forEach((item, i) => {
    const list = byKey.get(itemKey(item));
    if (list) list.push(i);
    else byKey.set(itemKey(item), [i]);
  });

  const pairs: (number | null)[] = incoming.map((item) => {
    const i = byKey.get(itemKey(item))?.find((j) => !used.has(j));
    if (i === undefined) return null;
    used.add(i);
    return i;
  });
  incoming.forEach((item, i) => {
    if (pairs[i] === null && i < stored.length && !used.has(i) && stored[i].item_type === item.item_type) {
      used.add(i);
      pairs[i] = i;
    }
  });
  return pairs.map((i) => (i === null ? null : stored[i]));
}

function keepItemCost(item: DraftPricingItem, was: DraftPricingItem | null): DraftPricingItem {
  const kept: DraftPricingItem = {
    ...item,
    buy_price: was?.buy_price ?? null,
    buy_currency: was?.buy_currency ?? item.buy_currency,
  };
  delete kept.profit_pct;
  delete kept.profit_amount;
  // Untouched price → the stored line exactly, profit rule included. A price the
  // agent changed is theirs: the rule that produced the old one no longer applies.
  if (was && item.sell_price === effectiveSell(was)) {
    return {
      ...kept,
      sell_price: was.sell_price,
      ...(was.profit_pct != null ? { profit_pct: was.profit_pct } : {}),
      ...(was.profit_amount != null ? { profit_amount: was.profit_amount } : {}),
    };
  }
  return kept;
}

function keepHotelCost(line: DraftHotel, stored: DraftHotel[]): DraftHotel {
  if (!line.sourcing) return line; // never priced, or the agent changed the product and cleared it
  const was = stored.find((h) => h.id === line.id);
  return {
    ...line,
    sourcing: was?.sourcing
      ? { ...line.sourcing, ...sourcingCost(was.sourcing) }
      : withoutSourcingCost(line.sourcing),
  };
}

/**
 * A save from someone without pricing.internal: their slices, with the cost
 * taken from what is stored and never from the browser.
 */
export function keepDraftCost(slices: Partial<DraftData>, stored: DraftData): Partial<DraftData> {
  const out: Partial<DraftData> = { ...slices };
  if (slices.hotels) out.hotels = slices.hotels.map((line) => keepHotelCost(line, stored.hotels));
  if (slices.pricing) {
    const was = pairItems(slices.pricing.items, stored.pricing.items);
    // The package margin comes from what is stored, never from this browser:
    // it was hidden on read, so a save that omits it must not wipe it, and one
    // that sends it must not set it.
    const { profit: _sentProfit, ...sent } = slices.pricing;
    out.pricing = {
      ...sent,
      items: slices.pricing.items.map((item, i) => keepItemCost(item, was[i])),
      ...(stored.pricing.profit !== undefined ? { profit: stored.pricing.profit } : {}),
    };
  }
  return out;
}
