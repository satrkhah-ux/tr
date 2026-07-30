/**
 * A flight number, split into carrier and number.
 *
 * PURE — no server-only import — because the browser needs it too: the moment an
 * agent types SV820 in the flights stage the carrier is known, so the airline's
 * name and its mark can be filled with no API call, no key and no waiting.
 */

export type ParsedFlightNumber = {
  /** the airline designator, e.g. "SV" (IATA) or "SVA" (ICAO). */
  carrier: string;
  number: string;
  /** designator + number, the form a provider is queried with. */
  code: string;
  kind: "iata" | "icao";
};

/**
 * "sv 820" / "SV-820" / "SV820" -> { carrier: "SV", number: "820" }.
 *
 * The split is NOT greedy-by-length: an IATA designator is exactly 2 characters
 * and an ICAO one exactly 3 LETTERS, so "SV820" is SV+820 (never SV8+20) and
 * "W64501" is W6+4501. ICAO is tried first because only it can start with three
 * letters ("SVA820" -> SVA+820, while "SV8..." cannot be ICAO).
 */
export function parseFlightNumber(input: string): ParsedFlightNumber | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s\-_/]+/g, "");

  const icao = cleaned.match(/^([A-Z]{3})(\d{1,4})$/);
  if (icao) return { carrier: icao[1], number: icao[2], code: cleaned, kind: "icao" };

  const iata = cleaned.match(/^([A-Z0-9]{2})(\d{1,4})$/);
  // A designator must contain at least one letter - "1234" is not an airline.
  if (iata && /[A-Z]/.test(iata[1])) {
    return { carrier: iata[1], number: iata[2], code: cleaned, kind: "iata" };
  }
  return null;
}
