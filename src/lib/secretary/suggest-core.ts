import type { DraftData, DraftHotel } from "@/lib/offer/draft-types";
import { normAr } from "@/lib/catalog/norm";

/**
 * «العروض المقترحة الأرخص» (the owner, 2026-10-24 + 2026-10-26) — the pure half.
 * Same cities, same dates, same route, same rooms and boards: ONLY the hotel of
 * a stay may change, to one with the SAME stars and a KNOWN cheaper price. The
 * alternatives now come from pluggable sources (suggest-sources.ts): the
 * company's own rate memory writes its trusted prices into the variant; an
 * external supplier's quote (TBO) writes NO price — the employee verifies and
 * types it, and until then the file cannot issue. Nothing is ever guessed.
 */

/** per `${room_type_name}|${board or ''}`: the remembered per-night BUY price (the memory source's market). */
export type CandidateHotel = {
  id: string;
  name: string;
  stars: number | null;
  rates: Record<string, { perNight: number; currency: string }>;
};

export const rateKey = (roomTypeName: string, board: string | null | undefined) => `${roomTypeName.trim()}|${board?.trim() ?? ""}`;
const fold = (s: string) => normAr(s).replace(/^ال/, "");

/** One cheaper same-star hotel for one stay, whichever source found it. */
export type StayAlternative = {
  source: "memory" | "tbo";
  /** the catalogue hotel (memory), or null for a supplier hotel not yet ours */
  hotelId: string | null;
  supplierHotelId: string | null;
  hotelName: string;
  stars: number;
  /** the whole stay in SAR, rounded — ranking and the message only, never written as a price */
  staySar: number;
  /** what the stay would save in SAR against the original, when the baseline is known */
  saveSar: number | null;
  /** trusted per-room stay prices to WRITE (memory only, same order as stay.rooms); absent = unverified, prices stay empty */
  roomPrices?: { prices: number[]; currency: string };
  board: string | null;
  cancellation: string | null;
  refundable: boolean | null;
  /** optional compare links for the employee's own eyes (deep links, no scraping) — reserved, awaiting the owner's word */
  links?: { label: string; url: string }[];
};

type PerNight = { perNightTotal: number; currency: string };

