"use server";

import { gateOperation } from "@/lib/operations/access";
import { pullBookingsFromOffer, type SeedResult } from "@/lib/data/offer-pull";

/**
 * «اسحب الحجوزات من العرض» — the pull (offer-pull.ts) behind the case's own
 * gate: anyone who may work the file. The case is pulled once already when it
 * is opened and when its wizard first opens; pressing again adds only what is
 * missing.
 */
export async function seedBookingsFromOffer(operationId: string): Promise<SeedResult> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  return pullBookingsFromOffer(operationId);
}
