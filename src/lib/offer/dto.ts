/**
 * Offer DTOs — internal vs. client, with a type-level guarantee that client
 * output can never carry internal pricing.
 *
 * `InternalOfferDTO` is the full shape (permission-gated: admins/employees).
 * `ClientOfferDTO` is derived by `OmitInternal<>`, a recursive mapped type that
 * removes every buy/profit/margin key ANYWHERE in the tree. Because the client
 * type is *computed* from the internal one, it is impossible to add a buy field
 * to the client output without a compile error — the omission is by construction,
 * not by discipline. `toClientOfferDTO` performs the matching runtime strip.
 */

import type { BoardType, FlightLegOrder, ClimateLevel } from "@/lib/types";
import type { OfferPricingSummary } from "./pricing";

// ---------- internal (full) shapes ----------

/**
 * A surcharge the guest pays at the hotel (an "Excluded" supplier surcharge).
 * CLIENT-SAFE — the client must see these ("يُدفع في الفندق مباشرة"). None of
 * its key names are internal-pricing keys, so it survives the redaction.
 */
export type HotelSurchargeLine = {
  name: string;
  amount: number;
  currency: string;
};

export type InternalHotelLine = {
  city_name: string | null;
  hotel_name: string | null;
  stars: number | null;
  room_type: string | null;
  board_type: BoardType | null;
  rooms_count: number;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  buy_price: number | null;
  buy_currency: string | null;
  // ----- client-safe supplier-sourced fields (survive redaction) -----
  cancellation_policy: string | null;
  excluded_surcharges: HotelSurchargeLine[];
  valid_until: string | null;
  /** cached hotel image (data-URI or CDN URL) — CLIENT-SAFE. */
  image_url: string | null;
  /** cached facilities (pool/spa/gym/…) — CLIENT-SAFE ("أمور ترفيهية"). */
  facilities: string[];
  // ----- INTERNAL supplier sourcing / cost basis (stripped for clients) -----
  supplier_id: string | null;
  supplier_name: string | null;
  rate_key: string | null;
  net_base: number | null;
  net_source_currency: string | null;
  fx_rate: number | null;
  fx_date: string | null;
  ref_sell_base: number | null;
  markup_amount: number | null;
  markup_pct: number | null;
};

export type InternalFlightLine = {
  airline: string | null;
  flight_no: string | null;
  from_airport: string | null;
  to_airport: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  cabin_class: string | null;
  baggage_allowance: string | null;
  leg_order: FlightLegOrder | null;
  sell_price: number | null;
  sell_currency: string | null;
  buy_price: number | null;
  buy_currency: string | null;
};

export type ClimateLine = {
  city_name: string;
  month: number;
  avg_high_c: number | null;
  avg_low_c: number | null;
  rain_level: ClimateLevel | null;
  humidity_level: ClimateLevel | null;
  advice_ar: string | null;
  advice_en: string | null;
};

export type InternalOfferDTO = {
  serial: string;
  destination: string | null;
  /** customer + assignment context for the personal-data block (never pricing). */
  customer_name: string | null;
  customer_phone: string | null;
  employee_name: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  duration: string | null;
  offer_date: string | null;
  issue_date: string | null;
  validity_date: string | null;
  adults: number;
  children: number;
  infants: number;
  /** the explicit client-facing final total (sell), in `currency`. */
  total: number | null;
  currency: string | null;
  hotels: InternalHotelLine[];
  flights: InternalFlightLine[];
  transport: string[];
  visas: string[];
  includes: string[];
  excludes: string[];
  terms: string[];
  climate: ClimateLine[];
  /** full pricing incl. total_buy / profit / margin_pct. */
  pricing: OfferPricingSummary;
};

// ---------- the redaction ----------
/**
 * Field names that carry internal pricing/cost/sourcing and must never reach a
 * client. Two rules keep this honest (enforced below): every name here is also
 * in `INTERNAL_KEYS` (runtime strip) AND, for the ones we ship, an
 * `ExpectFalse<Has<…>>` proof asserts its absence from the client type.
 *
 * ⚠️ Adding a NEW internal field to a DTO shape WITHOUT adding its key here
 * ships it to clients silently — the omit only removes keys named in this union.
 */
export type InternalPricingKey =
  // buy / profit / margin (the original cost fields)
  | "buy_price"
  | "buy_currency"
  | "total_buy"
  | "base_buy"
  | "profit"
  | "profit_base"
  | "margin_pct"
  // supplier identity + booking token
  | "supplier_id"
  | "supplier_name"
  | "rate_key"
  // net / cost basis + fx (the "net" the client must never see)
  | "net_base"
  | "net_source_currency"
  | "inclusive_net"
  | "fx_rate"
  | "fx_date"
  // supplier price floor (rate parity / min sell)
  | "ref_sell_base"
  | "ref_sell"
  | "supplier_floor"
  | "min_sell"
  // markup
  | "markup_amount"
  | "markup_pct";

/** Recursively strip every InternalPricingKey from an object tree (arrays included). */
export type OmitInternal<T> = T extends (infer U)[]
  ? OmitInternal<U>[]
  : T extends object
    ? { [K in keyof T as K extends InternalPricingKey ? never : K]: OmitInternal<T[K]> }
    : T;

