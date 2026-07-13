/**
 * Markup engine — pure, dependency-free, unit-tested.
 *
 * Turns a NET (cost) amount in base currency into a client SELL price by:
 *   1. selecting the most specific matching rule (with a default fallback),
 *   2. applying a percentage or fixed markup,
 *   3. rounding per the rule (e.g. up to the nearest 5),
 *   4. enforcing TWO hard floors — the minimum margin, and the supplier's
 *      reference/minimum sell price — BLOCKING (never silently adjusting) when
 *      either is violated.
 *
 * Scope (per-room-per-night / per-hotel-line / full-package) is chosen by the
 * agent via the rule and honoured by `computeMarkup`. Output per line and per
 * offer: net, sell, profit, margin %. Recompute on ANY change — everything here
 * is a pure function of its inputs.
 */

export type MarkupScope = "per_room_night" | "per_hotel_line" | "package";
export type MarkupType = "percentage" | "fixed";
export type CustomerType = "individual" | "corporate" | "vip";

/** How to round a raw sell price. null = no rounding. */
export type RoundingRule = { mode: "up" | "nearest" | "down"; step: number } | null;

export type MarkupRule = {
  id: string;
  scope: MarkupScope;
  markup_type: MarkupType;
  /** percentage (15 = +15%) or a fixed amount in base currency. */
  value: number;
  // ----- match criteria; null = wildcard (matches anything) -----
  country: string | null;
  city: string | null;
  supplier_id: string | null;
  /** exact hotel star rating this rule targets. */
  star_rating: number | null;
  /** inclusive season window as "MM-DD"; supports wrap-around (e.g. 12-01..02-28). */
  season_start: string | null;
  season_end: string | null;
  customer_type: CustomerType | null;
  /** the catch-all fallback used when nothing more specific matches. */
  is_default: boolean;
  // ----- constraints -----
  /** minimum acceptable margin %; a computed margin below this BLOCKS. null = none. */
  min_margin_pct: number | null;
  rounding: RoundingRule;
  /** higher wins among equally-specific matches. */
  priority: number;
};

export type MarkupContext = {
  country: string | null;
  city: string | null;
  supplier_id: string | null;
  stars: number | null;
  /** trip/service date "YYYY-MM-DD" for season matching. */
  date: string | null;
  customer_type: CustomerType | null;
};

export type BlockReason =
  | { code: "below_supplier_floor"; floor: number; sell: number }
  | { code: "below_min_margin"; min_margin_pct: number; margin_pct: number | null }
  /** sell is not a finite, positive number (e.g. a negative fixed markup > net). */
  | { code: "invalid_sell"; sell: number };

export type SellComputation = {
  net: number;
  sell: number;
  markup_amount: number;
  /** effective markup as a % of net (after rounding), or null when net is 0. */
  markup_pct: number | null;
  profit: number;
  /** profit / sell * 100, or null when sell is 0. */
  margin_pct: number | null;
  rounding_applied: boolean;
  /** empty = publishable; any entry BLOCKS publishing. */
  blocks: BlockReason[];
};

const EPS = 1e-9;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- rule selection ----------
function mmdd(date: string | null): string | null {
  if (!date || date.length < 10) return null;
  return date.slice(5, 10); // "MM-DD"
}

/** Whether a "MM-DD" date falls in an inclusive [start, end] window (wrap-aware). */
function inSeason(date: string | null, start: string | null, end: string | null): boolean {
  if (!start || !end) return true; // no season constraint
  const d = mmdd(date);
  if (!d) return false; // rule wants a season but the context has no usable date
  if (start <= end) return d >= start && d <= end;
  return d >= start || d <= end; // wrap-around (Dec → Feb)
}

/** Does a rule's criteria admit this context? (null criteria are wildcards.) */
export function ruleMatches(rule: MarkupRule, ctx: MarkupContext): boolean {
  if (rule.country != null && rule.country !== ctx.country) return false;
  if (rule.city != null && rule.city !== ctx.city) return false;
  if (rule.supplier_id != null && rule.supplier_id !== ctx.supplier_id) return false;
  if (rule.star_rating != null && rule.star_rating !== ctx.stars) return false;
  if (rule.customer_type != null && rule.customer_type !== ctx.customer_type) return false;
  if (!inSeason(ctx.date, rule.season_start, rule.season_end)) return false;
  return true;
}

