import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { airlineLogoUrl } from "@/components/offer-doc/brand";
import { inlineImage } from "@/lib/offer-doc/assets";
import type { FlightLeg } from "@/lib/data/operation-bookings";
import { flightLegs } from "@/lib/operations/drivers";
import type { VoucherDTO, VoucherLeg } from "@/lib/operations/voucher-dto";
import { uniqueLegs } from "@/lib/operations/wizard/flights";

/**
 * The flight ticket's legs as its boarding-pass cards print them (2026-10-22):
 * each flight once, the carrier and the places by name from our own airlines
 * and airports tables. Used when a ticket is issued, and when one issued
 * before its snapshot carried legs is printed — read back from its leg lines.
 */

type Leg = Pick<FlightLeg, "flight_no" | "from" | "to" | "departs_at" | "arrives_at">;

/** The carrier's code at the head of a flight number: «XY309» → XY. */
const carrierOf = (flightNo: string) => flightNo.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])(?=\d)/)?.[1] ?? null;

/** Legs → the ticket's legs, each flight once, named. */
export async function namedLegs(supabase: SupabaseClient, raw: Leg[]): Promise<VoucherLeg[]> {
  const legs = uniqueLegs(raw);
  const codes = [...new Set(legs.flatMap((l) => [l.from, l.to]).filter(Boolean))];
  const carriers = [...new Set(legs.map((l) => carrierOf(l.flight_no)).filter((c): c is string => Boolean(c)))];
  const [airports, airlines] = await Promise.all([
    codes.length ? supabase.from("airports").select("code, arabic_name, cities(arabic_name)").in("code", codes) : null,
    carriers.length ? supabase.from("airlines").select("iata, arabic_name").in("iata", carriers) : null,
  ]);
  type AirportRow = { code: string; arabic_name: string; cities: { arabic_name: string } | { arabic_name: string }[] | null };
  // the city a traveller knows, else the airport's own name
  const placeOf = new Map(
    ((airports?.data ?? []) as AirportRow[]).map((a) => {
      const city = Array.isArray(a.cities) ? a.cities[0] : a.cities;
      return [a.code.toUpperCase(), city?.arabic_name || a.arabic_name] as const;
    }),
  );
  const airlineOf = new Map(((airlines?.data ?? []) as { iata: string; arabic_name: string }[]).map((a) => [a.iata.toUpperCase(), a.arabic_name]));
  return legs.map((l) => {
    const iata = carrierOf(l.flight_no);
    return {
      flight_no: l.flight_no,
      airline: (iata && airlineOf.get(iata)) || null,
      airline_iata: iata,
      from: l.from,
      from_name: placeOf.get(l.from) ?? null,
      to: l.to,
      to_name: placeOf.get(l.to) ?? null,
      departs_at: l.departs_at,
      arrives_at: l.arrives_at,
    };
  });
}

/** A ticket issued before its snapshot carried legs: its flights read back from the lines it printed («XY309 · RUH → TBS · …»). */
export async function withLegs(supabase: SupabaseClient, voucher: VoucherDTO): Promise<VoucherDTO> {
  if (voucher.kind !== "flight_ticket" || voucher.bookings.some((b) => b.legs?.length)) return voucher;
  const bookings = await Promise.all(
    voucher.bookings.map(async (b) => {
      const lines = flightLegs(b.detail).map(({ leg }) => ({ flight_no: leg.flight_no, from: leg.from, to: leg.to, departs_at: leg.departure, arrives_at: leg.arrival }));
      return lines.length ? { ...b, legs: await namedLegs(supabase, lines), pnr: b.confirmation_number } : b;
    }),
  );
  return { ...voucher, bookings };
}

/** Each carrier's mark, inlined: Chromium prints offline (as /repackage's flight card). */
export async function carrierMarks(supabase: SupabaseClient, voucher: VoucherDTO): Promise<Record<string, string>> {
  const iatas = [...new Set(voucher.bookings.flatMap((b) => b.legs ?? []).map((l) => l.airline_iata).filter((c): c is string => Boolean(c)))];
  const marks: Record<string, string> = {};
  if (!iatas.length) return marks;
  const { data } = await supabase.from("airlines").select("iata, logo_path").in("iata", iatas);
  await Promise.all(
    ((data ?? []) as { iata: string; logo_path: string | null }[]).map(async (a) => {
      const url = airlineLogoUrl(a.logo_path);
      const inlined = url ? await inlineImage(url) : null;
      if (inlined) marks[a.iata.toUpperCase()] = inlined;
    }),
  );
  return marks;
}
