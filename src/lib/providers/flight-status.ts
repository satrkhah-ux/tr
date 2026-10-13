import "server-only";
import { parseFlightNumber } from "@/lib/offer/flight-number";
import type { FlightObservation } from "@/lib/operations/flight-track";
import { shift } from "@/lib/operations/seed-plan";
import { toWallClock } from "./flight-lookup";

/**
 * A flight's live arrival from AviationStack — the same key and base URL as the
 * generator's lookup (flight-lookup.ts), and the same clock rule: the provider's
 * times are the airport's wall clock whatever offset they carry.
 *
 * Returns null when the key is missing or the call fails: the tracker then
 * leaves the reception as it is, which is what an agent would see anyway.
 */

type Endpoint = { iata?: string | null; scheduled?: string | null; estimated?: string | null; actual?: string | null; delay?: number | null };
type Row = { flight_date?: string | null; arrival?: Endpoint };

export async function flightObservations(flightNo: string): Promise<FlightObservation[] | null> {
  const key = process.env["AVIATIONSTACK_API_KEY"];
  const parsed = parseFlightNumber(flightNo);
  if (!key || !parsed) return null;
  const base = process.env["AVIATIONSTACK_BASE_URL"] || "https://api.aviationstack.com/v1";
  const param = parsed.kind === "icao" ? "flight_icao" : "flight_iata";
  try {
    const res = await fetch(`${base}/flights?access_key=${encodeURIComponent(key)}&${param}=${parsed.code}&limit=10`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Row[]; error?: unknown };
    if (body.error || !Array.isArray(body.data)) return null;
    return body.data.map((r) => {
      const a = r.arrival ?? {};
      const scheduled = toWallClock(a.scheduled);
      // no estimate but a stated delay: the landing is the schedule plus it
      const late = !a.estimated && scheduled && a.delay ? shift(scheduled, a.delay) : null;
      return {
        flight_date: r.flight_date?.trim() || null,
        to: a.iata?.trim().toUpperCase() ?? "",
        scheduled,
        estimated: toWallClock(a.estimated) ?? (late ? `${late.date}T${late.time}` : null),
        actual: toWallClock(a.actual),
      };
    });
  } catch {
    return null;
  }
}
