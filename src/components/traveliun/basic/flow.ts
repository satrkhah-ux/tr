/**
 * The page's sections, in the order a file is entered (the owner, 2026-10-25): the client, the
 * international flights (they set the dates), the hotels city by city, the domestic flights
 * between them, the programme and its tours — then what it includes, its price and issuing.
 * One page to the agent: no numbers, no «مرحلة» — a section opens as the one before is done.
 */
export type Section = "client" | "flights" | "hotels" | "domestic" | "programme" | "services" | "pricing" | "finish";
export const SECTION_ORDER: Section[] = ["client", "flights", "hotels", "domestic", "programme", "services", "pricing", "finish"];

/**
 * The sections this file has: no international flight, no leg between its cities flown, or no
 * right to the prices — that section is not there at all, and the page runs on to the next.
 */
export function fileSections(has: { intl: boolean; domestic: boolean; pricing: boolean }): Section[] {
  return SECTION_ORDER.filter((s) => (s !== "flights" || has.intl) && (s !== "domestic" || has.domestic) && (s !== "pricing" || has.pricing));
}

/** The checks on the domestic legs — asked on their own section, where each leg is entered. */
export const DOM_KEYS = ["pg.err.domFlightIncomplete", "pg.err.domFlightUnpriced", "pg.err.domesticMismatch"];

/** Which section answers an issue of a validation stage. */
const SECTION_OF: Partial<Record<string, Section>> = {
  customer: "client",
  trip: "client",
  visas: "client",
  // «البرنامج يشمل» chips sit with the client's answers
  scope: "client",
  flights: "flights",
  // the cities are added, ordered and given their nights beside their hotels
  cities: "hotels",
  hotels: "hotels",
  // the reception and tours cars are chosen on the city's tours
  transport: "programme",
  // a day with no title is fixed in its city's programme
  itinerary: "programme",
  services: "services",
  pricing: "pricing",
};

/**
 * Where «إكمال» takes an issue: a domestic leg's to the domestic flights (to the hotels, where
 * the move is set to «طيران», while the file has none); the rest by their stage. null: no
 * section of this file answers it.
 */
export function sectionOf(issue: { stage: string; key?: string | null }, sections: Section[]): Section | null {
  const to = issue.key && DOM_KEYS.includes(issue.key) ? (sections.includes("domestic") ? "domestic" : "hotels") : SECTION_OF[issue.stage];
  return to && sections.includes(to) ? to : null;
}
