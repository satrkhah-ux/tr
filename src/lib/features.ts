/**
 * System services the developer can turn off and on again from /developer
 * (owner's order, 2026-10-17) — kept in app_settings under one key, so turning a
 * service off is a row change, not a deploy.
 *
 * Off means: its menu links go, its pages refuse a typed URL (guardPath), and
 * its buttons hide. Nothing is deleted — turning it back on restores it as it
 * was. Pure: no database here; the reading is in features-server.ts, the
 * writing in data/app-settings.ts.
 */
export const FEATURES = [
  "legacy_generator",
  "repackage",
  "flight_card",
  "ready_offers",
  "kanban",
  // Buttons, not routes: the programme's AI drafting (OpenAI) and the flights
  // stage's flight-number lookup (AviationStack, a tiny monthly quota). Off hides
  // the button (getAssistantAvailability) and the server action refuses.
  "ai_itinerary",
  "flight_lookup",
] as const;

export type Feature = (typeof FEATURES)[number];
export type FeatureFlags = Record<Feature, boolean>;

/** Everything starts on: a missing row must never switch a working screen off. */
export const FEATURE_DEFAULTS: FeatureFlags = {
  legacy_generator: true,
  repackage: true,
  flight_card: true,
  ready_offers: true,
  kanban: true,
  ai_itinerary: true,
  flight_lookup: true,
};

export const FEATURES_SETTING_KEY = "features";

export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}

/** The stored JSON ({"repackage": false, …}) over the defaults; anything unreadable is ignored. */
export function parseFeatures(raw: string | null | undefined): FeatureFlags {
  const flags = { ...FEATURE_DEFAULTS };
  if (!raw) return flags;
  try {
    const stored = JSON.parse(raw) as unknown;
    if (stored && typeof stored === "object") {
      for (const [key, on] of Object.entries(stored)) if (isFeature(key) && typeof on === "boolean") flags[key] = on;
    }
  } catch {
    /* a broken row keeps everything on */
  }
  return flags;
}

/**
 * Which service a route belongs to. Longest prefix first: /repackage/flight-card
 * is the flight card, not the repackage flow.
 *
 * /package-generator is the legacy generator. It shares its drafts with «النظام
 * بيسك», so switching it off sends staff from an old URL to the same draft in
 * /basic; partners keep it (it is their «ملفاتي»).
 */
const FEATURE_ROUTES: readonly (readonly [prefix: string, feature: Feature])[] = [
  ["/repackage/flight-card", "flight_card"],
  ["/repackage", "repackage"],
  ["/ready-offers", "ready_offers"],
  ["/kanban-board", "kanban"],
  ["/package-generator", "legacy_generator"],
];

export function featureForPath(href: string): Feature | null {
  const path = href.split(/[?#]/)[0];
  return FEATURE_ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;
}
