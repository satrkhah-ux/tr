/**
 * Price a supplier rate into a client-ready hotel line — the seam the app calls.
 *
 * Pipeline: normalize (base currency + comparable total + retained excluded
 * surcharges) → select the markup rule → compute SELL at the rule's scope →
 * enforce the supplier floor + minimum margin. The result carries BOTH internal
 * cost fields (net/fx/rate_key/supplier/markup/floor) AND client-safe fields
 * (sell/board/room/cancellation/excluded surcharges/valid_until). Redaction to
 * the client happens later, structurally, in the offer DTO — this module keeps
 * everything so the snapshot has a complete audit trail.
 *
 * Pure and dependency-free (no I/O) — the caller supplies fx rates + rules.
 */

import type { CurrencyRates } from "@/lib/offer/pricing";
import type { BoardType } from "@/lib/types";
import { computeMarkup, selectRule, type BlockReason, type MarkupContext, type MarkupRule, type SellComputation } from "./markup";
import { normalizeRate, type NormalizedRate } from "./normalize";
import type { RoomCategory, SupplierRate, Surcharge } from "./rate-types";

export type PricedHotelLine = {
  // ----- client-safe -----
  hotel_id: string;
  hotel_name: string;
  room_category: RoomCategory;
  board_type: BoardType;
  refundable: boolean;
  cancellation_policy: string;
  /** paid by the guest at the hotel — shown to the client as "يُدفع في الفندق مباشرة". */
  excluded_surcharges: Surcharge[];
  valid_until: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  sell: number;
  sell_currency: string; // base currency
  // ----- internal (cost / audit) -----
  supplier_id: string;
  supplier_name: string;
  rate_key: string;
  /** comparable total (inclusive + mandatory surcharges) in base currency. */
  net: number;
  net_currency: string; // base
  net_source_currency: string;
  fx_rate: number;
  fx_date: string;
  ref_sell_base: number | null;
  markup_amount: number;
  markup_pct: number | null;
  profit: number;
  margin_pct: number | null;
  rule_id: string;
  /** the min-margin the chosen rule imposed — carried so the publish gate can
   *  re-check the actual published sell, not just the sell computed here. */
  rule_min_margin_pct: number | null;
  rounding_applied: boolean;
  /** non-empty BLOCKS publishing (supplier floor or min-margin violation). */
  blocks: BlockReason[];
};

export type PriceRateResult =
  | { ok: true; line: PricedHotelLine; normalized: NormalizedRate }
  | { ok: false; error: "no_fx" | "no_rule" };

/**
 * Normalize → select rule → compute sell (honouring scope) → enforce floors.
 * `no_fx` when the rate currency has no exchange rate (can't be compared/priced);
 * `no_rule` when no rule matches and no default exists.
 */
export function priceSupplierRate(
  rate: SupplierRate,
  rules: MarkupRule[],
  ctx: MarkupContext,
  rates: CurrencyRates,
  base: string,
  fxDate: string,
): PriceRateResult {
  const normalized = normalizeRate(rate, rates, base, fxDate);
  if (!normalized) return { ok: false, error: "no_fx" };

  const rule = selectRule(rules, ctx);
  if (!rule) return { ok: false, error: "no_rule" };

  const roomNights = (normalized.nights || 0) * (normalized.occupancy.rooms || 1);
  const result = computeMarkup(
    [{ key: normalized.rate_key, net: normalized.comparable_total_base, room_nights: roomNights, floor: normalized.ref_sell_base }],
    rule,
    { packageFloor: normalized.ref_sell_base },
  );
  // package scope puts the markup on the total; line scopes on the single line.
  const comp: SellComputation = rule.scope === "package" ? result.total : result.lines[0];

  const line: PricedHotelLine = {
    hotel_id: normalized.hotel_id,
    hotel_name: normalized.hotel_name,
    room_category: normalized.room_category,
    board_type: normalized.board_type,
    refundable: normalized.refundable,
    cancellation_policy: normalized.cancellation_policy,
    excluded_surcharges: normalized.excluded_surcharges,
    valid_until: normalized.valid_until,
    check_in: normalized.check_in,
    check_out: normalized.check_out,
    nights: normalized.nights,
    sell: comp.sell,
    sell_currency: base,
    supplier_id: normalized.supplier_id,
    supplier_name: normalized.supplier_name,
    rate_key: normalized.rate_key,
    net: normalized.comparable_total_base,
    net_currency: base,
    net_source_currency: normalized.currency,
    fx_rate: normalized.fx_rate,
    fx_date: normalized.fx_date,
    ref_sell_base: normalized.ref_sell_base,
    markup_amount: comp.markup_amount,
    markup_pct: comp.markup_pct,
    profit: comp.profit,
    margin_pct: comp.margin_pct,
    rule_id: rule.id,
    rule_min_margin_pct: rule.min_margin_pct,
    rounding_applied: comp.rounding_applied,
    blocks: comp.blocks,
  };
  return { ok: true, line, normalized };
}
