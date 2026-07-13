/**
 * Supplier rate model — the shape a HOTEL supplier (TBO today; Agoda/Hotelbeds
 * later) returns for one hotel/stay. Everything here is INTERNAL cost data and
 * must never reach a client as-is; the client-safe projection is produced by the
 * offer DTO redaction (src/lib/offer/dto.ts) after markup.
 *
 * The pricing engine (normalize.ts / markup.ts / price-line.ts) consumes these
 * shapes and is N-supplier ready BY DESIGN: `supplier_id` is just a field, and
 * ranking is a pure function over a list of rates from any number of suppliers.
 * Today N = 1; adding a supplier requires ZERO changes to the engine.
 */

import type { BoardType } from "@/lib/types";

/**
 * Whether a surcharge is bundled into the comparable price or paid by the guest
 * at the hotel. "Mandatory" surcharges are ADDED to the comparable total;
 * "Excluded" surcharges are NOT in the total but are retained for client display
 * ("يُدفع في الفندق مباشرة"). Silently dropping an Excluded surcharge is a
 * customer-facing failure — the engine always carries them through.
 */
export type SurchargeCharge = "Mandatory" | "Excluded";

export type Surcharge = {
  /** client-facing name, e.g. "رسوم المنتجع" / "ضريبة السياحة". */
  name: string;
  amount: number;
  currency: string;
  charge: SurchargeCharge;
};

/** Occupancy the rate was quoted for — part of comparability. */
export type Occupancy = {
  adults: number;
  children: number;
  rooms: number;
};

/**
 * Canonical room categories. Raw supplier labels (Arabic + English, wildly
 * inconsistent across suppliers) collapse to one of these so two rates are only
 * ever compared when they are genuinely the same class of room.
 */
export type RoomCategory =
  | "standard"
  | "superior"
  | "deluxe"
  | "junior_suite"
  | "suite"
  | "family"
  | "other";

/**
 * One rate from ONE supplier for ONE hotel/stay. All monetary amounts are in
 * `currency`. This is cost/net data — INTERNAL.
 */
export type SupplierRate = {
  supplier_id: string; // stable id, e.g. "tbo"
  supplier_name: string; // display, e.g. "TBO Holidays"
  /** opaque supplier booking token — internal, never client-facing. */
  rate_key: string;
  hotel_id: string;
  hotel_name: string;
  /** local hotel calendar dates "YYYY-MM-DD". */
  check_in: string;
  check_out: string;
  occupancy: Occupancy;
  /** raw supplier room label, normalized to a RoomCategory during comparison. */
  room_category_raw: string;
  board_type: BoardType;
  refundable: boolean;
  /** client-facing cancellation policy text. */
  cancellation_policy: string;
  /** NET inclusive-of-taxes amount for the whole stay, in `currency`. */
  inclusive: number;
  currency: string;
  surcharges: Surcharge[];
  /**
   * Supplier reference / minimum sell price (rate parity floor) in `currency`,
   * or null when the supplier imposes none. The computed SELL must be >= this.
   */
  ref_sell: number | null;
  /** rate validity expiry "YYYY-MM-DD", or null. */
  valid_until: string | null;
};