/** Count of non-wildcard criteria — a more specific rule wins over a broader one. */
function specificity(rule: MarkupRule): number {
  let n = 0;
  if (rule.country != null) n++;
  if (rule.city != null) n++;
  if (rule.supplier_id != null) n++;
  if (rule.star_rating != null) n++;
  if (rule.season_start != null && rule.season_end != null) n++;
  if (rule.customer_type != null) n++;
  return n;
}

/**
 * Pick the rule for a context: the most specific match wins; ties break by
 * priority (higher), then a non-default over a default, then id for
 * determinism. When nothing matches, fall back to the highest-priority default
 * rule. Returns null only when there is no match and no default.
 */
export function selectRule(rules: MarkupRule[], ctx: MarkupContext): MarkupRule | null {
  const matches = rules.filter((r) => ruleMatches(r, ctx));
  if (matches.length > 0) {
    return [...matches].sort(compareRules)[0];
  }
  const defaults = rules.filter((r) => r.is_default);
  if (defaults.length > 0) return [...defaults].sort(compareRules)[0];
  return null;
}

function compareRules(a: MarkupRule, b: MarkupRule): number {
  const bySpec = specificity(b) - specificity(a);
  if (bySpec !== 0) return bySpec;
  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;
  const byDefault = (a.is_default ? 0 : 1) - (b.is_default ? 0 : 1); // prefer non-default
  if (byDefault !== 0) return byDefault;
  return a.id.localeCompare(b.id);
}

// ---------- markup math ----------
/** Raw sell price before rounding/floors. */
export function applyMarkup(net: number, rule: MarkupRule): number {
  if (rule.markup_type === "fixed") return round2(net + rule.value);
  return round2(net * (1 + rule.value / 100));
}

export function applyRounding(amount: number, rounding: RoundingRule): number {
  if (!rounding || !(rounding.step > 0)) return round2(amount);
  const q = amount / rounding.step;
  const stepped =
    rounding.mode === "up" ? Math.ceil(q - EPS) : rounding.mode === "down" ? Math.floor(q + EPS) : Math.round(q);
  return round2(stepped * rounding.step);
}

/**
 * Build a full SellComputation from a known net + sell pair, applying the margin
 * and supplier-floor blocks. Used both by `computeSell` and by scope scaling in
 * `computeMarkup` (where the sell is derived by multiplying a per-unit price).
 */
function evaluateSell(
  net: number,
  sell: number,
  minMarginPct: number | null,
  floor: number | null,
  roundingApplied: boolean,
): SellComputation {
  const finiteSell = Number.isFinite(sell);
  const profit = finiteSell ? round2(sell - net) : 0;
  const markup_pct = finiteSell && net !== 0 ? round2((profit / net) * 100) : null;
  // The UNROUNDED margin drives the floor check; the rounded one is display-only.
  // (Comparing a 2-decimal-rounded margin would let e.g. 9.996% round up to 10.00%
  // and slip past a 10% floor.)
  const rawMargin = finiteSell && sell > 0 ? ((sell - net) / sell) * 100 : null;
  const margin_pct = rawMargin == null ? null : round2(rawMargin);
  const blocks: BlockReason[] = [];
  // Hard guard: a sell must be a finite, POSITIVE number. A negative fixed markup
  // larger than net (or a percentage < -100%) yields sell < 0, whose profit and
  // sell are both negative so the margin looks positive — this catches it.
  if (!finiteSell || sell <= 0) {
    blocks.push({ code: "invalid_sell", sell: finiteSell ? sell : 0 });
  }
  // Hard constraint #1 — supplier reference/minimum sell (rate parity).
  if (floor != null && finiteSell && sell < floor - EPS) {
    blocks.push({ code: "below_supplier_floor", floor: round2(floor), sell });
  }
  // Hard constraint #2 — minimum margin floor (unrounded comparison).
  if (minMarginPct != null && (rawMargin == null || rawMargin < minMarginPct - EPS)) {
    blocks.push({ code: "below_min_margin", min_margin_pct: minMarginPct, margin_pct });
  }
  return { net, sell, markup_amount: profit, markup_pct, profit, margin_pct, rounding_applied: roundingApplied, blocks };
}

/**
 * Re-run the floor/margin/validity checks on a KNOWN net + sell pair (not derived
 * from a rule). The publish gate uses this to re-validate the ACTUAL published
 * sell — which the agent may have edited after pricing — instead of trusting the
 * sell computed at pricing time.
 */
export function sellBlocks(net: number, sell: number, opts: { minMarginPct?: number | null; floor?: number | null }): BlockReason[] {
  return evaluateSell(net, sell, opts.minMarginPct ?? null, opts.floor ?? null, false).blocks;
}

