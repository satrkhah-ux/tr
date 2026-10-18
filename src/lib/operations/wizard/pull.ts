import { driverServiceKind } from "@/lib/operations/drivers";
import type { OfferKinds, WizardCase } from "./types";

/**
 * «لم تُسحب الحجوزات» — the offer books this kind and the case holds not one
 * booking of it, not even a cancelled one: nothing was pulled (AD-2-3599 opened
 * with none, and its flights, hotels and transfers read «لا ينطبق»). A step is
 * «لا ينطبق» only when the offer itself has none; this one is still to do.
 * Unknown offer (offerKinds null) — the bookings alone decide, as before.
 *
 * Pure: no React, no Supabase.
 */
export function notPulled(data: Pick<WizardCase, "bookings" | "offerKinds">, kind: keyof OfferKinds): boolean {
  if (!data.offerKinds?.[kind]) return false;
  return !data.bookings.some((b) => (kind === "transport" ? driverServiceKind(b) !== null : b.kind === kind));
}
