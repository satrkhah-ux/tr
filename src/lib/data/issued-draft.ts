import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The draft an offer was ISSUED from — what operations seeds its bookings and
 * travelers from (audit M1).
 *
 * It used to be "the newest draft whose produced_serial is this serial", read at
 * seed time: a partner could edit their draft after issue (more rooms, more
 * nights, a better hotel against the invoice already raised) or point another
 * draft at the serial, and operations would book that. Now publishOffer freezes
 * the issuing draft beside the first internal render (offer_renders is
 * append-only and service-only), and that copy is the one read here. A re-issue
 * («إصدار نسخة محدّثة») freezes its draft beside its own version, and the
 * NEWEST frozen copy is the one read: operations books the version the client
 * was last sent, not the first.
 *
 * Offers issued before the freeze existed fall back to the live draft — only
 * when exactly one draft names the serial and it is ours or the offer's own
 * partner's. Anything else seeds from the offer's frozen rows instead.
 */

export type DraftRow = { id: string; data: Record<string, unknown>; partner_company_id: string | null };
/** What v1's internal render carries: the draft as issued, or none (`data: null`) when there was none to trust. */
export type FrozenDraft = { id: string | null; data: Record<string, unknown> | null };

/** The one draft that can have issued this offer, or null when it is not unambiguous or not theirs. */
export function pickIssuingDraft<T extends Pick<DraftRow, "partner_company_id">>(rows: T[], offerPartner: string | null): T | null {
  if (rows.length !== 1) return null;
  const [row] = rows;
  // our own draft may issue under a reseller's brand; a partner's only its own file
  return row.partner_company_id == null || row.partner_company_id === offerPartner ? row : null;
}

async function draftsNaming(service: SupabaseClient, serial: string): Promise<DraftRow[]> {
  const { data } = await service
    .from("offer_drafts")
    .select("id, data, partner_company_id")
    .eq("data->>produced_serial", serial)
    .limit(2);
  return (data ?? []) as DraftRow[];
}

/** For publishOffer's first version: the copy to freeze. */
export async function draftToFreeze(service: SupabaseClient, serial: string, offerPartner: string | null): Promise<FrozenDraft> {
  const row = pickIssuingDraft(await draftsNaming(service, serial), offerPartner);
  return { id: row?.id ?? null, data: row?.data ?? null };
}

/** The copy frozen with the newest version that froze one — undefined when none did. */
export function newestFrozen(rows: { version: number; source: FrozenDraft | null }[]): FrozenDraft | undefined {
  return [...rows].sort((a, b) => b.version - a.version).find((r) => r.source)?.source ?? undefined;
}

/**
 * A partner company's file that is confirmed or already invoiced stays as it
 * was issued: its invoice was raised at the issued cost (ledger-server.ts), so
 * a new version would move the programme out from under it. A copy is the way.
 */
export async function reissueLocked(service: SupabaseClient, serial: string): Promise<boolean> {
  const { data } = await service.from("offers").select("id, status, partner_company_id").eq("serial", serial).maybeSingle();
  const offer = data as { id: string; status: string | null; partner_company_id: string | null } | null;
  if (!offer?.partner_company_id) return false;
  if (offer.status === "confirmed") return true;
  const { count } = await service.from("partner_invoices").select("offer_id", { count: "exact", head: true }).eq("offer_id", offer.id);
  return (count ?? 0) > 0;
}

/** For the seeds: the draft as issued, or null — then the offer's own rows are the source. */
export async function issuedDraftData(
  service: SupabaseClient,
  offer: { id: string; serial: string; partner_company_id: string | null },
): Promise<Record<string, unknown> | null> {
  // every internal version (a handful): the newest one that froze a draft wins
  const { data } = await service
    .from("offer_renders")
    .select("version, source:snapshot_json->source_draft")
    .eq("offer_id", offer.id)
    .eq("variant", "internal");
  const frozen = newestFrozen((data ?? []) as { version: number; source: FrozenDraft | null }[]);
  if (frozen) return frozen.data;
  // issued before the freeze
  if (!offer.serial) return null;
  return pickIssuingDraft(await draftsNaming(service, offer.serial), offer.partner_company_id)?.data ?? null;
}
