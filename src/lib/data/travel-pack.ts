import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getClientHub, type ClientHub } from "@/lib/data/operation-hub";
import { getClientTrip, type ClientTrip } from "@/lib/data/client-trip";
import { getTripGuide } from "@/lib/data/destination-guides";
import { getReceiptByToken, listTripReceipts } from "@/lib/data/payment-receipt";
import { pickPackDocuments, type PackDocRow } from "@/lib/operations/travel-pack";
import { withLegs } from "@/lib/data/ticket-legs";
import type { VoucherDTO } from "@/lib/operations/voucher-dto";
import type { ReceiptDTO } from "@/lib/operations/payments";

/**
 * Everything «حقيبة السفر» prints, by the trip link's token — and nothing the
 * trip page itself does not already hand the client: the documents the hub
 * lists (client kinds, not revoked), the receipts it lists, its emergency guide
 * and its drives. Each piece goes through the reader the page uses, so the
 * pack cannot carry more than the link does.
 */

export type TravelPack = {
  hub: ClientHub;
  trip: ClientTrip;
  guide: Awaited<ReturnType<typeof getTripGuide>>;
  documents: VoucherDTO[];
  receipts: ReceiptDTO[];
};

export async function getTravelPack(token: string): Promise<TravelPack | null> {
  const [hub, trip, guide, listed] = await Promise.all([getClientHub(token), getClientTrip(token), getTripGuide(token), listTripReceipts(token)]);
  if (!hub || !trip) return null;

  // the hub already chose which documents are the client's; the pack needs their snapshots
  const tokens = hub.documents.map((d) => d.token);
  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const rows = tokens.length
    ? (((await db
        .from("operation_documents")
        .select("kind, booking_id, created_at, snapshot_json")
        .in("token", tokens)).data ?? []) as (PackDocRow & { snapshot_json: VoucherDTO })[])
    : [];

  const receipts = (await Promise.all(listed.map((r) => getReceiptByToken(r.token)))).filter((r): r is ReceiptDTO => r !== null);
  // an older ticket prints its flights as cards too, read back from its lines
  const documents = await Promise.all(pickPackDocuments(rows).map((r) => withLegs(db, r.snapshot_json)));
  return { hub, trip, guide, documents, receipts };
}
