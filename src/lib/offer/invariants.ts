/**
 * Offer structural invariants — pure and testable. These GUARD the offer before
 * a PDF is produced; they never mutate. Each rule returns a violation carrying
 * bilingual messages + the offending subjects, so the UI can render in Arabic
 * (default) or English.
 *
 * Rules:
 *   1. sum(cities.nights) === trip nights
 *   2. per city AND per hotel: (check_out - check_in) === nights
 *   3. every hotel line has a room_type AND a board_type
 */

export type InvariantCode =
  | "nights_sum_mismatch"
  | "city_date_mismatch"
  | "hotel_date_mismatch"
  | "hotel_missing_room_or_board";

export type InvariantViolation = {
  code: InvariantCode;
  message_ar: string;
  message_en: string;
  /** offending city/hotel names (or the two numbers for the sum rule). */
  subjects: string[];
};

export type InvariantResult = { ok: boolean; violations: InvariantViolation[] };

export type InvariantCity = {
  city_name: string;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
};

export type InvariantHotel = {
  hotel_name: string | null;
  room_type_id: string | null;
  board_type: string | null;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
};

export type InvariantInput = {
  /** total trip nights (e.g. parsed from the offer duration). */
  trip_nights: number;
  cities: InvariantCity[];
  hotels: InvariantHotel[];
};

/** Whole calendar days between two ISO dates (YYYY-MM-DD). null if unparseable. */
export function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function validateInvariants(input: InvariantInput): InvariantResult {
  const violations: InvariantViolation[] = [];

  // 1) nights sum
  const nightsSum = input.cities.reduce((sum, c) => sum + (c.nights ?? 0), 0);
  if (nightsSum !== input.trip_nights) {
    violations.push({
      code: "nights_sum_mismatch",
      message_ar: `مجموع ليالي المدن (${nightsSum}) لا يطابق ليالي الرحلة (${input.trip_nights}).`,
      message_en: `Sum of city nights (${nightsSum}) does not match trip nights (${input.trip_nights}).`,
      subjects: [String(nightsSum), String(input.trip_nights)],
    });
  }

  // 2a) per-city date span
  const cityDateOff = input.cities.filter((c) => {
    if (!c.check_in || !c.check_out || c.nights == null) return false;
    const span = daysBetween(c.check_in, c.check_out);
    return span != null && span !== c.nights;
  });
  if (cityDateOff.length > 0) {
    const names = cityDateOff.map((c) => c.city_name);
    violations.push({
      code: "city_date_mismatch",
      message_ar: `تواريخ الدخول/الخروج لا تطابق عدد الليالي في: ${names.join("، ")}.`,
      message_en: `Check-in/out dates do not match the night count in: ${names.join(", ")}.`,
      subjects: names,
    });
  }

  // 2b) per-hotel date span
  const hotelDateOff = input.hotels.filter((h) => {
    if (!h.check_in || !h.check_out || h.nights == null) return false;
    const span = daysBetween(h.check_in, h.check_out);
    return span != null && span !== h.nights;
  });
  if (hotelDateOff.length > 0) {
    const names = hotelDateOff.map((h) => h.hotel_name ?? "—");
    violations.push({
      code: "hotel_date_mismatch",
      message_ar: `تواريخ الفندق لا تطابق عدد الليالي في: ${names.join("، ")}.`,
      message_en: `Hotel dates do not match the night count in: ${names.join(", ")}.`,
      subjects: names,
    });
  }

  // 3) every hotel has a room type + board type
  const missingRoomOrBoard = input.hotels.filter(
    (h) => !h.room_type_id || !h.board_type || h.board_type.trim() === "",
  );
  if (missingRoomOrBoard.length > 0) {
    const names = missingRoomOrBoard.map((h) => h.hotel_name ?? "—");
    violations.push({
      code: "hotel_missing_room_or_board",
      message_ar: `يجب تحديد نوع الغرفة ونوع الإقامة لكل فندق: ${names.join("، ")}.`,
      message_en: `Every hotel needs a room type and a board type: ${names.join(", ")}.`,
      subjects: names,
    });
  }

  return { ok: violations.length === 0, violations };
}

/** Convenience: throws with a joined message when any invariant fails. */
export function assertInvariants(input: InvariantInput): void {
  const result = validateInvariants(input);
  if (!result.ok) {
    throw new Error(result.violations.map((v) => v.message_en).join(" | "));
  }
}
