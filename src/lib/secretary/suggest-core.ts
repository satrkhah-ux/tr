import type { DraftData, DraftHotel } from "@/lib/offer/draft-types";
import { normAr } from "@/lib/catalog/norm";

/**
 * «العروض المقترحة الأرخص» (the owner, 2026-10-24, order 2 phase ج) — the pure
 * half. Same cities, same dates, same route, same rooms and boards: ONLY the
 * hotel of a stay may change, to one with the SAME stars and a KNOWN cheaper
 * per-night price (the company's own rate memory — never a guess, never a
 * lower class). A city with nothing cheaper keeps its original hotel.
 */

/** `rates`: per `${room_type_name}|${board or ''}`, the remembered per-night BUY price. */
export type CandidateHotel = {
  id: string;
  name: string;
  stars: number | null;
  rates: Record<string, { perNight: number; currency: string }>;
};

export const rateKey = (roomTypeName: string, board: string | null | undefined) => `${roomTypeName.trim()}|${board?.trim() ?? ""}`;
const fold = (s: string) => normAr(s).replace(/^ال/, "");

type Priced = { hotel: CandidateHotel; perNightTotal: number; currency: string };

/** What one night of this stay's rooms costs at `hotel` — null when any room's rate is unknown or currencies mix. */
export function stayPerNight(stay: DraftHotel, hotel: CandidateHotel): { perNightTotal: number; currency: string } | null {
  let total = 0;
  let currency: string | null = null;
  for (const room of stay.rooms ?? []) {
    const rate = hotel.rates[rateKey(room.room_type_name, room.board_type)];
    if (!rate) return null;
    if (currency && currency !== rate.currency) return null;
    currency = rate.currency;
    total += rate.perNight;
  }
  return currency && (stay.rooms ?? []).length ? { perNightTotal: total, currency } : null;
}

/**
 * The cheaper same-star hotels for one stay, cheapest first. The baseline is
 * the ORIGINAL hotel's own remembered rate when it has one (same source, same
 * fairness), else the stay's typed per-night cost; no baseline → nothing is
 * proposed for this stay.
 */
export function cheaperForStay(stay: DraftHotel, nights: number, candidates: CandidateHotel[]): Priced[] {
  const original =
    candidates.find((c) => (stay.hotel_id && c.id === stay.hotel_id) || fold(c.name) === fold(stay.hotel_name)) ?? null;
  const stars = original?.stars ?? null;
  if (!stars) return []; // unknown class: never swap blind

  let base = original ? stayPerNight(stay, original) : null;
  if (!base) {
    const typed = (stay.rooms ?? []).reduce((n, r) => (n == null || r.price == null ? null : n + r.price), 0 as number | null);
    const pricedNights = stay.priced_nights && stay.priced_nights > 0 ? stay.priced_nights : nights;
    if (typed != null && pricedNights > 0) base = { perNightTotal: typed / pricedNights, currency: stay.manual_currency?.trim() || "SAR" };
  }
  if (!base || base.perNightTotal <= 0) return [];
  const b = base;

  return candidates
    .filter((c) => c.stars === stars && c.id !== original?.id && fold(c.name) !== fold(stay.hotel_name))
    .map((c) => ({ hotel: c, priced: stayPerNight(stay, c) }))
    .filter((x): x is { hotel: CandidateHotel; priced: { perNightTotal: number; currency: string } } => Boolean(x.priced))
    .filter((x) => x.priced.currency === b.currency && x.priced.perNightTotal < b.perNightTotal)
    .sort((a, b) => a.priced.perNightTotal - b.priced.perNightTotal)
    .map((x) => ({ hotel: x.hotel, perNightTotal: x.priced.perNightTotal, currency: x.priced.currency }));
}

export type Suggestion = { data: DraftData; swapped: { city: string; from: string; to: string; stars: number }[] };

/**
 * Up to `count` variants: variant k takes each stay's k-th cheapest alternative
 * (falling back to its cheapest, else the original). A variant that swaps
 * nothing, or repeats an earlier one, is dropped.
 */
export function buildSuggestions(draft: DraftData, marketByCityKey: Map<string, CandidateHotel[]>, count = 2): Suggestion[] {
  const nightsOf = new Map(draft.cities.map((c) => [c.key, c.nights]));
  const options = draft.hotels.map((stay) => ({
    stay,
    cheaper: cheaperForStay(stay, Math.max(nightsOf.get(stay.city_key) ?? 0, 1), marketByCityKey.get(stay.city_key ?? "") ?? []),
  }));

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < count; k += 1) {
    const swapped: Suggestion["swapped"] = [];
    const data: DraftData = JSON.parse(JSON.stringify(draft)) as DraftData;
    data.produced_serial = null;
    data.hotels = data.hotels.map((stay, i) => {
      const pick = options[i].cheaper[k] ?? options[i].cheaper[0];
      if (!pick) return stay;
      const nights = Math.max(nightsOf.get(stay.city_key) ?? 0, 1);
      swapped.push({ city: stay.city_name, from: stay.hotel_name, to: pick.hotel.name, stars: pick.hotel.stars ?? 0 });
      return {
        ...stay,
        hotel_id: pick.hotel.id,
        hotel_name: pick.hotel.name,
        manual_price: null,
        priced_nights: nights,
        rooms: (stay.rooms ?? []).map((r) => {
          const rate = pick.hotel.rates[rateKey(r.room_type_name, r.board_type)];
          return { ...r, price: rate ? Math.round(rate.perNight * nights * 100) / 100 : null };
        }),
      };
    });
    if (!swapped.length) break;
    // a locked ready-offer total belongs to the ORIGINAL hotels — the variant prices from its own lines
    if (data.pricing.final_total != null) Object.assign(data, { pricing: { ...data.pricing, final_total: null }, source: null });
    const sig = JSON.stringify(swapped);
    if (seen.has(sig)) break;
    seen.add(sig);
    out.push({ data, swapped });
  }
  return out;
}