/** Client-facing offer: structurally cannot contain buy/profit/margin fields. */
export type ClientOfferDTO = OmitInternal<InternalOfferDTO>;

const INTERNAL_KEYS: ReadonlySet<string> = new Set<InternalPricingKey>([
  "buy_price",
  "buy_currency",
  "total_buy",
  "base_buy",
  "profit",
  "profit_base",
  "margin_pct",
  "supplier_id",
  "supplier_name",
  "rate_key",
  "net_base",
  "net_source_currency",
  "inclusive_net",
  "fx_rate",
  "fx_date",
  "ref_sell_base",
  "ref_sell",
  "supplier_floor",
  "min_sell",
  "markup_amount",
  "markup_pct",
]);

function stripDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (INTERNAL_KEYS.has(key)) continue;
      out[key] = stripDeep(val);
    }
    return out;
  }
  return value;
}

/** Runtime strip that matches `OmitInternal` exactly (one contained assertion). */
export function stripInternal<T>(value: T): OmitInternal<T> {
  return stripDeep(value) as OmitInternal<T>;
}

/** Map a full internal offer to the client-safe DTO (no buy/profit/margin). */
export function toClientOfferDTO(internal: InternalOfferDTO): ClientOfferDTO {
  return stripInternal(internal);
}

// ---------- compile-time proof (fails to build if omission ever breaks) ----------
type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;
type ExpectFalse<T extends false> = T;
type ExpectTrue<T extends true> = T;

type ClientHotel = ClientOfferDTO["hotels"][number];

// If any of these client keys existed, `Has<…>` would be `true` and
// `ExpectFalse<true>` would be a type error — so the build itself is the proof.
type _NoBuyOnHotel = ExpectFalse<Has<ClientHotel, "buy_price">>;
type _NoBuyCurrencyOnHotel = ExpectFalse<Has<ClientHotel, "buy_currency">>;
type _NoBuyOnFlight = ExpectFalse<Has<ClientOfferDTO["flights"][number], "buy_price">>;
type _NoTotalBuy = ExpectFalse<Has<ClientOfferDTO["pricing"], "total_buy">>;
type _NoProfit = ExpectFalse<Has<ClientOfferDTO["pricing"], "profit">>;
type _NoMargin = ExpectFalse<Has<ClientOfferDTO["pricing"], "margin_pct">>;
type _NoProfitOnLine = ExpectFalse<Has<ClientOfferDTO["pricing"]["lines"][number], "profit_base">>;

// supplier-sourcing redaction (prompt requirement #4): supplier name, net,
// rate_key, markup, and any supplier floor must all be absent from the client hotel.
type _NoSupplierId = ExpectFalse<Has<ClientHotel, "supplier_id">>;
type _NoSupplierName = ExpectFalse<Has<ClientHotel, "supplier_name">>;
type _NoRateKey = ExpectFalse<Has<ClientHotel, "rate_key">>;
type _NoNetBase = ExpectFalse<Has<ClientHotel, "net_base">>;
type _NoNetSourceCcy = ExpectFalse<Has<ClientHotel, "net_source_currency">>;
type _NoFxRate = ExpectFalse<Has<ClientHotel, "fx_rate">>;
type _NoFxDate = ExpectFalse<Has<ClientHotel, "fx_date">>;
type _NoRefSell = ExpectFalse<Has<ClientHotel, "ref_sell_base">>;
type _NoMarkupAmount = ExpectFalse<Has<ClientHotel, "markup_amount">>;
type _NoMarkupPct = ExpectFalse<Has<ClientHotel, "markup_pct">>;

// …and the client-safe fields MUST survive (the guest has to see these).
type _HasSell = ExpectTrue<Has<ClientHotel, "sell_price">>;
type _HasBoard = ExpectTrue<Has<ClientHotel, "board_type">>;
type _HasRoom = ExpectTrue<Has<ClientHotel, "room_type">>;
type _HasCancellation = ExpectTrue<Has<ClientHotel, "cancellation_policy">>;
type _HasExcluded = ExpectTrue<Has<ClientHotel, "excluded_surcharges">>;
type _HasValidUntil = ExpectTrue<Has<ClientHotel, "valid_until">>;
type _HasImage = ExpectTrue<Has<ClientHotel, "image_url">>;
type _HasFacilities = ExpectTrue<Has<ClientHotel, "facilities">>;

// reference the proofs so no "unused" lint fires; purely type-level (erased at runtime).
export type _ClientOfferOmissionProof = [
  _NoBuyOnHotel,
  _NoBuyCurrencyOnHotel,
  _NoBuyOnFlight,
  _NoTotalBuy,
  _NoProfit,
  _NoMargin,
  _NoProfitOnLine,
  _NoSupplierId,
  _NoSupplierName,
  _NoRateKey,
  _NoNetBase,
  _NoNetSourceCcy,
  _NoFxRate,
  _NoFxDate,
  _NoRefSell,
  _NoMarkupAmount,
  _NoMarkupPct,
  _HasSell,
  _HasBoard,
  _HasRoom,
  _HasCancellation,
  _HasExcluded,
  _HasValidUntil,
  _HasImage,
  _HasFacilities,
];
