import "server-only";

/**
 * Flight-number lookup — the agent types "SV820" and the route/airline/times
 * fill themselves in, instead of being copied by hand from an airline site.
 *
 * REAL DATA ONLY. This never predicts or invents a schedule: it returns what
 * the provider actually publishes, tagged with the date that schedule is from,
 * and the agent CONFIRMS before it lands in the draft. If the provider has
 * nothing, the agent types the flight manually exactly as before.
 *
 * SERVER-ONLY (the key must never reach the browser). Env read at RUNTIME:
 *   AVIATIONSTACK_API_KEY  required — the button is hidden without it
 *   AVIATIONSTACK_BASE_URL optional (the free plan is http-only; paid is https)
 */

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function isFlightLookupConfigured(): boolean {
  return Boolean(readEnv("AVIATIONSTACK_API_KEY"));
}

export type FlightLookupHit = {
  airline: string;
  /** normalised IATA designator, e.g. "SV820". */
  flight_iata: string;
  from_iata: string;
  from_airport: string;
  from_tz: string | null;
  to_iata: string;
  to_airport: string;
  to_tz: string | null;
  /** local wall clock at the ORIGIN ("YYYY-MM-DDTHH:mm"), or null. */
  departure_at: string | null;
  /** local wall clock at the DESTINATION ("YYYY-MM-DDTHH:mm"), or null. */
  arrival_at: string | null;
  /** the date this schedule was actually observed — shown to the agent so they
   *  know the times come from another day and must be checked. */
  schedule_date: string | null;
  terminal: string | null;
};

export type FlightLookupResult =
  | { ok: true; hits: FlightLookupHit[] }
  | { ok: false; error: "not_configured" | "bad_input" | "request_failed" | "not_found"; detail?: string };

export type ParsedFlightNumber = {
  /** the airline designator, e.g. "SV" (IATA) or "SVA" (ICAO). */
  carrier: string;
  number: string;
  /** designator + number, the form the provider is queried with. */
  code: string;
  kind: "iata" | "icao";
};

/**
 * "sv 820" / "SV-820" / "SV820" → { carrier: "SV", number: "820" }.
 *
 * The split is NOT greedy-by-length: an IATA designator is exactly 2 characters
 * and an ICAO one exactly 3 LETTERS, so "SV820" is SV+820 (never SV8+20) and
 * "W64501" is W6+4501. ICAO is tried first because only it can start with three
 * letters ("SVA820" → SVA+820, while "SV8…" cannot be ICAO).
 *
 * A typo becomes a clear "bad_input" rather than a wasted API call.
 */
export function parseFlightNumber(input: string): ParsedFlightNumber | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s\-_/]+/g, "");

  const icao = cleaned.match(/^([A-Z]{3})(\d{1,4})$/);
  if (icao) return { carrier: icao[1], number: icao[2], code: cleaned, kind: "icao" };

  const iata = cleaned.match(/^([A-Z0-9]{2})(\d{1,4})$/);
  // A designator must contain at least one letter — "1234" is not an airline.
  if (iata && /[A-Z]/.test(iata[1])) {
    return { carrier: iata[1], number: iata[2], code: cleaned, kind: "iata" };
  }
  return null;
}

/**
 * "2026-07-20T02:00:00+03:00" → "2026-07-20T02:00" (local wall clock).
 *
 * ⚠️ The offset is DELIBERATELY discarded, and that is not sloppiness:
 * AviationStack returns the airport's LOCAL time but stamps every value with
 * "+00:00" regardless of the airport's real zone (it reports the zone
 * separately, e.g. departure.timezone = "Asia/Riyadh"). Treating that offset as
 * real UTC and converting would shift every flight by hours. We keep the clock
 * face and carry the IANA zone alongside it — the same contract the draft uses.
 */
export function toWallClock(iso: string | null | undefined): string | null {
  if (typeof iso !== "string") return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
}

type StackEndpoint = {
  airport?: string | null;
  timezone?: string | null;
  iata?: string | null;
  terminal?: string | null;
  scheduled?: string | null;
};

type StackFlight = {
  flight_date?: string | null;
  departure?: StackEndpoint;
  arrival?: StackEndpoint;
  airline?: { name?: string | null; iata?: string | null };
  flight?: { iata?: string | null; number?: string | null };
};

type StackResponse = { data?: StackFlight[]; error?: { message?: string; info?: string } };

function toHit(f: StackFlight, fallbackIata: string): FlightLookupHit | null {
  const from = f.departure ?? {};
  const to = f.arrival ?? {};
  // A hit with no route is useless to the agent — drop it rather than fill the
  // form with blanks.
  if (!from.iata && !to.iata) return null;
  return {
    airline: f.airline?.name?.trim() || f.airline?.iata?.trim() || "",
    flight_iata: f.flight?.iata?.trim().toUpperCase() || fallbackIata,
    from_iata: from.iata?.trim().toUpperCase() ?? "",
    from_airport: from.airport?.trim() ?? "",
    from_tz: from.timezone?.trim() || null,
    to_iata: to.iata?.trim().toUpperCase() ?? "",
    to_airport: to.airport?.trim() ?? "",
    to_tz: to.timezone?.trim() || null,
    departure_at: toWallClock(from.scheduled),
    arrival_at: toWallClock(to.scheduled),
    schedule_date: f.flight_date?.trim() || null,
    terminal: from.terminal?.trim() || null,
  };
}

/**
 * Collapse the provider's per-day rows into distinct ROUTES. A flight number is
 * flown daily, so the raw feed repeats the same leg; the agent wants to pick a
 * route, not scroll through identical rows. The most recent row wins.
 */
export function dedupeRoutes(hits: FlightLookupHit[]): FlightLookupHit[] {
  const byRoute = new Map<string, FlightLookupHit>();
  for (const hit of hits) {
    const key = `${hit.from_iata}>${hit.to_iata}`;
    const seen = byRoute.get(key);
    if (!seen || (hit.schedule_date ?? "") > (seen.schedule_date ?? "")) byRoute.set(key, hit);
  }
  return [...byRoute.values()];
}

/** Look a flight number up. Never throws — every failure is a typed result. */
export async function lookupFlight(input: string): Promise<FlightLookupResult> {
  const key = readEnv("AVIATIONSTACK_API_KEY");
  if (!key) return { ok: false, error: "not_configured" };
  const parsed = parseFlightNumber(input);
  if (!parsed) return { ok: false, error: "bad_input" };

  // HTTPS by default: the access key travels in the QUERY STRING (the
  // provider's design), so plaintext would expose it on the wire. Older free
  // plans are http-only — those set AVIATIONSTACK_BASE_URL explicitly.
  const base = readEnv("AVIATIONSTACK_BASE_URL") ?? "https://api.aviationstack.com/v1";
  const param = parsed.kind === "icao" ? "flight_icao" : "flight_iata";
  const url = `${base}/flights?access_key=${encodeURIComponent(key)}&${param}=${parsed.code}&limit=20`;

  let data: StackResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return { ok: false, error: "request_failed", detail: String(res.status) };
    data = (await res.json()) as StackResponse;
  } catch (error) {
    return { ok: false, error: "request_failed", detail: error instanceof Error ? error.message : String(error) };
  }

  if (data.error) return { ok: false, error: "request_failed", detail: data.error.info ?? data.error.message };
  const rows = Array.isArray(data.data) ? data.data : [];
  const hits = dedupeRoutes(rows.map((f) => toHit(f, parsed.code)).filter((h): h is FlightLookupHit => Boolean(h)));
  if (hits.length === 0) return { ok: false, error: "not_found" };
  return { ok: true, hits };
}
