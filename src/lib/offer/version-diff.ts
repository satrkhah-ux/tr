import type { ClientOfferDTO } from "./dto";

/**
 * «ما تغيّر» — what a re-issued version («إصدار نسخة محدّثة») changed against
 * the version the client had before, read from the two published client
 * renders. Pure: the employee sees it right after the press, and the audit row
 * keeps it.
 *
 * Stay by stay, in the order the document prints them: the hotel, the room,
 * the board, the rooms and the stay's dates. Then the trip's dates, the
 * travellers, the flights and the price. Stays are matched by position, not by
 * city: a hotel-less stay has no city to match on (the document resolves a
 * stay's city from its hotel), and that is exactly the stay a re-issue fixes.
 * A stay added or dropped shows as its hotel going from «—» or to «—».
 */
export type OfferChangeKind = "hotel" | "room" | "board" | "rooms" | "stayDates" | "dates" | "travellers" | "flights" | "price";

export type OfferChange = {
  kind: OfferChangeKind;
  /** the city a stay change is in; null for the trip's own fields. */
  where: string | null;
  before: string;
  after: string;
};

const NONE = "—";

type Doc = Pick<
  ClientOfferDTO,
  "hotels" | "flights" | "arrival_date" | "departure_date" | "adults" | "children" | "infants" | "total" | "currency"
>;

const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : NONE);

export function offerChanges(before: Doc, after: Doc): OfferChange[] {
  const out: OfferChange[] = [];
  const add = (kind: OfferChangeKind, where: string | null, a: string, b: string) => {
    if (a !== b) out.push({ kind, where, before: a, after: b });
  };

  type Stay = Doc["hotels"][number];
  const text = (v: string | number | null | undefined) => (v == null ? "" : String(v).trim()) || NONE;
  const span = (h: Stay) => `${day(h.check_in)} → ${day(h.check_out)}`;
  for (let i = 0; i < Math.max(before.hotels.length, after.hotels.length); i++) {
    const a: Stay | undefined = before.hotels[i];
    const b: Stay | undefined = after.hotels[i];
    const where = b?.city_name || a?.city_name || null;
    add("hotel", where, text(a?.hotel_name), text(b?.hotel_name));
    // a stay added or dropped is its hotel; the rest of it is said once it exists on both sides
    if (!a || !b) continue;
    add("room", where, text(a.room_type), text(b.room_type));
    add("board", where, text(a.board_type), text(b.board_type));
    add("rooms", where, text(a.rooms_count), text(b.rooms_count));
    add("stayDates", where, span(a), span(b));
  }

  add("dates", null, `${day(before.arrival_date)} → ${day(before.departure_date)}`, `${day(after.arrival_date)} → ${day(after.departure_date)}`);
  const pax = (d: Doc) => `${d.adults} + ${d.children} + ${d.infants}`;
  add("travellers", null, pax(before), pax(after));
  const legs = (d: Doc) =>
    d.flights.map((f) => [f.flight_no, `${f.from_airport ?? NONE} → ${f.to_airport ?? NONE}`, day(f.departure_at)].filter(Boolean).join(" ")).join(" · ") || NONE;
  add("flights", null, legs(before), legs(after));
  const price = (d: Doc) => (d.total == null ? NONE : `${Number(d.total).toLocaleString("en-US")} ${d.currency ?? ""}`.trim());
  add("price", null, price(before), price(after));
  return out;
}