/** What one night of this stay's rooms costs at `hotel` — null when any room's rate is unknown or currencies mix. */
export function stayPerNight(stay: DraftHotel, hotel: CandidateHotel): PerNight | null {
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

/** The original stay's own per-night cost: its memory rate when it has one, else its typed prices. */
export function stayBaseline(stay: DraftHotel, nights: number, market: CandidateHotel[]): PerNight | null {
  const original = market.find((c) => (stay.hotel_id && c.id === stay.hotel_id) || fold(c.name) === fold(stay.hotel_name)) ?? null;
  const fromMemory = original ? stayPerNight(stay, original) : null;
  if (fromMemory) return fromMemory;
  const typed = (stay.rooms ?? []).reduce((n, r) => (n == null || r.price == null ? null : n + r.price), 0 as number | null);
  const pricedNights = stay.priced_nights && stay.priced_nights > 0 ? stay.priced_nights : nights;
  return typed != null && pricedNights > 0 ? { perNightTotal: typed / pricedNights, currency: stay.manual_currency?.trim() || "SAR" } : null;
}

/** The original hotel's stars, from the memory market — unknown means never swap blind. */
export function stayStars(stay: DraftHotel, market: CandidateHotel[]): number | null {
  return market.find((c) => (stay.hotel_id && c.id === stay.hotel_id) || fold(c.name) === fold(stay.hotel_name))?.stars ?? null;
}

const toSar = (amount: number, currency: string, sarPer: Record<string, number>) =>
  currency === "SAR" ? amount : sarPer[currency] ? amount * sarPer[currency] : null;

/** The memory source's alternatives for one stay, cheapest first (suggest-sources.ts calls this). */
export function memoryAlternatives(stay: DraftHotel, nights: number, market: CandidateHotel[], sarPer: Record<string, number>): StayAlternative[] {
  const stars = stayStars(stay, market);
  if (!stars) return [];
  const base = stayBaseline(stay, nights, market);
  if (!base || base.perNightTotal <= 0) return [];
  const baseSar = toSar(base.perNightTotal * nights, base.currency, sarPer);
  return market
    .filter((c) => c.stars === stars && c.id !== stay.hotel_id && fold(c.name) !== fold(stay.hotel_name))
    .map((c) => ({ hotel: c, priced: stayPerNight(stay, c) }))
    .filter((x): x is { hotel: CandidateHotel; priced: PerNight } => Boolean(x.priced))
    .filter((x) => x.priced.currency === base.currency && x.priced.perNightTotal < base.perNightTotal)
    .sort((a, b) => a.priced.perNightTotal - b.priced.perNightTotal)
    .map((x): StayAlternative | null => {
      const staySar = toSar(x.priced.perNightTotal * nights, x.priced.currency, sarPer);
      if (staySar == null) return null;
      return {
        source: "memory",
        hotelId: x.hotel.id,
        supplierHotelId: null,
        hotelName: x.hotel.name,
        stars,
        staySar: Math.round(staySar),
        saveSar: baseSar != null ? Math.round(baseSar - staySar) : null,
        roomPrices: {
          prices: (stay.rooms ?? []).map((r) => {
            const rate = x.hotel.rates[rateKey(r.room_type_name, r.board_type)]!;
            return Math.round(rate.perNight * nights * 100) / 100;
          }),
          currency: x.priced.currency,
        },
        board: null,
        cancellation: null,
        refundable: null,
      };
    })
    .filter((x): x is StayAlternative => x !== null);
}

export type Swapped = { city: string; from: string; to: string; stars: number; source: StayAlternative["source"]; staySar: number; saveSar: number | null; cancellation: string | null };
export type Suggestion = { data: DraftData; swapped: Swapped[]; unverified: boolean };

/**
 * Up to `count` variants: variant k takes each stay's k-th cheapest alternative
 * (falling back to its cheapest, else the original). A memory alternative's
 * trusted prices are written; a supplier's are NOT — its rooms stay unpriced,
 * so the file cannot issue until the employee verifies and types them. A
 * variant that swaps nothing, or repeats an earlier one, is dropped.
 */
export function buildSuggestions(draft: DraftData, alternativesByCityKey: Map<string, StayAlternative[]>, count = 2): Suggestion[] {
  const nightsOf = new Map(draft.cities.map((c) => [c.key, c.nights]));
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < count; k += 1) {
    const swapped: Swapped[] = [];
    let unverified = false;
    const data: DraftData = JSON.parse(JSON.stringify(draft)) as DraftData;
    data.produced_serial = null;
    data.hotels = data.hotels.map((stay) => {
      const list = alternativesByCityKey.get(stay.city_key ?? "") ?? [];
      const pick = list[k] ?? list[0];
      if (!pick) return stay;
      const nights = Math.max(nightsOf.get(stay.city_key) ?? 0, 1);
      swapped.push({ city: stay.city_name, from: stay.hotel_name, to: pick.hotelName, stars: pick.stars, source: pick.source, staySar: pick.staySar, saveSar: pick.saveSar, cancellation: pick.cancellation });
      if (!pick.roomPrices) unverified = true;
      return {
        ...stay,
        hotel_id: pick.hotelId,
        hotel_name: pick.hotelName,
        manual_price: null,
        priced_nights: nights,
        // a quote made for the OLD hotel never rides into the new one
        sourcing: null,
        rooms: (stay.rooms ?? []).map((r, i) => ({ ...r, price: pick.roomPrices ? (pick.roomPrices.prices[i] ?? null) : null })),
      };
    });
    if (!swapped.length) break;
    // a locked ready-offer total belongs to the ORIGINAL hotels — the variant prices from its own lines
    if (data.pricing.final_total != null) Object.assign(data, { pricing: { ...data.pricing, final_total: null }, source: null });
    const sig = JSON.stringify(swapped.map((s) => [s.city, s.to]));
    if (seen.has(sig)) break;
    seen.add(sig);
    out.push({ data, swapped, unverified });
  }
  return out;
}