/**
 * Compute a SELL price for a single NET amount: markup → rounding → floor checks.
 * `opts.floor` is the supplier reference/minimum sell (in base currency), if any.
 */
export function computeSell(net: number, rule: MarkupRule, opts?: { floor?: number | null }): SellComputation {
  const raw = applyMarkup(net, rule);
  const sell = applyRounding(raw, rule.rounding);
  return evaluateSell(net, sell, rule.min_margin_pct, opts?.floor ?? null, Math.abs(sell - round2(raw)) > EPS);
}

// ---------- scope-aware offer markup ----------
export type MarkupLineInput = {
  key: string;
  /** line NET (whole stay) in base currency. */
  net: number;
  /** room-nights = rooms * nights, used only for the per-room-night scope. */
  room_nights: number;
  /** supplier floor for this line, in base currency (null = none). */
  floor?: number | null;
};

export type MarkupLineResult = SellComputation & { key: string };

export type OfferMarkupResult = {
  scope: MarkupScope;
  lines: MarkupLineResult[];
  /** package-level rollup (net, sell, profit, margin across all lines). */
  total: SellComputation;
  /** every block from every line and the package — non-empty BLOCKS publishing. */
  blocks: BlockReason[];
};

function sumSell(net: number, sell: number, minMarginPct: number | null, floor: number | null): SellComputation {
  return evaluateSell(round2(net), round2(sell), minMarginPct, floor, false);
}

/**
 * Apply a rule to a set of hotel lines at the rule's chosen scope.
 *  - per_room_night: markup on the per-room-night net, scaled back to the line;
 *  - per_hotel_line: markup on each line's full net;
 *  - package: markup applied ONCE to the summed package net (lines pass through
 *    at net, all profit lands on the package total).
 */
export function computeMarkup(
  lines: MarkupLineInput[],
  rule: MarkupRule,
  opts?: { packageFloor?: number | null },
): OfferMarkupResult {
  const totalNet = round2(lines.reduce((s, l) => s + l.net, 0));

  if (rule.scope === "package") {
    const total = computeSell(totalNet, rule, { floor: opts?.packageFloor ?? null });
    const passthrough: MarkupLineResult[] = lines.map((l) => ({
      key: l.key,
      ...evaluateSell(round2(l.net), round2(l.net), null, l.floor ?? null, false),
    }));
    return { scope: rule.scope, lines: passthrough, total, blocks: [...passthrough.flatMap((l) => l.blocks), ...total.blocks] };
  }

  const results: MarkupLineResult[] = lines.map((l) => {
    if (rule.scope === "per_room_night") {
      const units = l.room_nights > 0 ? l.room_nights : 1;
      const netPerUnit = l.net / units;
      const rawPerUnit = applyMarkup(netPerUnit, rule);
      const sellPerUnit = applyRounding(rawPerUnit, rule.rounding);
      const lineSell = round2(sellPerUnit * units);
      const roundingApplied = Math.abs(sellPerUnit - round2(rawPerUnit)) > EPS;
      return { key: l.key, ...evaluateSell(round2(l.net), lineSell, rule.min_margin_pct, l.floor ?? null, roundingApplied) };
    }
    // per_hotel_line
    return { key: l.key, ...computeSell(l.net, rule, { floor: l.floor ?? null }) };
  });

  const sellTotal = round2(results.reduce((s, r) => s + r.sell, 0));
  const total = sumSell(totalNet, sellTotal, rule.min_margin_pct, opts?.packageFloor ?? null);
  return { scope: rule.scope, lines: results, total, blocks: [...results.flatMap((r) => r.blocks), ...total.blocks] };
}

// ---------- client-safe error text ----------
/** Arabic message for a block, for the publish gate. Numbers are LTR-isolated by the caller. */
export function blockReasonAr(reason: BlockReason): string {
  if (reason.code === "below_supplier_floor") {
    return `سعر البيع (${reason.sell}) أقل من الحد الأدنى للمورّد (${reason.floor}) — لا يمكن النشر.`;
  }
  if (reason.code === "invalid_sell") {
    return `سعر البيع غير صالح (${reason.sell}) — يجب أن يكون رقمًا موجبًا — لا يمكن النشر.`;
  }
  const margin = reason.margin_pct == null ? "—" : `${reason.margin_pct}%`;
  return `هامش الربح (${margin}) أقل من الحد الأدنى المسموح (${reason.min_margin_pct}%) — لا يمكن النشر.`;
}
